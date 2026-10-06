import { BadRequestException } from "@nestjs/common";
import { studentOnboardingSchema } from "@smartify/validation";
import { OnboardingService } from "./onboarding.service";

/**
 * Covers two previously-untested, meaningful areas flagged in the Phase
 * 10 acceptance review: (1) onboarding's cross-entity validation, which
 * is the only thing stopping a student from submitting a grade that
 * belongs to a different curriculum or subjects that belong to a
 * different grade, and (2) diagnostic grading correctness — the actual
 * score a student sees is computed here and must be right.
 */
describe("OnboardingService", () => {
  const mockQuestionGenerator = { ensurePoolForTopic: jest.fn() } as any;
  const curriculum = { id: "curriculum-A", code: "EG_NATIONAL" };
  const gradeInCurriculumA = { id: "grade-1", curriculumId: "curriculum-A" };
  const gradeInCurriculumB = { id: "grade-2", curriculumId: "curriculum-B" };
  const subjectInGrade1 = { id: "subject-1", gradeId: "grade-1" };

  function makePrismaMock(overrides: Partial<{ grade: any; subjects: any[]; school: any }> = {}) {
    return {
      client: {
        curriculum: { findUnique: jest.fn().mockResolvedValue(curriculum) },
        grade: { findUnique: jest.fn().mockResolvedValue(overrides.grade ?? gradeInCurriculumA) },
        subject: { findMany: jest.fn().mockResolvedValue(overrides.subjects ?? [subjectInGrade1]) },
        school: { findUnique: jest.fn().mockResolvedValue(overrides.school ?? null) },
        studentProfile: {
          upsert: jest.fn().mockResolvedValue({ id: "student-1" }),
          findUnique: jest.fn().mockResolvedValue({ id: "student-1" }),
        },
        studentSubject: { deleteMany: jest.fn(), createMany: jest.fn() },
      },
    } as any;
  }

  const baseInput = {
    fullName: "Test Student",
    age: 12,
    country: "EG",
    preferredLang: "en" as const,
    curriculumCode: "EG_NATIONAL" as const,
    gradeId: "grade-1",
    subjectIds: ["subject-1"],
  };

  describe("saveProfile — cross-entity validation", () => {
    it("rejects a grade that belongs to a DIFFERENT curriculum than the one selected", async () => {
      const prisma = makePrismaMock({ grade: gradeInCurriculumB });
      const service = new OnboardingService(prisma, mockQuestionGenerator);

      await expect(service.saveProfile("user-1", baseInput)).rejects.toThrow(BadRequestException);
    });

    it("rejects an unknown curriculum code", async () => {
      const prisma = makePrismaMock();
      prisma.client.curriculum.findUnique.mockResolvedValueOnce(null);
      const service = new OnboardingService(prisma, mockQuestionGenerator);

      await expect(service.saveProfile("user-1", baseInput)).rejects.toThrow(BadRequestException);
    });

    it("rejects when a submitted subject doesn't actually belong to the selected grade", async () => {
      // Student claims 2 subjects but only 1 is actually found under the grade.
      const prisma = makePrismaMock({ subjects: [subjectInGrade1] });
      const service = new OnboardingService(prisma, mockQuestionGenerator);

      await expect(
        service.saveProfile("user-1", { ...baseInput, subjectIds: ["subject-1", "subject-does-not-belong-here"] }),
      ).rejects.toThrow(BadRequestException);
    });

    it("accepts a valid grade+subject combination that actually belongs to the curriculum", async () => {
      const prisma = makePrismaMock();
      const service = new OnboardingService(prisma, mockQuestionGenerator);

      await expect(service.saveProfile("user-1", baseInput)).resolves.toBeDefined();
      expect(prisma.client.studentSubject.createMany).toHaveBeenCalled();
    });
  });

  /**
   * Student school info V1 (2026-09-25): governorate/area are passed
   * through as-is (no cross-entity check needed — they're plain scalars),
   * but schoolId is re-verified server-side against the real School table
   * rather than trusted from the client, matching the same
   * never-trust-the-frontend pattern as curriculum/grade/subject above.
   */
  describe("saveProfile — school info", () => {
    const activeSchool = { id: "school-1", governorate: "CAIRO", isActive: true };

    it("persists governorate and area as submitted", async () => {
      const prisma = makePrismaMock();
      const service = new OnboardingService(prisma, mockQuestionGenerator);

      await service.saveProfile("user-1", { ...baseInput, governorate: "CAIRO" as any, area: "Nasr City" });

      const upsertArgs = prisma.client.studentProfile.upsert.mock.calls[0][0];
      expect(upsertArgs.create.governorate).toBe("CAIRO");
      expect(upsertArgs.create.area).toBe("Nasr City");
    });

    it("persists a selected schoolId once the School is verified to exist and be active", async () => {
      const prisma = makePrismaMock({ school: activeSchool });
      const service = new OnboardingService(prisma, mockQuestionGenerator);

      await service.saveProfile("user-1", { ...baseInput, governorate: "CAIRO" as any, schoolId: "school-1" });

      const upsertArgs = prisma.client.studentProfile.upsert.mock.calls[0][0];
      expect(upsertArgs.create.schoolId).toBe("school-1");
      expect(upsertArgs.create.schoolNameManual).toBeNull();
    });

    it("persists a manually-entered school name when no schoolId is given", async () => {
      const prisma = makePrismaMock();
      const service = new OnboardingService(prisma, mockQuestionGenerator);

      await service.saveProfile("user-1", { ...baseInput, schoolNameManual: "My Unlisted School" });

      const upsertArgs = prisma.client.studentProfile.upsert.mock.calls[0][0];
      expect(upsertArgs.create.schoolId).toBeNull();
      expect(upsertArgs.create.schoolNameManual).toBe("My Unlisted School");
    });

    it("rejects a schoolId that does not exist in the School table", async () => {
      const prisma = makePrismaMock({ school: null });
      const service = new OnboardingService(prisma, mockQuestionGenerator);

      await expect(
        service.saveProfile("user-1", { ...baseInput, schoolId: "does-not-exist" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects a schoolId that references an inactive School", async () => {
      const prisma = makePrismaMock({ school: { ...activeSchool, isActive: false } });
      const service = new OnboardingService(prisma, mockQuestionGenerator);

      await expect(
        service.saveProfile("user-1", { ...baseInput, schoolId: "school-1" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects when the selected School's governorate doesn't match the submitted governorate", async () => {
      const prisma = makePrismaMock({ school: { ...activeSchool, governorate: "GIZA" } });
      const service = new OnboardingService(prisma, mockQuestionGenerator);

      await expect(
        service.saveProfile("user-1", { ...baseInput, governorate: "CAIRO" as any, schoolId: "school-1" }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  /**
   * Phase 10D.1: the diagnostic-availability fallback on the frontend is
   * driven entirely by `getDiagnosticQuestions()` returning an empty
   * array — so this query MUST exclude placeholder Questions (otherwise a
   * subject with only seed/demo content would incorrectly look
   * "available") and MUST stay scoped to the student's own selected
   * subjects via relational IDs, never a name match.
   */
  describe("getDiagnosticQuestions — Phase 10D.1 availability fallback", () => {
    function makeProfilePrismaMock(opts: { studentSubjects: any[]; findManyImpl?: (args: any) => any[] }) {
      const findMany = jest.fn().mockImplementation(opts.findManyImpl ?? (() => []));
      return {
        client: {
          studentProfile: { findUnique: jest.fn().mockResolvedValue({ id: "student-1" }) },
          studentSubject: { findMany: jest.fn().mockResolvedValue(opts.studentSubjects) },
          question: { findMany },
        },
      } as any;
    }

    const SUBJECT_WITH_TOPICS = {
      subjectId: "subject-math",
      subject: { units: [{ topics: [{ id: "topic-1" }, { id: "topic-2" }] }] },
    };

    it("CASE 7 — excludes isPlaceholder:true Questions from the query itself, not just a post-filter", async () => {
      const prisma = makeProfilePrismaMock({ studentSubjects: [SUBJECT_WITH_TOPICS] });
      const service = new OnboardingService(prisma, mockQuestionGenerator);

      await service.getDiagnosticQuestions("user-1");

      const call = prisma.client.question.findMany.mock.calls[0][0];
      expect(call.where).toEqual({ topicId: { in: ["topic-1", "topic-2"] }, isPlaceholder: false });
    });

    it("returns an empty array (not an error) when only placeholder Questions exist for the selected subjects", async () => {
      // The mock question.findMany applies the where clause itself, proving
      // the real filter — not just that some filter object was passed —
      // actually excludes placeholder rows.
      const ALL_QUESTIONS = [{ id: "q1", topicId: "topic-1", isPlaceholder: true }];
      const prisma = makeProfilePrismaMock({
        studentSubjects: [SUBJECT_WITH_TOPICS],
        findManyImpl: ({ where }: any) => ALL_QUESTIONS.filter((q) => where.topicId.in.includes(q.topicId) && q.isPlaceholder === where.isPlaceholder),
      });
      const service = new OnboardingService(prisma, mockQuestionGenerator);

      const result = await service.getDiagnosticQuestions("user-1");
      expect(result).toEqual([]);
    });

    it("CASE 8 — only queries topics under the student's own selected subjects, via relational IDs", async () => {
      const prisma = makeProfilePrismaMock({
        studentSubjects: [
          { subjectId: "subject-math", subject: { units: [{ topics: [{ id: "topic-math-1" }] }] } },
        ],
      });
      const service = new OnboardingService(prisma, mockQuestionGenerator);

      await service.getDiagnosticQuestions("user-1");

      const call = prisma.client.question.findMany.mock.calls[0][0];
      // Only the selected subject's own topic ids are ever in scope — a
      // topic belonging to some other, unselected subject is never included
      // because it was never in `studentSubjects` to begin with.
      expect(call.where.topicId.in).toEqual(["topic-math-1"]);
    });

    it("launch-speed lazy-generation (2026-09-19): ensures a pool for exactly one topic per selected subject (its first, by order) before querying, without blocking on every topic", async () => {
      mockQuestionGenerator.ensurePoolForTopic.mockClear();
      const prisma = makeProfilePrismaMock({
        studentSubjects: [
          { subjectId: "subject-math", subject: { units: [{ topics: [{ id: "topic-math-1" }, { id: "topic-math-2" }] }] } },
          { subjectId: "subject-eng", subject: { units: [{ topics: [{ id: "topic-eng-1" }] }] } },
        ],
      });
      const service = new OnboardingService(prisma, mockQuestionGenerator);

      await service.getDiagnosticQuestions("user-1");

      expect(mockQuestionGenerator.ensurePoolForTopic).toHaveBeenCalledTimes(2);
      expect(mockQuestionGenerator.ensurePoolForTopic).toHaveBeenCalledWith("topic-math-1", "user-1");
      expect(mockQuestionGenerator.ensurePoolForTopic).toHaveBeenCalledWith("topic-eng-1", "user-1");
    });
  });

  describe("studentOnboardingSchema — school info shape", () => {
    // Uses real cuid-format ids — baseInput's "grade-1"/"subject-1" are
    // fine for the mocked service-level tests above (which never run them
    // through the schema), but this schema is validated directly here.
    const validShapeInput = { ...baseInput, gradeId: "clh1111111111111111111111", subjectIds: ["clh2222222222222222222222"] };

    it("rejects a payload that sets BOTH schoolId and schoolNameManual", () => {
      const result = studentOnboardingSchema.safeParse({
        ...validShapeInput,
        schoolId: "clh1234567890123456789012",
        schoolNameManual: "Some School",
      });
      expect(result.success).toBe(false);
    });

    it("accepts a payload with neither schoolId nor schoolNameManual (manual fallback not used)", () => {
      const result = studentOnboardingSchema.safeParse(validShapeInput);
      expect(result.success).toBe(true);
    });

    it("accepts governorate/area/schoolNameManual together (no school selected from the list)", () => {
      const result = studentOnboardingSchema.safeParse({
        ...validShapeInput,
        governorate: "CAIRO",
        area: "Nasr City",
        schoolNameManual: "My Unlisted School",
      });
      expect(result.success).toBe(true);
    });

    it("rejects an unknown governorate code", () => {
      const result = studentOnboardingSchema.safeParse({ ...validShapeInput, governorate: "ATLANTIS" });
      expect(result.success).toBe(false);
    });
  });

  describe("submitDiagnostic — grading correctness", () => {
    function makeQuestion(id: string, subjectId: string, correctAnswer: string) {
      return {
        id,
        correctAnswerJson: correctAnswer,
        topic: { unit: { subject: { id: subjectId, nameEn: `Subject ${subjectId}`, nameAr: "مادة" } } },
      };
    }

    function makeDiagnosticPrismaMock(questions: any[]) {
      return {
        client: {
          studentProfile: { findUnique: jest.fn().mockResolvedValue({ id: "student-1" }) },
          question: { findMany: jest.fn().mockResolvedValue(questions) },
          questionAttempt: { createMany: jest.fn() },
          assessment: { create: jest.fn().mockResolvedValue({ id: "assessment-1" }) },
          learningPlan: { create: jest.fn().mockResolvedValue({ id: "plan-1" }) },
        },
      } as any;
    }

    it("scores each answer against the question's real correctAnswerJson, not the submitted answer blindly", async () => {
      const questions = [makeQuestion("q1", "subj-math", "A"), makeQuestion("q2", "subj-math", "B")];
      const prisma = makeDiagnosticPrismaMock(questions);
      const service = new OnboardingService(prisma, mockQuestionGenerator);

      const result = await service.submitDiagnostic("user-1", [
        { questionId: "q1", answer: "A" }, // correct
        { questionId: "q2", answer: "C" }, // incorrect (correct is "B")
      ]);

      expect(result.scoreJson["subj-math"].correct).toBe(1);
      expect(result.scoreJson["subj-math"].total).toBe(2);
      expect(result.scoreJson["subj-math"].percent).toBe(50);
    });

    it("breaks the score down per subject, not just overall", async () => {
      const questions = [
        makeQuestion("q1", "subj-math", "A"),
        makeQuestion("q2", "subj-science", "B"),
      ];
      const prisma = makeDiagnosticPrismaMock(questions);
      const service = new OnboardingService(prisma, mockQuestionGenerator);

      const result = await service.submitDiagnostic("user-1", [
        { questionId: "q1", answer: "A" }, // correct, math
        { questionId: "q2", answer: "X" }, // incorrect, science
      ]);

      expect(result.scoreJson["subj-math"].percent).toBe(100);
      expect(result.scoreJson["subj-science"].percent).toBe(0);
    });

    it("recommends the lowest-scoring subject(s) first in the generated plan", async () => {
      const questions = [
        makeQuestion("q1", "subj-math", "A"),
        makeQuestion("q2", "subj-math", "A"),
        makeQuestion("q3", "subj-science", "B"),
      ];
      const prisma = makeDiagnosticPrismaMock(questions);
      const service = new OnboardingService(prisma, mockQuestionGenerator);

      // Math: 0/2 correct (0%). Science: 1/1 correct (100%).
      const result = await service.submitDiagnostic("user-1", [
        { questionId: "q1", answer: "wrong" },
        { questionId: "q2", answer: "wrong" },
        { questionId: "q3", answer: "B" },
      ]);

      expect(result.planJson.recommendedFocus[0]).toBe("Subject subj-math");
      expect(result.planJson.generatedBy).toBe("rule_based_v1");
    });

    it("rejects an empty answer submission", async () => {
      const prisma = makeDiagnosticPrismaMock([]);
      const service = new OnboardingService(prisma, mockQuestionGenerator);

      await expect(service.submitDiagnostic("user-1", [])).rejects.toThrow(BadRequestException);
    });

    it("silently skips answers referencing a question ID that doesn't exist, rather than crashing", async () => {
      const prisma = makeDiagnosticPrismaMock([makeQuestion("q1", "subj-math", "A")]);
      const service = new OnboardingService(prisma, mockQuestionGenerator);

      const result = await service.submitDiagnostic("user-1", [
        { questionId: "q1", answer: "A" },
        { questionId: "does-not-exist", answer: "A" },
      ]);

      expect(result.scoreJson["subj-math"].total).toBe(1); // the bogus answer was not counted
    });
  });
});

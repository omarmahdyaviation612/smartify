import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { withReadyGate } from "../ai/context/topic-content-gate.fixtures.testspec";
import { QuizzesService } from "./quizzes.service";

/**
 * Covers ownership isolation for quiz results and subject access — a
 * student must not be able to read another student's quiz result by
 * guessing/enumerating result IDs, and must not be able to start a quiz
 * for a subject they haven't selected.
 */
describe("QuizzesService — authorization & ownership", () => {
  const studentProfile = { id: "student-1", subjects: [{ subjectId: "subject-1" }] };

  function makePrismaMock(overrides: Partial<{ quizResult: any }> = {}) {
    return {
      client: {
        studentProfile: { findUnique: jest.fn().mockResolvedValue(studentProfile) },
        quizResult: { findUnique: jest.fn().mockResolvedValue(overrides.quizResult) },
        topic: { findMany: jest.fn().mockResolvedValue([withReadyGate({ id: "topic-1" })]) },
      },
    } as any;
  }

  const topicAccuracy = {} as any;
  const questionGenerator = { ensurePoolForTopic: jest.fn() } as any;
  const emailService = { send: jest.fn().mockResolvedValue({ sent: true }) } as any;

  it("rejects fetching quiz questions for a subject the student never selected", async () => {
    const prisma = makePrismaMock();
    const service = new QuizzesService(prisma, topicAccuracy, questionGenerator, emailService);

    await expect(
      service.getQuizQuestions("user-1", "unrelated-subject", "mock_exam"),
    ).rejects.toThrow(ForbiddenException);
  });

  it("returns NotFoundException — not the other student's data — when a quiz result belongs to a different student", async () => {
    const prisma = makePrismaMock({ quizResult: { id: "result-1", studentId: "someone-elses-student-id" } });
    const service = new QuizzesService(prisma, topicAccuracy, questionGenerator, emailService);

    await expect(service.getResult("user-1", "result-1")).rejects.toThrow(NotFoundException);
  });

  it("returns NotFoundException when the quiz result doesn't exist at all (not a different error that leaks existence)", async () => {
    const prisma = makePrismaMock({ quizResult: null });
    const service = new QuizzesService(prisma, topicAccuracy, questionGenerator, emailService);

    await expect(service.getResult("user-1", "does-not-exist")).rejects.toThrow(NotFoundException);
  });

  it("returns the result when it genuinely belongs to the requesting student", async () => {
    const prisma = makePrismaMock({ quizResult: { id: "result-1", studentId: "student-1" } });
    const service = new QuizzesService(prisma, topicAccuracy, questionGenerator, emailService);

    await expect(service.getResult("user-1", "result-1")).resolves.toMatchObject({ id: "result-1" });
  });
});

/**
 * Phase 10E: placeholder containment, randomization, target counts, and
 * the insufficient-pool contract for Topic Quiz and Mock Exam selection.
 * Randomization is tested with a deterministic, injected `rng` — never a
 * statistical assertion against real Math.random(), so these tests can
 * never be flaky.
 */
describe("QuizzesService.getQuizQuestions — Phase 10E hardening", () => {
  const studentProfile = { id: "student-1", subjects: [{ subjectId: "subject-1" }] };
  const topicAccuracy = {} as any;
  const questionGenerator = { ensurePoolForTopic: jest.fn() } as any;
  const emailService = { send: jest.fn().mockResolvedValue({ sent: true }) } as any;

  function makePool(count: number, opts: { placeholder?: boolean } = {}) {
    return Array.from({ length: count }, (_, i) => ({
      id: `q${i + 1}`,
      topicId: "topic-1",
      type: "MULTIPLE_CHOICE",
      difficulty: "EASY",
      promptEn: `Question ${i + 1}`,
      promptAr: null,
      optionsJson: ["a", "b", "c"],
      isPlaceholder: opts.placeholder ?? false,
    }));
  }

  function makePrisma(questions: any[]) {
    return {
      client: {
        studentProfile: { findUnique: jest.fn().mockResolvedValue(studentProfile) },
        topic: { findMany: jest.fn().mockResolvedValue([withReadyGate({ id: "topic-1" })]) },
        question: { findMany: jest.fn().mockImplementation(async ({ where }: any) => questions.filter((q) => q.isPlaceholder === where.isPlaceholder)) },
      },
    } as any;
  }

  it("test 23/24: excludes isPlaceholder:true Questions from the query itself, for both topic_assessment and mock_exam", async () => {
    const prisma = makePrisma(makePool(5, { placeholder: true }));
    const service = new QuizzesService(prisma, topicAccuracy, questionGenerator, emailService);

    const topicResult = await service.getQuizQuestions("user-1", "subject-1", "topic_assessment", "topic-1");
    expect(topicResult.questions).toHaveLength(0);
    expect(prisma.client.question.findMany.mock.calls[0][0].where).toMatchObject({ isPlaceholder: false });

    const mockResult = await service.getQuizQuestions("user-1", "subject-1", "mock_exam");
    expect(mockResult.questions).toHaveLength(0);
  });

  it("test 26: Topic Quiz randomizes the eligible pool before selecting (deterministic rng)", async () => {
    const pool = makePool(8);
    const prisma = makePrisma(pool);
    const service = new QuizzesService(prisma, topicAccuracy, questionGenerator, emailService);

    // A fixed sequence, not Math.random — deterministic, never flaky.
    const fixedSequence = [0.9, 0.1, 0.8, 0.2, 0.7, 0.3, 0.6, 0.05];
    let i = 0;
    const rng = () => fixedSequence[i++ % fixedSequence.length];

    const result = await service.getQuizQuestions("user-1", "subject-1", "topic_assessment", "topic-1", rng);

    expect(result.questions.map((q) => q.id).sort()).toEqual(pool.map((q) => q.id).sort()); // no data loss
    expect(result.questions.map((q) => q.id)).not.toEqual(pool.map((q) => q.id)); // order actually changed
  });

  it("test 27: Mock Exam randomizes the eligible pool before selecting (deterministic rng)", async () => {
    const pool = makePool(25);
    const prisma = makePrisma(pool);
    const service = new QuizzesService(prisma, topicAccuracy, questionGenerator, emailService);

    let seed = 1;
    const rng = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

    const result = await service.getQuizQuestions("user-1", "subject-1", "mock_exam", undefined, rng);

    const firstTwentyIds = pool.slice(0, 20).map((q) => q.id);
    expect(result.questions.map((q) => q.id)).not.toEqual(firstTwentyIds);
  });

  it("test 28: Topic Quiz target remains 8", async () => {
    const prisma = makePrisma(makePool(30));
    const service = new QuizzesService(prisma, topicAccuracy, questionGenerator, emailService);
    const result = await service.getQuizQuestions("user-1", "subject-1", "topic_assessment", "topic-1");
    expect(result.requestedCount).toBe(8);
    expect(result.questions).toHaveLength(8);
  });

  it("test 29: Mock Exam target remains 20", async () => {
    const prisma = makePrisma(makePool(30));
    const service = new QuizzesService(prisma, topicAccuracy, questionGenerator, emailService);
    const result = await service.getQuizQuestions("user-1", "subject-1", "mock_exam");
    expect(result.requestedCount).toBe(20);
    expect(result.questions).toHaveLength(20);
  });

  it("test 30: zero eligible Questions remains safe — no crash, empty result", async () => {
    const prisma = makePrisma([]);
    const service = new QuizzesService(prisma, topicAccuracy, questionGenerator, emailService);
    const result = await service.getQuizQuestions("user-1", "subject-1", "topic_assessment", "topic-1");
    expect(result.questions).toEqual([]);
    expect(result.availableCount).toBe(0);
    expect(result.isFullAssessment).toBe(false);
  });

  it("test 31: an insufficient pool is honestly represented — requestedCount/availableCount/returnedCount/isFullAssessment", async () => {
    const prisma = makePrisma(makePool(3));
    const service = new QuizzesService(prisma, topicAccuracy, questionGenerator, emailService);
    const result = await service.getQuizQuestions("user-1", "subject-1", "topic_assessment", "topic-1");

    expect(result).toMatchObject({ requestedCount: 8, availableCount: 3, returnedCount: 3, isFullAssessment: false });
    expect(result.questions).toHaveLength(3);
  });

  it("a full pool is honestly represented as isFullAssessment: true", async () => {
    const prisma = makePrisma(makePool(20));
    const service = new QuizzesService(prisma, topicAccuracy, questionGenerator, emailService);
    const result = await service.getQuizQuestions("user-1", "subject-1", "mock_exam");
    expect(result.isFullAssessment).toBe(true);
    expect(result.returnedCount).toBe(20);
  });
});

/**
 * Launch-speed addition (2026-09-19): "lesson_check" is the short
 * post-lesson understanding check — the ONE quiz type that emails a
 * linked parent with the result. Every other quiz type (topic_assessment,
 * mock_exam) is student-initiated practice and must never trigger that
 * email, even though they all share the same submitQuiz() code path.
 */
describe("QuizzesService.submitQuiz — lesson_check parent notification", () => {
  const studentProfile = { id: "student-1", fullName: "Test Student", subjects: [{ subjectId: "subject-1" }] };

  function makeQuestions() {
    return [
      { id: "q1", topicId: "topic-1", promptEn: "Q1", correctAnswerJson: "a", explanationEn: null, explanationAr: null, topic: withReadyGate({ id: "topic-1", nameEn: "Fractions", nameAr: "الكسور", unit: { subjectId: "subject-1" } }) },
      { id: "q2", topicId: "topic-1", promptEn: "Q2", correctAnswerJson: "b", explanationEn: null, explanationAr: null, topic: withReadyGate({ id: "topic-1", nameEn: "Fractions", nameAr: "الكسور", unit: { subjectId: "subject-1" } }) },
    ];
  }

  function makePrisma(opts: { relations?: any[] } = {}) {
    const quizResultCreate = jest.fn().mockImplementation(async ({ data }: any) => ({ id: "result-1", ...data }));
    return {
      client: {
        studentProfile: { findUnique: jest.fn().mockResolvedValue(studentProfile) },
        question: { findMany: jest.fn().mockResolvedValue(makeQuestions()) },
        questionAttempt: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
        quizResult: { create: quizResultCreate },
        parentStudentRelation: {
          findMany: jest.fn().mockResolvedValue(
            opts.relations ?? [
              { parentId: "parent-1", parent: { fullName: "Parent One", user: { email: "parent1@example.com" } } },
            ],
          ),
        },
      },
    } as any;
  }

  const ANSWERS = [{ questionId: "q1", answer: "a" }, { questionId: "q2", answer: "b" }];

  it("emails every linked parent for a lesson_check submission and reports how many were notified", async () => {
    const prisma = makePrisma();
    const emailService = { send: jest.fn().mockResolvedValue({ sent: true }) } as any;
    const service = new QuizzesService(prisma, {} as any, { ensurePoolForTopic: jest.fn() } as any, emailService);

    const result = await service.submitQuiz("user-1", { subjectId: "subject-1", type: "lesson_check", topicId: "topic-1", answers: ANSWERS });

    expect(emailService.send).toHaveBeenCalledTimes(1);
    expect(emailService.send).toHaveBeenCalledWith(expect.objectContaining({ to: "parent1@example.com" }));
    expect((result as any).parentsNotified).toBe(1);
    expect(prisma.client.quizResult.create.mock.calls[0][0].data.topicId).toBe("topic-1");
  });

  it("never emails anyone for topic_assessment or mock_exam, even with a parent linked", async () => {
    const prisma = makePrisma();
    const emailService = { send: jest.fn().mockResolvedValue({ sent: true }) } as any;
    const service = new QuizzesService(prisma, {} as any, { ensurePoolForTopic: jest.fn() } as any, emailService);

    const result = await service.submitQuiz("user-1", { subjectId: "subject-1", type: "topic_assessment", topicId: "topic-1", answers: ANSWERS });

    expect(emailService.send).not.toHaveBeenCalled();
    expect((result as any).parentsNotified).toBe(0);
    expect(prisma.client.quizResult.create.mock.calls[0][0].data.topicId).toBeNull();
  });

  it("is a safe no-op (0 notified, no crash) when the student has no linked parent", async () => {
    const prisma = makePrisma({ relations: [] });
    const emailService = { send: jest.fn().mockResolvedValue({ sent: true }) } as any;
    const service = new QuizzesService(prisma, {} as any, { ensurePoolForTopic: jest.fn() } as any, emailService);

    const result = await service.submitQuiz("user-1", { subjectId: "subject-1", type: "lesson_check", topicId: "topic-1", answers: ANSWERS });

    expect(emailService.send).not.toHaveBeenCalled();
    expect((result as any).parentsNotified).toBe(0);
  });

  it("still returns a normal result even when Resend/EmailService fails", async () => {
    const prisma = makePrisma();
    const emailService = { send: jest.fn().mockRejectedValue(new Error("Resend down")) } as any;
    const service = new QuizzesService(prisma, {} as any, { ensurePoolForTopic: jest.fn() } as any, emailService);

    const result = await service.submitQuiz("user-1", { subjectId: "subject-1", type: "lesson_check", topicId: "topic-1", answers: ANSWERS });

    expect((result as any).parentsNotified).toBe(0);
    expect((result as any).score).toBe(100);
  });
});

/**
 * Correctness hardening (2026-09-20) — submitQuiz() grading correctness was
 * only partially covered before this suite (the existing describes above
 * exercise ownership on the READ path, randomization, and the
 * lesson_check email trigger, but not grading/scoring/QuizResult content
 * itself). Answer shapes are a single string (the only real shape the
 * schema/validator produce today — see practice.service.spec.ts's own
 * note on this, not repeated here) — no invented answer types.
 */
describe("QuizzesService.submitQuiz — grading, scoring & persistence", () => {
  const studentProfile = { id: "student-1", fullName: "Test Student", subjects: [{ subjectId: "subject-1" }] };

  // Two topics, both under the same owned "subject-1", so score/weak-topic/
  // recommendation logic is genuinely exercised, not just a single-topic
  // degenerate case. topic.unit.subjectId is what submitQuiz's question-
  // scope validation (2026-09-20) actually reads.
  const Q1 = { id: "q1", topicId: "t-fractions", correctAnswerJson: "a", promptEn: "Q1", explanationEn: null, explanationAr: null, topic: withReadyGate({ id: "t-fractions", nameEn: "Fractions", nameAr: "الكسور", unit: { subjectId: "subject-1" } }) };
  const Q2 = { id: "q2", topicId: "t-fractions", correctAnswerJson: "b", promptEn: "Q2", explanationEn: null, explanationAr: null, topic: withReadyGate({ id: "t-fractions", nameEn: "Fractions", nameAr: "الكسور", unit: { subjectId: "subject-1" } }) };
  const Q3 = { id: "q3", topicId: "t-decimals", correctAnswerJson: "c", promptEn: "Q3", explanationEn: null, explanationAr: null, topic: withReadyGate({ id: "t-decimals", nameEn: "Decimals", nameAr: "الكسور العشرية", unit: { subjectId: "subject-1" } }) };

  function makePrisma(opts: { questions?: any[]; profile?: any } = {}) {
    const attemptCreateMany = jest.fn().mockResolvedValue({ count: 0 });
    const quizResultCreate = jest.fn().mockImplementation(async ({ data }: any) => ({ id: "result-1", ...data }));
    const questionFindMany = jest.fn().mockResolvedValue(opts.questions ?? [Q1, Q2, Q3]);
    const prisma = {
      client: {
        studentProfile: { findUnique: jest.fn().mockResolvedValue("profile" in opts ? opts.profile : studentProfile) },
        question: { findMany: questionFindMany },
        questionAttempt: { createMany: attemptCreateMany },
        quizResult: { create: quizResultCreate },
        parentStudentRelation: { findMany: jest.fn().mockResolvedValue([]) },
      },
    } as any;
    return { prisma, attemptCreateMany, quizResultCreate, questionFindMany };
  }

  const noEmail = { send: jest.fn().mockResolvedValue({ sent: true }) } as any;
  const noGenerator = { ensurePoolForTopic: jest.fn() } as any;

  it("A: an all-correct quiz scores 100, persists 3 correct QuestionAttempt rows, and a matching QuizResult", async () => {
    const { prisma, attemptCreateMany, quizResultCreate } = makePrisma();
    const service = new QuizzesService(prisma, {} as any, noGenerator, noEmail);

    const result = await service.submitQuiz("user-1", {
      subjectId: "subject-1",
      type: "topic_assessment",
      topicId: "t-fractions",
      answers: [{ questionId: "q1", answer: "a" }, { questionId: "q2", answer: "b" }, { questionId: "q3", answer: "c" }],
    });

    expect(result.score).toBe(100);
    expect(result.correctCount).toBe(3);
    expect(result.total).toBe(3);
    expect(attemptCreateMany.mock.calls[0][0].data.every((r: any) => r.isCorrect === true)).toBe(true);
    expect(quizResultCreate.mock.calls[0][0].data).toMatchObject({ studentId: "student-1", quizType: "topic_assessment", score: 100, correctCount: 3, totalQuestions: 3 });
  });

  it("B: a mixed-correctness quiz computes the exact score and identifies the weak topic within this quiz", async () => {
    const { prisma, quizResultCreate } = makePrisma();
    const service = new QuizzesService(prisma, {} as any, noGenerator, noEmail);

    // q1 correct, q2 wrong (both Fractions -> 1/2 = 50% < 60%), q3 correct (Decimals -> 100%).
    const result = await service.submitQuiz("user-1", {
      subjectId: "subject-1",
      type: "topic_assessment",
      topicId: "t-fractions",
      answers: [{ questionId: "q1", answer: "a" }, { questionId: "q2", answer: "WRONG" }, { questionId: "q3", answer: "c" }],
    });

    expect(result.correctCount).toBe(2);
    expect(result.score).toBe(Math.round((2 / 3) * 100)); // 67
    expect(result.weakTopicsInQuiz).toEqual([expect.objectContaining({ nameEn: "Fractions", percent: 50 })]);
    expect(result.recommendedNextSteps[0]).toMatch(/Fractions/);
    expect(quizResultCreate.mock.calls[0][0].data.score).toBe(67);
  });

  it("C: an all-incorrect quiz scores 0 and flags every topic as weak", async () => {
    const { prisma, quizResultCreate } = makePrisma();
    const service = new QuizzesService(prisma, {} as any, noGenerator, noEmail);

    const result = await service.submitQuiz("user-1", {
      subjectId: "subject-1",
      type: "topic_assessment",
      topicId: "t-fractions",
      answers: [{ questionId: "q1", answer: "x" }, { questionId: "q2", answer: "x" }, { questionId: "q3", answer: "x" }],
    });

    expect(result.score).toBe(0);
    expect(result.correctCount).toBe(0);
    expect(result.weakTopicsInQuiz.map((t) => t.nameEn).sort()).toEqual(["Decimals", "Fractions"]);
    expect(quizResultCreate.mock.calls[0][0].data.score).toBe(0);
  });

  it("D/E: each submitted answer is matched by questionId and graded against THAT question's own correctAnswerJson, never a neighboring question's key", async () => {
    const { prisma, attemptCreateMany } = makePrisma({ questions: [Q1, Q2] }); // both Fractions, different keys "a"/"b"
    const service = new QuizzesService(prisma, {} as any, noGenerator, noEmail);

    // Submitted answers are swapped relative to each question's real key.
    const result = await service.submitQuiz("user-1", {
      subjectId: "subject-1",
      type: "topic_assessment",
      topicId: "t-fractions",
      answers: [{ questionId: "q1", answer: "b" }, { questionId: "q2", answer: "a" }],
    });

    const byId = new Map(result.breakdown.map((b) => [b.questionId, b]));
    expect(byId.get("q1")).toMatchObject({ isCorrect: false, correctAnswer: "a" });
    expect(byId.get("q2")).toMatchObject({ isCorrect: false, correctAnswer: "b" });

    const rowsById = new Map(attemptCreateMany.mock.calls[0][0].data.map((r: any) => [r.questionId, r]));
    expect(rowsById.get("q1")).toMatchObject({ answerJson: "b", isCorrect: false });
    expect(rowsById.get("q2")).toMatchObject({ answerJson: "a", isCorrect: false });
  });

  it("F: persisted QuestionAttempt rows use source \"quiz\" (distinct from Practice's \"practice\")", async () => {
    const { prisma, attemptCreateMany } = makePrisma({ questions: [Q1] });
    const service = new QuizzesService(prisma, {} as any, noGenerator, noEmail);

    await service.submitQuiz("user-1", { subjectId: "subject-1", type: "topic_assessment", topicId: "t-fractions", answers: [{ questionId: "q1", answer: "a" }] });

    expect(attemptCreateMany.mock.calls[0][0].data[0].source).toBe("quiz");
  });

  it("G: QuizResult persists student/scope/score/breakdown/weakTopics/recommendedNextSteps exactly as computed", async () => {
    const { prisma, quizResultCreate } = makePrisma();
    const service = new QuizzesService(prisma, {} as any, noGenerator, noEmail);

    const result = await service.submitQuiz("user-1", {
      subjectId: "subject-1",
      type: "mock_exam",
      answers: [{ questionId: "q1", answer: "a" }, { questionId: "q2", answer: "WRONG" }, { questionId: "q3", answer: "c" }],
    });

    const persisted = quizResultCreate.mock.calls[0][0].data;
    expect(persisted.studentId).toBe("student-1");
    expect(persisted.quizType).toBe("mock_exam");
    expect(persisted.topicId).toBeNull(); // only lesson_check ever sets topicId — see the existing describe block above
    expect(persisted.resultJson.breakdown).toHaveLength(3);
    expect(persisted.resultJson.weakTopicsInQuiz).toEqual(result.weakTopicsInQuiz);
    expect(persisted.resultJson.recommendedNextSteps).toEqual(result.recommendedNextSteps);
  });

  it("H (ownership): rejects submission for a subject the student never selected — before any grading/persistence", async () => {
    const { prisma, attemptCreateMany, quizResultCreate, questionFindMany } = makePrisma();
    const service = new QuizzesService(prisma, {} as any, noGenerator, noEmail);

    await expect(
      service.submitQuiz("user-1", { subjectId: "unrelated-subject", type: "topic_assessment", topicId: "t-fractions", answers: [{ questionId: "q1", answer: "a" }] }),
    ).rejects.toThrow(ForbiddenException);
    expect(questionFindMany).not.toHaveBeenCalled();
    expect(attemptCreateMany).not.toHaveBeenCalled();
    expect(quizResultCreate).not.toHaveBeenCalled();
  });

  it("H (question-scope, 2026-09-20 fix): a Question whose REAL Subject differs from input.subjectId is rejected with ForbiddenException, even though input.subjectId itself is genuinely owned — assertSubjectOwned alone was never sufficient", async () => {
    // The student owns "subject-1" and correctly passes it as input.subjectId,
    // but q-other-subject's real Topic/Unit chain belongs to a different
    // subject entirely.
    const otherSubjectQuestion = { id: "q-other", topicId: "topic-in-a-different-subject", correctAnswerJson: "z", promptEn: "Q", explanationEn: null, explanationAr: null, topic: withReadyGate({ id: "topic-in-a-different-subject", nameEn: "Unrelated Topic", nameAr: "غير ذلك", unit: { subjectId: "a-different-subject" } }) };
    const { prisma, attemptCreateMany, quizResultCreate } = makePrisma({ questions: [otherSubjectQuestion] });
    const emailService = { send: jest.fn().mockResolvedValue({ sent: true }) } as any;
    const service = new QuizzesService(prisma, {} as any, noGenerator, emailService);

    await expect(
      service.submitQuiz("user-1", { subjectId: "subject-1", type: "topic_assessment", topicId: "t-fractions", answers: [{ questionId: "q-other", answer: "z" }] }),
    ).rejects.toThrow(ForbiddenException);
    expect(attemptCreateMany).not.toHaveBeenCalled();
    expect(quizResultCreate).not.toHaveBeenCalled();
    expect(emailService.send).not.toHaveBeenCalled();
  });

  it("H (question-scope, mixed): one Question genuinely in-scope + one from a foreign Subject rejects the ENTIRE quiz atomically — zero QuestionAttempt writes, zero QuizResult, zero parent email, even for lesson_check", async () => {
    const foreignQuestion = { id: "q-foreign", topicId: "topic-foreign", correctAnswerJson: "z", promptEn: "Q", explanationEn: null, explanationAr: null, topic: withReadyGate({ id: "topic-foreign", nameEn: "Foreign", nameAr: "أجنبي", unit: { subjectId: "a-different-subject" } }) };
    const { prisma, attemptCreateMany, quizResultCreate } = makePrisma({ questions: [Q1, foreignQuestion] });
    const emailService = { send: jest.fn().mockResolvedValue({ sent: true }) } as any;
    const service = new QuizzesService(prisma, {} as any, noGenerator, emailService);

    await expect(
      service.submitQuiz("user-1", {
        subjectId: "subject-1",
        type: "lesson_check",
        topicId: "t-fractions",
        answers: [{ questionId: "q1", answer: "a" }, { questionId: "q-foreign", answer: "z" }],
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(attemptCreateMany).not.toHaveBeenCalled();
    expect(quizResultCreate).not.toHaveBeenCalled();
    expect(emailService.send).not.toHaveBeenCalled();
  });

  it("I: an empty submission is rejected explicitly with BadRequestException, after ownership is checked", async () => {
    const { prisma, questionFindMany } = makePrisma();
    const service = new QuizzesService(prisma, {} as any, noGenerator, noEmail);

    await expect(service.submitQuiz("user-1", { subjectId: "subject-1", type: "topic_assessment", topicId: "t-fractions", answers: [] })).rejects.toThrow(BadRequestException);
    expect(questionFindMany).not.toHaveBeenCalled();

    // Ownership is still checked even for an empty submission — an unrelated subject fails with ForbiddenException, not BadRequestException.
    await expect(service.submitQuiz("user-1", { subjectId: "unrelated-subject", type: "topic_assessment", answers: [] })).rejects.toThrow(ForbiddenException);
  });

  it("J — CHARACTERIZATION (not a fix): an unknown/nonexistent questionId is silently dropped from grading, scoring, and persistence — matches Practice's identical behavior", async () => {
    const { prisma, attemptCreateMany } = makePrisma({ questions: [Q1] });
    const service = new QuizzesService(prisma, {} as any, noGenerator, noEmail);

    const result = await service.submitQuiz("user-1", {
      subjectId: "subject-1",
      type: "topic_assessment",
      topicId: "t-fractions",
      answers: [{ questionId: "q1", answer: "a" }, { questionId: "does-not-exist", answer: "anything" }],
    });

    expect(result.total).toBe(1);
    expect(result.breakdown).toHaveLength(1);
    expect(attemptCreateMany.mock.calls[0][0].data).toHaveLength(1);
  });

  it("cross-student isolation: two students submitting in sequence each get their own correctly-scoped QuizResult, with no bleed between them", async () => {
    const { prisma: prismaA, quizResultCreate: createA } = makePrisma({ profile: { id: "student-A", fullName: "A", subjects: [{ subjectId: "subject-1" }] } });
    const resultA = await new QuizzesService(prismaA, {} as any, noGenerator, noEmail).submitQuiz("user-A", {
      subjectId: "subject-1",
      type: "topic_assessment",
      topicId: "t-fractions",
      answers: [{ questionId: "q1", answer: "a" }, { questionId: "q2", answer: "b" }, { questionId: "q3", answer: "c" }],
    });

    const { prisma: prismaB, quizResultCreate: createB } = makePrisma({ profile: { id: "student-B", fullName: "B", subjects: [{ subjectId: "subject-1" }] } });
    const resultB = await new QuizzesService(prismaB, {} as any, noGenerator, noEmail).submitQuiz("user-B", {
      subjectId: "subject-1",
      type: "topic_assessment",
      topicId: "t-fractions",
      answers: [{ questionId: "q1", answer: "WRONG" }, { questionId: "q2", answer: "WRONG" }, { questionId: "q3", answer: "WRONG" }],
    });

    expect(createA.mock.calls[0][0].data.studentId).toBe("student-A");
    expect(createB.mock.calls[0][0].data.studentId).toBe("student-B");
    expect(resultA.score).toBe(100);
    expect(resultB.score).toBe(0); // B's all-wrong submission never affects A's already-recorded 100
  });
});

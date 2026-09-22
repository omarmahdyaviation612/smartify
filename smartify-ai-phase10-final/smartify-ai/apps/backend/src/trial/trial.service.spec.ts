import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { TrialService } from "./trial.service";

/**
 * Free Trial V1 (2026-09-20) — TrialService is the sole gate for "which
 * two Subjects did this student pick, and has their one free lesson in
 * each been used yet". Concurrency safety is modeled here the same way
 * billing-webhook-retry.spec.ts models it: an in-memory store whose
 * `create` calls enforce the real DB unique constraints
 * (LessonTrial.studentId, LessonTrialConsumption.[trialId,subjectId]) by
 * throwing a P2002-coded error, exactly like Postgres would — proving the
 * SERVICE logic never relies on a read-then-write window that a real
 * unique constraint wouldn't also close.
 */
describe("TrialService", () => {
  const P2002 = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

  function makeHarness(opts: { gradeId?: string; subjects?: Array<{ id: string; gradeId: string; isActive: boolean }> } = {}) {
    const gradeId = opts.gradeId ?? "grade-1";
    const profile = { id: "student-1", userId: "user-1", gradeId };
    const subjects = opts.subjects ?? [
      { id: "subject-math", gradeId, isActive: true },
      { id: "subject-science", gradeId, isActive: true },
      { id: "subject-other-grade", gradeId: "grade-2", isActive: true },
    ];

    let trialsByStudentId = new Map<string, { id: string; studentId: string; subjectIds: string[] }>();
    let consumptionsByKey = new Map<string, { id: string; trialId: string; studentId: string; subjectId: string; topicId: string }>();
    let trialCounter = 0;
    let consumptionCounter = 0;

    const prisma = {
      client: {
        studentProfile: { findUnique: jest.fn().mockResolvedValue(profile) },
        subject: {
          findMany: jest.fn().mockImplementation(async ({ where }: any) => {
            const ids: string[] = where.id.in;
            return subjects.filter((s) => ids.includes(s.id) && s.gradeId === where.gradeId && s.isActive === where.isActive);
          }),
        },
        lessonTrial: {
          findUnique: jest.fn().mockImplementation(async ({ where, include }: any) => {
            const trial = trialsByStudentId.get(where.studentId);
            if (!trial) return null;
            if (include?.consumptions) {
              return { ...trial, consumptions: [...consumptionsByKey.values()].filter((c) => c.trialId === trial.id) };
            }
            return trial;
          }),
          create: jest.fn().mockImplementation(async ({ data }: any) => {
            if (trialsByStudentId.has(data.studentId)) throw P2002();
            const trial = { id: `trial-${++trialCounter}`, studentId: data.studentId, subjectIds: data.subjectIds };
            trialsByStudentId.set(data.studentId, trial);
            return trial;
          }),
        },
        lessonTrialConsumption: {
          create: jest.fn().mockImplementation(async ({ data }: any) => {
            const key = `${data.trialId}:${data.subjectId}`;
            if (consumptionsByKey.has(key)) throw P2002();
            const consumption = { id: `consumption-${++consumptionCounter}`, ...data };
            consumptionsByKey.set(key, consumption);
            return consumption;
          }),
          delete: jest.fn().mockImplementation(async ({ where }: any) => {
            const entry = [...consumptionsByKey.entries()].find(([, v]) => v.id === where.id);
            if (entry) consumptionsByKey.delete(entry[0]);
          }),
        },
      },
    } as any;

    return { service: new TrialService(prisma), prisma, profile };
  }

  describe("selectSubjects", () => {
    it("accepts exactly two different subjects within the student's own grade", async () => {
      const h = makeHarness();
      const result = await h.service.selectSubjects("user-1", ["subject-math", "subject-science"]);
      expect(result.selected).toBe(true);
      expect(result.subjects.map((s) => s.subjectId).sort()).toEqual(["subject-math", "subject-science"]);
    });

    it("rejects fewer than two subjects", async () => {
      const h = makeHarness();
      await expect(h.service.selectSubjects("user-1", ["subject-math"])).rejects.toThrow(BadRequestException);
    });

    it("rejects duplicate subject ids (not genuinely two different subjects)", async () => {
      const h = makeHarness();
      await expect(h.service.selectSubjects("user-1", ["subject-math", "subject-math"])).rejects.toThrow(BadRequestException);
    });

    it("rejects a subject outside the student's own grade — never trusts the client's subjectId alone", async () => {
      const h = makeHarness();
      await expect(h.service.selectSubjects("user-1", ["subject-math", "subject-other-grade"])).rejects.toThrow(BadRequestException);
    });

    it("cannot be changed once set — a second call is rejected even with different subjects", async () => {
      const h = makeHarness();
      await h.service.selectSubjects("user-1", ["subject-math", "subject-science"]);
      await expect(h.service.selectSubjects("user-1", ["subject-science", "subject-math"])).rejects.toThrow(ForbiddenException);
    });

    it("concurrency: two simultaneous selection attempts for the same student can only have one winner", async () => {
      const h = makeHarness();
      const results = await Promise.allSettled([
        h.service.selectSubjects("user-1", ["subject-math", "subject-science"]),
        h.service.selectSubjects("user-1", ["subject-math", "subject-science"]),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      expect(fulfilled.length).toBe(1);
    });

    it("requires onboarding to have completed first", async () => {
      const h = makeHarness();
      h.prisma.client.studentProfile.findUnique.mockResolvedValueOnce(null);
      await expect(h.service.selectSubjects("user-1", ["subject-math", "subject-science"])).rejects.toThrow(NotFoundException);
    });
  });

  describe("reserveLessonTrial", () => {
    it("rejects a student who never selected trial subjects", async () => {
      const h = makeHarness();
      await expect(h.service.reserveLessonTrial("student-1", "subject-math", "topic-1")).rejects.toThrow(ForbiddenException);
    });

    it("rejects a subject that isn't one of the student's two selected trial subjects — never auto-picks", async () => {
      const h = makeHarness();
      await h.service.selectSubjects("user-1", ["subject-math", "subject-science"]);
      await expect(h.service.reserveLessonTrial("student-1", "subject-other-grade", "topic-1")).rejects.toThrow(ForbiddenException);
    });

    it("grants exactly one free lesson per selected subject", async () => {
      const h = makeHarness();
      await h.service.selectSubjects("user-1", ["subject-math", "subject-science"]);
      const math = await h.service.reserveLessonTrial("student-1", "subject-math", "topic-math-1");
      const science = await h.service.reserveLessonTrial("student-1", "subject-science", "topic-science-1");
      expect(math.source).toBe("lesson-trial");
      expect(science.source).toBe("lesson-trial");
    });

    it("blocks a second lesson in the SAME subject, even a different topic — never 2 lessons per subject", async () => {
      const h = makeHarness();
      await h.service.selectSubjects("user-1", ["subject-math", "subject-science"]);
      await h.service.reserveLessonTrial("student-1", "subject-math", "topic-math-1");
      await expect(h.service.reserveLessonTrial("student-1", "subject-math", "topic-math-2")).rejects.toThrow(ForbiddenException);
    });

    it("a third free lesson (both subjects already consumed) is impossible", async () => {
      const h = makeHarness();
      await h.service.selectSubjects("user-1", ["subject-math", "subject-science"]);
      await h.service.reserveLessonTrial("student-1", "subject-math", "topic-math-1");
      await h.service.reserveLessonTrial("student-1", "subject-science", "topic-science-1");
      await expect(h.service.reserveLessonTrial("student-1", "subject-math", "topic-math-3")).rejects.toThrow(ForbiddenException);
      await expect(h.service.reserveLessonTrial("student-1", "subject-science", "topic-science-3")).rejects.toThrow(ForbiddenException);
    });

    it("concurrency: two simultaneous reservation attempts for the same subject cannot both succeed", async () => {
      const h = makeHarness();
      await h.service.selectSubjects("user-1", ["subject-math", "subject-science"]);
      const results = await Promise.allSettled([
        h.service.reserveLessonTrial("student-1", "subject-math", "topic-math-1"),
        h.service.reserveLessonTrial("student-1", "subject-math", "topic-math-2"),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      expect(fulfilled.length).toBe(1);
    });
  });

  describe("isTopicTrialAccessible / isSubjectTrialBrowsable", () => {
    it("grants topic access only for the exact Topic the free lesson was actually used on", async () => {
      const h = makeHarness();
      await h.service.selectSubjects("user-1", ["subject-math", "subject-science"]);
      await h.service.reserveLessonTrial("student-1", "subject-math", "topic-math-1");

      expect(await h.service.isTopicTrialAccessible("student-1", "subject-math", "topic-math-1")).toBe(true);
      expect(await h.service.isTopicTrialAccessible("student-1", "subject-math", "topic-math-2")).toBe(false);
    });

    it("allows browsing an unconsumed selected trial subject's topics", async () => {
      const h = makeHarness();
      await h.service.selectSubjects("user-1", ["subject-math", "subject-science"]);
      expect(await h.service.isSubjectTrialBrowsable("student-1", "subject-math")).toBe(true);
      expect(await h.service.isSubjectTrialBrowsable("student-1", "subject-other-grade")).toBe(false);
    });

    it("fails closed (returns false, never throws) when the underlying data can't be read", async () => {
      const brokenPrisma = { client: {} } as any;
      const service = new TrialService(brokenPrisma);
      await expect(service.isSubjectTrialBrowsable("student-1", "subject-math")).resolves.toBe(false);
      await expect(service.isTopicTrialAccessible("student-1", "subject-math", "topic-1")).resolves.toBe(false);
    });
  });
});

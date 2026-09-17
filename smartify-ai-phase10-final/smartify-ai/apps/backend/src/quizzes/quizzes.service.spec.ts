import { ForbiddenException, NotFoundException } from "@nestjs/common";
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
        topic: { findMany: jest.fn().mockResolvedValue([{ id: "topic-1" }]) },
      },
    } as any;
  }

  const topicAccuracy = {} as any;

  it("rejects fetching quiz questions for a subject the student never selected", async () => {
    const prisma = makePrismaMock();
    const service = new QuizzesService(prisma, topicAccuracy);

    await expect(
      service.getQuizQuestions("user-1", "unrelated-subject", "mock_exam"),
    ).rejects.toThrow(ForbiddenException);
  });

  it("returns NotFoundException — not the other student's data — when a quiz result belongs to a different student", async () => {
    const prisma = makePrismaMock({ quizResult: { id: "result-1", studentId: "someone-elses-student-id" } });
    const service = new QuizzesService(prisma, topicAccuracy);

    await expect(service.getResult("user-1", "result-1")).rejects.toThrow(NotFoundException);
  });

  it("returns NotFoundException when the quiz result doesn't exist at all (not a different error that leaks existence)", async () => {
    const prisma = makePrismaMock({ quizResult: null });
    const service = new QuizzesService(prisma, topicAccuracy);

    await expect(service.getResult("user-1", "does-not-exist")).rejects.toThrow(NotFoundException);
  });

  it("returns the result when it genuinely belongs to the requesting student", async () => {
    const prisma = makePrismaMock({ quizResult: { id: "result-1", studentId: "student-1" } });
    const service = new QuizzesService(prisma, topicAccuracy);

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
        topic: { findMany: jest.fn().mockResolvedValue([{ id: "topic-1" }]) },
        question: { findMany: jest.fn().mockImplementation(async ({ where }: any) => questions.filter((q) => q.isPlaceholder === where.isPlaceholder)) },
      },
    } as any;
  }

  it("test 23/24: excludes isPlaceholder:true Questions from the query itself, for both topic_assessment and mock_exam", async () => {
    const prisma = makePrisma(makePool(5, { placeholder: true }));
    const service = new QuizzesService(prisma, topicAccuracy);

    const topicResult = await service.getQuizQuestions("user-1", "subject-1", "topic_assessment", "topic-1");
    expect(topicResult.questions).toHaveLength(0);
    expect(prisma.client.question.findMany.mock.calls[0][0].where).toMatchObject({ isPlaceholder: false });

    const mockResult = await service.getQuizQuestions("user-1", "subject-1", "mock_exam");
    expect(mockResult.questions).toHaveLength(0);
  });

  it("test 26: Topic Quiz randomizes the eligible pool before selecting (deterministic rng)", async () => {
    const pool = makePool(8);
    const prisma = makePrisma(pool);
    const service = new QuizzesService(prisma, topicAccuracy);

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
    const service = new QuizzesService(prisma, topicAccuracy);

    let seed = 1;
    const rng = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

    const result = await service.getQuizQuestions("user-1", "subject-1", "mock_exam", undefined, rng);

    const firstTwentyIds = pool.slice(0, 20).map((q) => q.id);
    expect(result.questions.map((q) => q.id)).not.toEqual(firstTwentyIds);
  });

  it("test 28: Topic Quiz target remains 8", async () => {
    const prisma = makePrisma(makePool(30));
    const service = new QuizzesService(prisma, topicAccuracy);
    const result = await service.getQuizQuestions("user-1", "subject-1", "topic_assessment", "topic-1");
    expect(result.requestedCount).toBe(8);
    expect(result.questions).toHaveLength(8);
  });

  it("test 29: Mock Exam target remains 20", async () => {
    const prisma = makePrisma(makePool(30));
    const service = new QuizzesService(prisma, topicAccuracy);
    const result = await service.getQuizQuestions("user-1", "subject-1", "mock_exam");
    expect(result.requestedCount).toBe(20);
    expect(result.questions).toHaveLength(20);
  });

  it("test 30: zero eligible Questions remains safe — no crash, empty result", async () => {
    const prisma = makePrisma([]);
    const service = new QuizzesService(prisma, topicAccuracy);
    const result = await service.getQuizQuestions("user-1", "subject-1", "topic_assessment", "topic-1");
    expect(result.questions).toEqual([]);
    expect(result.availableCount).toBe(0);
    expect(result.isFullAssessment).toBe(false);
  });

  it("test 31: an insufficient pool is honestly represented — requestedCount/availableCount/returnedCount/isFullAssessment", async () => {
    const prisma = makePrisma(makePool(3));
    const service = new QuizzesService(prisma, topicAccuracy);
    const result = await service.getQuizQuestions("user-1", "subject-1", "topic_assessment", "topic-1");

    expect(result).toMatchObject({ requestedCount: 8, availableCount: 3, returnedCount: 3, isFullAssessment: false });
    expect(result.questions).toHaveLength(3);
  });

  it("a full pool is honestly represented as isFullAssessment: true", async () => {
    const prisma = makePrisma(makePool(20));
    const service = new QuizzesService(prisma, topicAccuracy);
    const result = await service.getQuizQuestions("user-1", "subject-1", "mock_exam");
    expect(result.isFullAssessment).toBe(true);
    expect(result.returnedCount).toBe(20);
  });
});

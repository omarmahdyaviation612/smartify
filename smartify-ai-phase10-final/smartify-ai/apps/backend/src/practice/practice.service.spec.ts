import { ForbiddenException } from "@nestjs/common";
import { PracticeService } from "./practice.service";

/** Covers subject-ownership isolation for the practice engine — a student cannot fetch topics or questions for a subject they never selected. */
describe("PracticeService — authorization & ownership", () => {
  const studentProfile = { id: "student-1", subjects: [{ subjectId: "subject-1" }] };

  function makePrismaMock() {
    return {
      client: {
        studentProfile: { findUnique: jest.fn().mockResolvedValue(studentProfile) },
        topic: { findMany: jest.fn().mockResolvedValue([{ id: "topic-1" }]) },
        question: { findMany: jest.fn().mockResolvedValue([]) },
      },
    } as any;
  }

  const topicAccuracy = { getPerTopicAccuracy: jest.fn().mockResolvedValue([]), getTopicAccuracy: jest.fn().mockResolvedValue(null) } as any;

  it("rejects listing topics for a subject the student never selected", async () => {
    const service = new PracticeService(makePrismaMock(), topicAccuracy);
    await expect(service.getTopicsForSubject("user-1", "unrelated-subject")).rejects.toThrow(ForbiddenException);
  });

  it("rejects fetching adaptive practice questions for a subject the student never selected", async () => {
    const service = new PracticeService(makePrismaMock(), topicAccuracy);
    await expect(service.getAdaptiveQuestions("user-1", "unrelated-subject", undefined)).rejects.toThrow(ForbiddenException);
  });

  it("allows listing topics for a subject the student genuinely selected", async () => {
    const service = new PracticeService(makePrismaMock(), topicAccuracy);
    await expect(service.getTopicsForSubject("user-1", "subject-1")).resolves.toBeDefined();
  });
});

/**
 * Phase 10E: Practice's adaptive question pool must never leak seed/demo
 * placeholder Questions into a real student session — same rationale as
 * the Diagnostic's own filter (Phase 10D.1) and Quiz/Mock's (this phase).
 */
describe("PracticeService — placeholder containment", () => {
  const studentProfile = { id: "student-1", subjects: [{ subjectId: "subject-1" }] };
  const topicAccuracy = { getPerTopicAccuracy: jest.fn().mockResolvedValue([]), getTopicAccuracy: jest.fn().mockResolvedValue(null) } as any;

  it("test 22: excludes isPlaceholder:true Questions from the query itself, not just a post-filter", async () => {
    const questionFindMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      client: {
        studentProfile: { findUnique: jest.fn().mockResolvedValue(studentProfile) },
        topic: { findMany: jest.fn().mockResolvedValue([{ id: "topic-1" }]) },
        question: { findMany: questionFindMany },
      },
    } as any;
    const service = new PracticeService(prisma, topicAccuracy);

    await service.getAdaptiveQuestions("user-1", "subject-1", undefined);

    expect(questionFindMany.mock.calls[0][0].where).toMatchObject({ isPlaceholder: false });
  });

  it("test 25: still returns real, non-placeholder eligible Questions when they exist", async () => {
    const realQuestions = [
      { id: "q1", topicId: "topic-1", difficulty: "EASY", isPlaceholder: false },
      { id: "q2", topicId: "topic-1", difficulty: "MEDIUM", isPlaceholder: false },
    ];
    const prisma = {
      client: {
        studentProfile: { findUnique: jest.fn().mockResolvedValue(studentProfile) },
        topic: { findMany: jest.fn().mockResolvedValue([{ id: "topic-1" }]) },
        question: { findMany: jest.fn().mockImplementation(async ({ where }: any) => realQuestions.filter((q) => q.isPlaceholder === where.isPlaceholder)) },
      },
    } as any;
    const service = new PracticeService(prisma, topicAccuracy);

    const result = await service.getAdaptiveQuestions("user-1", "subject-1", undefined, 2);
    expect(result.questions.length).toBeGreaterThan(0);
  });
});

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

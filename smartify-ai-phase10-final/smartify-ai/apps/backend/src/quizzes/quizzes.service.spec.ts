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

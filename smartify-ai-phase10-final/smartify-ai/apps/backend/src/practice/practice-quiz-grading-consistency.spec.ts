import { PracticeService } from "./practice.service";
import { withReadyGate } from "../ai/context/topic-content-gate.fixtures.testspec";
import { QuizzesService } from "../quizzes/quizzes.service";

/**
 * Correctness hardening (2026-09-20) — Practice and Quiz independently
 * implement the exact same grading primitive
 * (JSON.stringify(correctAnswerJson) === JSON.stringify(answer)), never
 * extracted into a shared grader (that refactor is deliberately NOT part
 * of this task — see the final report). This test proves that duplication
 * hasn't silently drifted into an actual inconsistency: for the same
 * Question and the same submitted answer, both services must agree on
 * correctness.
 */
describe("Practice vs Quiz grading consistency", () => {
  const studentProfile = { id: "student-1", fullName: "Test Student", subjects: [{ subjectId: "subject-1" }] };
  const QUESTION = {
    id: "q1",
    topicId: "topic-1",
    promptEn: "Q1",
    correctAnswerJson: "Paris",
    explanationEn: null,
    explanationAr: null,
    topic: withReadyGate({ id: "topic-1", nameEn: "Geography", nameAr: "جغرافيا", unit: { subjectId: "subject-1" } }),
  };

  function makePracticeService() {
    const prisma = {
      client: {
        studentProfile: { findUnique: jest.fn().mockResolvedValue(studentProfile) },
        question: { findMany: jest.fn().mockResolvedValue([QUESTION]) },
        questionAttempt: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      },
    } as any;
    return new PracticeService(prisma, {} as any, {} as any);
  }

  function makeQuizService() {
    const prisma = {
      client: {
        studentProfile: { findUnique: jest.fn().mockResolvedValue(studentProfile) },
        question: { findMany: jest.fn().mockResolvedValue([QUESTION]) },
        questionAttempt: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
        quizResult: { create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: "result-1", ...data })) },
        parentStudentRelation: { findMany: jest.fn().mockResolvedValue([]) },
      },
    } as any;
    return new QuizzesService(prisma, {} as any, { ensurePoolForTopic: jest.fn() } as any, { send: jest.fn() } as any);
  }

  it.each([
    ["a correct answer", "Paris", true],
    ["an incorrect answer", "London", false],
    ["a case-different near-match (still incorrect — no fuzzy matching in either)", "paris", false],
  ])("%s: Practice and Quiz agree (isCorrect=%s)", async (_label, answer, expected) => {
    const practiceResult = await makePracticeService().submitPractice("user-1", [{ questionId: "q1", answer }]);
    const quizResult = await makeQuizService().submitQuiz("user-1", {
      subjectId: "subject-1",
      type: "topic_assessment",
      topicId: "topic-1",
      answers: [{ questionId: "q1", answer }],
    });

    expect(practiceResult.feedback[0].isCorrect).toBe(expected);
    expect(quizResult.breakdown[0].isCorrect).toBe(expected);
    expect(practiceResult.feedback[0].isCorrect).toBe(quizResult.breakdown[0].isCorrect);
  });
});

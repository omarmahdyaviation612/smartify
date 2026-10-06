export type HomeworkAnswerEvaluation = "CORRECT" | "INCORRECT" | "NOT_AN_ANSWER";

export function countIncorrectAnswerAttempt(input: {
  incorrectAttemptCount: number;
  explicitAnswer: boolean;
  evaluation: HomeworkAnswerEvaluation;
}): { incorrectAttemptCount: number; revealSolution: boolean } {
  if (!Number.isSafeInteger(input.incorrectAttemptCount) || input.incorrectAttemptCount < 0) {
    throw new Error("incorrectAttemptCount must be a non-negative integer");
  }

  const incorrectAttemptCount = input.explicitAnswer && input.evaluation === "INCORRECT"
    ? Math.min(3, input.incorrectAttemptCount + 1)
    : Math.min(3, input.incorrectAttemptCount);

  return {
    incorrectAttemptCount,
    revealSolution: incorrectAttemptCount >= 3,
  };
}

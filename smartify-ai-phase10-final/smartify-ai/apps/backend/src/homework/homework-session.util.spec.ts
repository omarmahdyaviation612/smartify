import { countIncorrectAnswerAttempt } from "./homework-session.util";

describe("countIncorrectAnswerAttempt", () => {
  it("does not count hints or non-answer turns as incorrect attempts", () => {
    expect(countIncorrectAnswerAttempt({ incorrectAttemptCount: 1, explicitAnswer: false, evaluation: "INCORRECT" })).toEqual({
      incorrectAttemptCount: 1,
      revealSolution: false,
    });
    expect(countIncorrectAnswerAttempt({ incorrectAttemptCount: 1, explicitAnswer: true, evaluation: "NOT_AN_ANSWER" })).toEqual({
      incorrectAttemptCount: 1,
      revealSolution: false,
    });
  });

  it("increments only an explicit incorrect answer and reveals the solution on the third one", () => {
    expect(countIncorrectAnswerAttempt({ incorrectAttemptCount: 0, explicitAnswer: true, evaluation: "INCORRECT" })).toEqual({
      incorrectAttemptCount: 1,
      revealSolution: false,
    });
    expect(countIncorrectAnswerAttempt({ incorrectAttemptCount: 2, explicitAnswer: true, evaluation: "INCORRECT" })).toEqual({
      incorrectAttemptCount: 3,
      revealSolution: true,
    });
  });

  it("does not count correct answers and clamps the count at the reveal threshold", () => {
    expect(countIncorrectAnswerAttempt({ incorrectAttemptCount: 1, explicitAnswer: true, evaluation: "CORRECT" })).toEqual({
      incorrectAttemptCount: 1,
      revealSolution: false,
    });
    expect(countIncorrectAnswerAttempt({ incorrectAttemptCount: 3, explicitAnswer: true, evaluation: "INCORRECT" })).toEqual({
      incorrectAttemptCount: 3,
      revealSolution: true,
    });
  });

  it("rejects invalid attempt counts", () => {
    expect(() => countIncorrectAnswerAttempt({ incorrectAttemptCount: -1, explicitAnswer: false, evaluation: "NOT_AN_ANSWER" })).toThrow();
    expect(() => countIncorrectAnswerAttempt({ incorrectAttemptCount: 1.5, explicitAnswer: false, evaluation: "NOT_AN_ANSWER" })).toThrow();
  });
});

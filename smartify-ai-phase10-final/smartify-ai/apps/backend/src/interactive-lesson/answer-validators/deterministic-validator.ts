import type { CheckExpression } from "../interactive-lesson.types";
import { parseComparativeAnswer, parseNumericAnswer, parseYesNoAnswer } from "./number-parsing.util";

export interface DeterministicValidation {
  correct: boolean;
  expected: number | boolean;
  studentValue: number | boolean;
}

/**
 * Attempts to deterministically grade a student's reply against a known
 * expression captured at check-delivery time. Returns null whenever the
 * op is unsupported OR the student's message can't be parsed into the
 * answer shape that op expects (a clean number for add/subtract, a clean
 * yes/no for equals/compare) — callers MUST fall back to AI-based
 * classification in that case rather than guessing. This function is the
 * ONLY authority on numeric/boolean correctness for a supported op; its
 * result is never re-judged or overridden by the model afterwards.
 *
 * Extensible: add a new case here (and a matching CheckExpression member)
 * to support more deterministic question shapes later.
 */
export function tryDeterministicValidate(
  expression: CheckExpression | null | undefined,
  studentMessage: string,
): DeterministicValidation | null {
  if (!expression) return null;

  switch (expression.op) {
    case "add": {
      const value = parseNumericAnswer(studentMessage);
      if (value === null) return null;
      const expected = expression.operands[0] + expression.operands[1];
      return { correct: value === expected, expected, studentValue: value };
    }
    case "subtract": {
      const value = parseNumericAnswer(studentMessage);
      if (value === null) return null;
      const expected = expression.operands[0] - expression.operands[1];
      return { correct: value === expected, expected, studentValue: value };
    }
    case "equals": {
      const value = parseYesNoAnswer(studentMessage);
      if (value === null) return null;
      const expected = expression.operands[0] === expression.operands[1];
      return { correct: value === expected, expected, studentValue: value };
    }
    case "compare": {
      const value = parseComparativeAnswer(studentMessage, expression.comparator);
      if (value === null) return null;
      const expected =
        expression.comparator === "greater"
          ? expression.operands[0] > expression.operands[1]
          : expression.operands[0] < expression.operands[1];
      return { correct: value === expected, expected, studentValue: value };
    }
    default:
      return null;
  }
}

/**
 * Renders the expression's own operands (never the computed answer) as
 * short spoken-friendly text — given to the narration model even in "hint"
 * mode so it can reference the real numbers accurately instead of
 * hallucinating different ones (each lesson AI call is stateless/history-
 * free by design for cost control, so it has no other way to "remember"
 * what the question actually asked).
 */
export function describeOperands(expression: CheckExpression): string {
  return `${expression.operands[0]} and ${expression.operands[1]}`;
}

/** Renders the expected answer as short spoken-friendly text, for the "reveal" narration. */
export function describeExpectedAnswer(expression: CheckExpression): string {
  switch (expression.op) {
    case "add":
      return String(expression.operands[0] + expression.operands[1]);
    case "subtract":
      return String(expression.operands[0] - expression.operands[1]);
    case "equals":
      return expression.operands[0] === expression.operands[1] ? "yes" : "no";
    case "compare": {
      const isTrue =
        expression.comparator === "greater"
          ? expression.operands[0] > expression.operands[1]
          : expression.operands[0] < expression.operands[1];
      return isTrue ? "yes" : "no";
    }
    default:
      return "";
  }
}

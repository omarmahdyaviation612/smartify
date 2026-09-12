export type TeachingStepType = "INTRO" | "EXPLAIN" | "EXAMPLE" | "CHECK" | "REVIEW" | "COMPLETE";

export interface LessonVisualRef {
  type: "VISUALIZE_LEARNING" | "QUIZ" | "COMIC" | "VERSUS" | "CYCLE";
  status: "NOT_GENERATED" | "GENERATED";
  prompt: string;
  url: string | null;
}

export interface TeachingStep {
  id: string;
  type: TeachingStepType;
  order: number;
  objective: string;
  conceptKey?: string;
  required?: boolean;
  checkType?: string;
  visual?: LessonVisualRef;
}

/**
 * A structured, deterministically-gradable fact extracted (by the AI, at
 * step-delivery time) from a CHECK step's own generated question — e.g. "4 +
 * 3 = ?" becomes {op:"add", operands:[4,3]}. Captured once at delivery and
 * replayed against the student's later answer in code, so the model is
 * never the sole authority on arithmetic correctness. Extensible: add a new
 * "op" here plus a matching case in tryDeterministicValidate() to support
 * more question shapes later — never hard-code a specific question's numbers.
 */
export type CheckExpression =
  | { op: "add" | "subtract" | "equals"; operands: [number, number] }
  | { op: "compare"; operands: [number, number]; comparator: "greater" | "less" };

export interface StepResult {
  stepId: string;
  delivered: boolean;
  attempts: number;
  correct: boolean | null;
  hintGiven: boolean;
  /** Present only for CHECK steps whose question was deterministically gradable; absent/undefined otherwise. */
  expression?: CheckExpression;
}

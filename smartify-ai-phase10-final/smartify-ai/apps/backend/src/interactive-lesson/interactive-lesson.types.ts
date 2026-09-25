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
  | { op: "add" | "subtract" | "equals" | "multiply" | "divide"; operands: [number, number] }
  | { op: "compare"; operands: [number, number]; comparator: "greater" | "less" };

/**
 * Phase 8, V1: how a step's content is REPRESENTED (objects vs. a number
 * line vs. plain notation) — never how correctness is decided. Internal,
 * pedagogically descriptive names only; deliberately not named after any
 * national teaching method (mapping pedagogical origins is separate,
 * later work).
 */
export type TeachingStrategy = "CONCRETE_OBJECTS" | "NUMBER_LINE" | "SIMPLE_SYMBOLIC";

export interface StrategySwitchRecord {
  strategy: TeachingStrategy;
  reason: string;
  atStepId: string;
  switchedAt: string; // ISO timestamp
}

export interface StepResult {
  stepId: string;
  delivered: boolean;
  attempts: number;
  correct: boolean | null;
  hintGiven: boolean;
  /** Present only for CHECK steps whose question was deterministically gradable; absent/undefined otherwise. */
  expression?: CheckExpression;
  /**
   * Phase 8 V1: the teaching strategy active for this step at the time it
   * was last delivered/evaluated. Session-global in effect (the latest
   * value across all of a session's stepResults is its current strategy —
   * see getCurrentStrategy in teaching-strategy.util.ts) but stored
   * per-step so no schema migration/new column was needed: stepResultsJson
   * is already a schemaless Json column.
   */
  strategy?: TeachingStrategy;
  activeMathProblem?: ActiveMathProblem;
  /** Every switch that happened at or before this step, oldest first. Empty/absent until the first switch. */
  strategyHistory?: StrategySwitchRecord[];
}

export type ActiveMathProblem =
  | { operation: "multiply"; groups: number; itemsPerGroup: number; answer: number; itemLabel?: string }
  | { operation: "divide"; total: number; groups: number; answer: number; itemLabel?: string }
  | { operation: "fraction"; numerator: number; denominator: number; itemLabel?: string };

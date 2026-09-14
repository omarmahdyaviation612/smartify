import type { StepResult, StrategySwitchRecord, TeachingStrategy } from "./interactive-lesson.types";

/**
 * Phase 8 V1: deterministic, rule-based teaching-strategy selection. No AI
 * call, no LLM judgment — this is pure code so behavior stays predictable
 * and testable, per the phase's explicit "AI delivers, never selects"
 * requirement.
 */
export const DEFAULT_TEACHING_STRATEGY: TeachingStrategy = "CONCRETE_OBJECTS";

// V1 only defines this one fallback chain, for this one pilot concept
// (Addition with Zero's conceptual check). Extending to more concepts
// is explicitly out of scope for V1.
const STRATEGY_AFTER: Partial<Record<TeachingStrategy, TeachingStrategy>> = {
  CONCRETE_OBJECTS: "NUMBER_LINE",
};

const MEANINGFUL_WRONG_ATTEMPTS_BEFORE_SWITCH = 2;

/**
 * The session's current strategy is the latest `strategy` value recorded
 * across any of its stored step results — session-global in effect, even
 * though it's persisted per-step (see StepResult.strategy).
 */
export function getCurrentStrategy(stepResults: StepResult[]): TeachingStrategy {
  const withStrategy = stepResults.filter((r) => r.strategy);
  return withStrategy.length > 0 ? withStrategy[withStrategy.length - 1].strategy! : DEFAULT_TEACHING_STRATEGY;
}

export function getStrategyHistory(stepResults: StepResult[]): StrategySwitchRecord[] {
  const withHistory = stepResults.filter((r) => r.strategyHistory && r.strategyHistory.length > 0);
  return withHistory.length > 0 ? withHistory[withHistory.length - 1].strategyHistory! : [];
}

/**
 * Decides whether a just-classified, genuinely-wrong answer attempt
 * should trigger a strategy switch. Only ever called for conceptual
 * (non-deterministic) CHECK steps — deterministic arithmetic checks are
 * explicitly out of scope for strategy switching in V1.
 *
 * Returns null when no switch should happen (correct answer, first wrong
 * attempt, already on the last available strategy, or already switched
 * once at this step).
 */
export function decideStrategySwitch(params: {
  stepId: string;
  attemptsSoFar: number; // count INCLUDING the attempt just made
  isMeaningfulWrongAttempt: boolean; // true only for a real, incorrect answer attempt (not a question, not correct)
  currentStrategy: TeachingStrategy;
  alreadySwitchedAtThisStep: boolean;
}): { strategy: TeachingStrategy; record: StrategySwitchRecord } | null {
  if (!params.isMeaningfulWrongAttempt) return null;
  if (params.alreadySwitchedAtThisStep) return null;
  if (params.attemptsSoFar < MEANINGFUL_WRONG_ATTEMPTS_BEFORE_SWITCH) return null;

  const nextStrategy = STRATEGY_AFTER[params.currentStrategy];
  if (!nextStrategy) return null;

  return {
    strategy: nextStrategy,
    record: {
      strategy: nextStrategy,
      reason: `${params.attemptsSoFar}_meaningful_incorrect_attempts`,
      atStepId: params.stepId,
      switchedAt: new Date().toISOString(),
    },
  };
}

/** Plain-language guidance injected into the tutor prompt for each strategy — never AI-chosen wording, so behavior stays predictable. */
export function strategyGuidance(strategy: TeachingStrategy): string {
  switch (strategy) {
    case "CONCRETE_OBJECTS":
      return "Use familiar countable objects (like apples, toys, or blocks) to explain and question the concept. Keep language appropriate for an Egyptian Grade 1 child. Do not switch representation unless instructed.";
    case "NUMBER_LINE":
      return (
        "MANDATORY REPRESENTATION FOR THIS TURN: number-line position/movement — describe standing at a point on a number line and moving forward or backward by steps. " +
        "Explain zero specifically as ZERO MOVEMENT / ZERO STEPS: you stay at exactly the same point. " +
        "Do NOT use apples, toys, blocks, candies, or any other countable-object example in this explanation, even if the step's own objective or example above uses one — restate that same question/numbers as a number-line scenario instead, in your own words. " +
        "Do not simply repeat a previous objects-based explanation; this must be a materially different representation. " +
        "Illustrative shape only, write your own original wording, do not copy verbatim: \"Start at 4 on the number line. Move 0 steps. You stay at 4.\""
      );
    case "SIMPLE_SYMBOLIC":
      return "Explain and question directly using simple arithmetic notation and numbers, without an objects or number-line framing.";
  }
}

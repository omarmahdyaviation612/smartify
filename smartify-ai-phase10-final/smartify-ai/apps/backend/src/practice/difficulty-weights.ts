import { Difficulty } from "@smartify/shared-types";

/**
 * Pure, rule-based adaptive difficulty selection — extracted from
 * PracticeService so it's testable without a database. See
 * 07-phase7-decisions.md for why this is a rule-based lookup rather than
 * an AI call: it's fast, free, and fully deterministic given an accuracy
 * input, which also makes it easy to unit test exhaustively.
 */
export function pickDifficultyWeights(accuracyPercent: number | null): Record<Difficulty, number> {
  if (accuracyPercent === null) return { EASY: 0.5, MEDIUM: 0.4, HARD: 0.1 } as Record<Difficulty, number>;
  if (accuracyPercent < 40) return { EASY: 0.6, MEDIUM: 0.35, HARD: 0.05 } as Record<Difficulty, number>;
  if (accuracyPercent < 75) return { EASY: 0.3, MEDIUM: 0.5, HARD: 0.2 } as Record<Difficulty, number>;
  return { EASY: 0.1, MEDIUM: 0.4, HARD: 0.5 } as Record<Difficulty, number>;
}

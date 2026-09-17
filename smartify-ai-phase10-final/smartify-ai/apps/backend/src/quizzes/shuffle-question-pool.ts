/**
 * Phase 10E: Phase 10D found Quiz/Mock Exam selection had no randomization
 * — repeated requests deterministically returned the same first N rows
 * merely because Postgres/Prisma's unordered `findMany` is stable in
 * practice for a small, rarely-changing table. Extracted as a pure
 * function (mirrors difficulty-weights.ts's own extraction rationale in
 * ../practice/) so it is independently unit-testable with a seedable RNG —
 * no flaky Math.random()-based assertions needed.
 *
 * Fisher-Yates, in-place-safe (returns a new array, never mutates the input).
 */
export function shuffleQuestionPool<T>(pool: readonly T[], rng: () => number = Math.random): T[] {
  const result = pool.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

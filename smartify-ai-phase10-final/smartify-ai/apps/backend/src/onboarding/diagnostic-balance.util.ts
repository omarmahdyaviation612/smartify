export const DIAGNOSTIC_QUESTION_LIMIT = 10;

/**
 * Picks up to `limit` diagnostic questions spread as evenly as possible across the student's
 * selected subjects (round-robin in `subjectOrder`), keeping each subject's own order
 * (oldest / first-topic questions first). A subject with too few questions gives its unused
 * slots to the others, so the diagnostic still reaches `limit` whenever enough questions exist.
 * Subjects not listed in `subjectOrder` are served after the listed ones.
 */
export function pickBalancedDiagnostic<T>(
  questions: T[],
  subjectOf: (q: T) => string,
  subjectOrder: string[],
  limit: number = DIAGNOSTIC_QUESTION_LIMIT,
): T[] {
  const buckets = new Map<string, T[]>();
  for (const id of subjectOrder) if (!buckets.has(id)) buckets.set(id, []);
  for (const q of questions) {
    const id = subjectOf(q);
    if (!buckets.has(id)) buckets.set(id, []);
    buckets.get(id)!.push(q);
  }
  const queues = [...buckets.values()].filter((b) => b.length > 0);
  const picked: T[] = [];
  let round = 0;
  while (picked.length < limit && queues.some((b) => b.length > round)) {
    for (const bucket of queues) {
      if (picked.length >= limit) break;
      if (bucket.length > round) picked.push(bucket[round]);
    }
    round += 1;
  }
  // Present the questions grouped by subject (in subject order), not interleaved one by one.
  const rank = new Map(queues.map((b, i) => [b, i]));
  const bucketOf = new Map<T, T[]>();
  for (const b of queues) for (const q of b) bucketOf.set(q, b);
  return picked
    .map((q, i) => ({ q, i }))
    .sort((a, b) => rank.get(bucketOf.get(a.q)!)! - rank.get(bucketOf.get(b.q)!)! || a.i - b.i)
    .map(({ q }) => q);
}

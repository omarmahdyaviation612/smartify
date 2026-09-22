/**
 * Subject entitlement V1 (2026-09-20) — the ONE place the
 * expiresAt-vs-now rule lives. StudentSubject is the source of truth for
 * "does this student have real, non-trial access to this Subject":
 *   - expiresAt: null       → permanent (every paid-purchase grant)
 *   - expiresAt in the future → time-limited (currently only
 *     ReferralService's 30-day reward)
 *   - expiresAt in the past  → never grants access, even though the row
 *     itself is never deleted
 * Every call site that used to treat "a StudentSubject row exists" as
 * sufficient (Practice/Quiz's assertSubjectOwned, and now
 * InteractiveLessonService's Lesson entitlement gate — never
 * account-wide Subscription.status) must go through this function
 * instead of re-checking expiresAt inline, so the rule can never drift
 * between call sites.
 */
export function isStudentSubjectRowActive(row: { expiresAt?: Date | null } | null | undefined, now: Date = new Date()): boolean {
  if (!row) return false;
  return row.expiresAt == null || row.expiresAt > now;
}

/** Set-membership check against an already-loaded StudentSubject[] (e.g. Practice/Quiz's own profile.subjects) — never a second query. */
export function hasSubjectEntitlementInList(
  subjects: Array<{ subjectId: string; expiresAt?: Date | null }>,
  subjectId: string,
  now: Date = new Date(),
): boolean {
  return subjects.some((s) => s.subjectId === subjectId && isStudentSubjectRowActive(s, now));
}

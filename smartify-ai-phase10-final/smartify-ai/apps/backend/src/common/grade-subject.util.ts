import { PrismaClient } from "@smartify/database";

/**
 * Grade offering V1 (2026-10-06) — the ONE place the "is this Subject
 * available to this Grade" rule lives. A Subject's own `gradeId` is its
 * CONTENT HOME (where its units, textbook mapping, and price are authored);
 * a Grade OFFERS a Subject through GradeSubject, which may point at a
 * Subject whose content home is a different curriculum's grade. Every call
 * site that used to filter `subject.gradeId = the student's grade` must go
 * through here instead, so the rule can never drift between call sites.
 *
 * `subjectIds` is passed through as an `in` filter even when EMPTY, so an
 * empty selection keeps meaning "no subjects" — never "no filter at all",
 * which would silently list a whole grade's catalog.
 */
export function gradeOfferingWhere(gradeId: string, subjectIds?: string[]) {
  return {
    gradeId,
    isActive: true,
    subject: { isActive: true },
    ...(subjectIds !== undefined ? { subjectId: { in: subjectIds } } : {}),
  };
}

/** Subjects this grade offers, as plain Subject rows so callers keep their existing response shape. */
export async function findOfferedSubjects(db: PrismaClient, gradeId: string, subjectIds?: string[]) {
  const offerings = await db.gradeSubject.findMany({
    where: gradeOfferingWhere(gradeId, subjectIds),
    include: { subject: true },
    orderBy: { subject: { nameEn: "asc" } },
  });
  return offerings.map((offering) => offering.subject);
}

/** A single offering lookup, used where a caller previously did `subject.findFirst({ id, gradeId })`. */
export async function findOfferedSubject(db: PrismaClient, gradeId: string, subjectId: string) {
  const offering = await db.gradeSubject.findFirst({
    where: gradeOfferingWhere(gradeId, [subjectId]),
    include: { subject: true },
  });
  return offering?.subject ?? null;
}

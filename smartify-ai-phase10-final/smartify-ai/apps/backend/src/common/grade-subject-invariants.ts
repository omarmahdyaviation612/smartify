import { PrismaClient } from "@smartify/database";

/**
 * Grade offering invariants (2026-10-06). Read-only by construction: three
 * findMany calls and set arithmetic, no writes of any kind.
 *
 * The invariants exist because Phase 1 makes "a grade offers a subject" the
 * only availability rule. If any of them is false, a student can end up
 * holding an entitlement nothing lists, or a grade can list the same subject
 * twice — both of which fail silently in the UI rather than loudly.
 */
export type InvariantViolation =
  | { kind: "SUBJECT_WITHOUT_HOME_OFFERING"; subjectId: string; nameEn: string; gradeId: string }
  | { kind: "GRADE_OFFERS_TWO_HOMES_FOR_SAME_SUBJECT"; gradeId: string; nameEn: string; subjectIds: string[] }
  | { kind: "OFFERING_POINTS_AT_INACTIVE_SUBJECT"; offeringId: string; subjectId: string }
  | { kind: "ENTITLEMENT_NOT_OFFERED_FOR_STUDENT_GRADE"; studentId: string; subjectId: string; gradeId: string };

export async function findInvariantViolations(db: PrismaClient): Promise<InvariantViolation[]> {
  const offerings = await db.gradeSubject.findMany({
    select: { id: true, gradeId: true, subjectId: true, isActive: true, subject: { select: { isActive: true } } },
  });
  const subjects = await db.subject.findMany({
    select: { id: true, nameEn: true, gradeId: true, isActive: true },
  });
  const entitlements = await db.studentSubject.findMany({
    select: { studentId: true, subjectId: true, student: { select: { gradeId: true } } },
  });

  const violations: InvariantViolation[] = [];
  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const offeredPairs = new Set(offerings.filter((o) => o.isActive).map((o) => `${o.gradeId}:${o.subjectId}`));
  // Grouped by CONTENT HOME (subject.gradeId): two rows under one grade that
  // both borrow content from the same home are the duplicate shape.
  const duplicates = new Map<string, { gradeId: string; nameEn: string; subjectIds: string[] }>();

  for (const offering of offerings) {
    if (offering.isActive && !offering.subject.isActive) {
      violations.push({ kind: "OFFERING_POINTS_AT_INACTIVE_SUBJECT", offeringId: offering.id, subjectId: offering.subjectId });
    }
    if (!offering.isActive) continue;
    const subject = subjectById.get(offering.subjectId);
    if (!subject) continue;
    const key = `${offering.gradeId}\u0000${subject.nameEn}\u0000${subject.gradeId}`;
    const group = duplicates.get(key) ?? { gradeId: offering.gradeId, nameEn: subject.nameEn, subjectIds: [] };
    group.subjectIds.push(offering.subjectId);
    duplicates.set(key, group);
  }

  for (const subject of subjects) {
    if (!subject.isActive) continue;
    if (!offeredPairs.has(`${subject.gradeId}:${subject.id}`)) {
      violations.push({ kind: "SUBJECT_WITHOUT_HOME_OFFERING", subjectId: subject.id, nameEn: subject.nameEn, gradeId: subject.gradeId });
    }
  }

  for (const group of duplicates.values()) {
    if (group.subjectIds.length < 2) continue;
    violations.push({ kind: "GRADE_OFFERS_TWO_HOMES_FOR_SAME_SUBJECT", ...group, subjectIds: [...group.subjectIds].sort() });
  }

  for (const entitlement of entitlements) {
    const gradeId = entitlement.student.gradeId;
    if (!offeredPairs.has(`${gradeId}:${entitlement.subjectId}`)) {
      violations.push({
        kind: "ENTITLEMENT_NOT_OFFERED_FOR_STUDENT_GRADE",
        studentId: entitlement.studentId,
        subjectId: entitlement.subjectId,
        gradeId,
      });
    }
  }

  return violations;
}

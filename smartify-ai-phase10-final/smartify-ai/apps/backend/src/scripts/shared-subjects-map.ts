/**
 * Shared subjects Phase 2 (2026-10-06) — pure planning logic, no database
 * access, so every rule below is testable without a connection.
 *
 * Nothing is copied. The Egyptian Arabic Language / Social Studies subjects
 * keep their content, their price, and their textbook mapping; this module
 * only decides which other grades should OFFER them, which duplicates of them
 * must be withdrawn, and where a student's entitlement moves when one is.
 */
export const SHARED_SUBJECTS = [
  // canonical = the Egyptian subject's name (its content home).
  // aliases   = every name a duplicate of it has been known to carry. The
  //             seeded non-Egyptian placeholders say "Arabic", the Egyptian
  //             row says "Arabic Language"; "Social Studies" is identical in
  //             both, which is exactly why identification is by
  //             (name, curriculum) and never by name alone.
  { canonical: "Arabic Language", aliases: ["Arabic Language", "Arabic"] },
  { canonical: "Social Studies", aliases: ["Social Studies"] },
] as const;

export const SHARED_SUBJECT_NAMES: string[] = SHARED_SUBJECTS.map((s) => s.canonical);
export const DUPLICATE_SUBJECT_NAMES: string[] = [...new Set(SHARED_SUBJECTS.flatMap((s) => [...s.aliases]))];
export const REFERENCE_CURRICULUM_CODE = "EG_NATIONAL";
export const TARGET_CURRICULUM_CODES = ["BRITISH_INTL", "AMERICAN_INTL", "LOCAL"] as const;

/**
 * British level N ↔ Egyptian level N (2026-10-06 decision). The seeded British
 * grades are still `[PLACEHOLDER] Grade N`, so this is a product decision, not
 * a derived one — it lives here, in one place, asserted by a test.
 */
export const LEVEL_OFFSET = 0;

export type Snapshot = {
  grades: Array<{ id: string; level: number; curriculumCode: string; isActive: boolean }>;
  subjects: Array<{
    id: string;
    nameEn: string;
    gradeId: string;
    isActive: boolean;
    unitCount: number;
    topicCount: number;
    entitlementCount: number;
  }>;
  offerings: Array<{ gradeId: string; subjectId: string; isActive: boolean }>;
  entitlements: Array<{
    studentId: string;
    subjectId: string;
    expiresAt: Date | null;
    studentGradeLevel: number;
    studentCurriculumCode: string;
  }>;
};

export type Link = { gradeId: string; subjectId: string; curriculumCode: string; level: number; nameEn: string };
export type Withdrawal = {
  subjectId: string;
  gradeId: string;
  nameEn: string;
  curriculumCode: string;
  level: number;
  reason: "EMPTY_DUPLICATE";
};
export type Blocked = {
  subjectId: string;
  nameEn: string;
  curriculumCode: string;
  level: number;
  reason: "HAS_CONTENT" | "CANNOT_REPOINT";
  unitCount: number;
  topicCount: number;
  entitlementCount: number;
};
export type EntitlementRepoint = { studentId: string; fromSubjectId: string; toSubjectId: string };

export type SharedSubjectsPlan = {
  links: Link[];
  withdrawals: Withdrawal[];
  blocked: Blocked[];
  entitlementRepoints: EntitlementRepoint[];
  notes: Array<{ code: "NO_GRADES" | "NO_REFERENCE_SUBJECT"; curriculumCode: string; level?: number }>;
};

const key = (level: number, nameEn: string) => `${level}\u0000${nameEn}`;

export function planSharedSubjects(snapshot: Snapshot): SharedSubjectsPlan {
  const gradeById = new Map(snapshot.grades.map((g) => [g.id, g]));
  const plan: SharedSubjectsPlan = { links: [], withdrawals: [], blocked: [], entitlementRepoints: [], notes: [] };

  // Canonical subjects, keyed by (reference level, canonical name).
  const referenceByLevelAndName = new Map<string, string>();
  for (const subject of snapshot.subjects) {
    const grade = gradeById.get(subject.gradeId);
    if (!grade || grade.curriculumCode !== REFERENCE_CURRICULUM_CODE || !subject.isActive) continue;
    if (!SHARED_SUBJECT_NAMES.includes(subject.nameEn)) continue;
    referenceByLevelAndName.set(key(grade.level, subject.nameEn), subject.id);
  }

  const offered = new Set(snapshot.offerings.filter((o) => o.isActive).map((o) => `${o.gradeId}\u0000${o.subjectId}`));

  for (const curriculumCode of TARGET_CURRICULUM_CODES) {
    const grades = snapshot.grades.filter((g) => g.curriculumCode === curriculumCode);
    if (grades.length === 0) {
      plan.notes.push({ code: "NO_GRADES", curriculumCode });
      continue;
    }

    for (const grade of grades) {
      const targetLevel = grade.level + LEVEL_OFFSET;
      // Only this grade's own subjects can be duplicates of a shared subject —
      // the reference rows live under the reference curriculum and are never
      // in this list.
      const activeHere = snapshot.subjects.filter((s) => s.gradeId === grade.id && s.isActive);

      for (const shared of SHARED_SUBJECTS) {
        const referenceSubjectId = referenceByLevelAndName.get(key(targetLevel, shared.canonical));
        if (!referenceSubjectId) {
          plan.notes.push({ code: "NO_REFERENCE_SUBJECT", curriculumCode, level: targetLevel });
          continue;
        }

        const duplicate = activeHere.find((s) => (shared.aliases as readonly string[]).includes(s.nameEn));
        const blockedBase = {
          subjectId: duplicate?.id ?? referenceSubjectId,
          nameEn: duplicate?.nameEn ?? shared.canonical,
          curriculumCode,
          level: grade.level,
          unitCount: duplicate?.unitCount ?? 0,
          topicCount: duplicate?.topicCount ?? 0,
          entitlementCount: duplicate?.entitlementCount ?? 0,
        };

        if (duplicate && (duplicate.unitCount > 0 || duplicate.topicCount > 0)) {
          plan.blocked.push({ ...blockedBase, reason: "HAS_CONTENT" });
          continue;
        }

        // Entitlements on a withdrawable duplicate must all be movable, or the
        // withdrawal would silently drop a student's access.
        const repoints: EntitlementRepoint[] = [];
        if (duplicate) {
          let cannotRepoint = false;
          for (const entitlement of snapshot.entitlements.filter((e) => e.subjectId === duplicate.id)) {
            const destination = referenceByLevelAndName.get(key(entitlement.studentGradeLevel + LEVEL_OFFSET, shared.canonical));
            if (!destination) {
              cannotRepoint = true;
              break;
            }
            repoints.push({ studentId: entitlement.studentId, fromSubjectId: duplicate.id, toSubjectId: destination });
          }
          if (cannotRepoint) {
            plan.blocked.push({ ...blockedBase, reason: "CANNOT_REPOINT" });
            continue;
          }
        }

        if (!offered.has(`${grade.id}\u0000${referenceSubjectId}`)) {
          // Only ACTIVE grades are link targets (2026-10-06 fix). Measured on
          // the real database: British levels 1-6 each carry BOTH a
          // `[PLACEHOLDER] Grade N` row (isActive false) and a real `Year N`
          // row, so linking every grade emitted two links per level for one
          // pair — and made the apply report `offeringsCreated: 17` while
          // upserting only 9 distinct rows. An offering on a row no student can
          // see is dead anyway. Withdrawals are NOT gated on this: the empty
          // duplicates the seed created actually live under those inactive
          // placeholder rows, so skipping them entirely would skip the cleanup.
          if (grade.isActive) {
            plan.links.push({ gradeId: grade.id, subjectId: referenceSubjectId, curriculumCode, level: grade.level, nameEn: shared.canonical });
          }
        }
        if (duplicate) {
          plan.withdrawals.push({
            subjectId: duplicate.id, gradeId: grade.id, nameEn: duplicate.nameEn,
            curriculumCode, level: grade.level, reason: "EMPTY_DUPLICATE",
          });
          plan.entitlementRepoints.push(...repoints);
        }
      }
    }
  }

  return plan;
}

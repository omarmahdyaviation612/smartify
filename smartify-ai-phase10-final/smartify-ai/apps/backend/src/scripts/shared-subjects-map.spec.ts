import { LEVEL_OFFSET, planSharedSubjects, type Snapshot } from "./shared-subjects-map";

/** Mirrors the measured local database: populated Egyptian subjects, empty British duplicates. */
function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    grades: [
      { id: "g-eg-2", level: 2, curriculumCode: "EG_NATIONAL" },
      { id: "g-eg-4", level: 4, curriculumCode: "EG_NATIONAL" },
      { id: "g-uk-2", level: 2, curriculumCode: "BRITISH_INTL" },
      { id: "g-uk-4", level: 4, curriculumCode: "BRITISH_INTL" },
    ],
    subjects: [
      { id: "s-eg-ar-2", nameEn: "Arabic Language", gradeId: "g-eg-2", isActive: true, unitCount: 4, topicCount: 19, entitlementCount: 0 },
      { id: "s-eg-ss-4", nameEn: "Social Studies", gradeId: "g-eg-4", isActive: true, unitCount: 3, topicCount: 14, entitlementCount: 0 },
      { id: "s-uk-ar-2", nameEn: "Arabic", gradeId: "g-uk-2", isActive: true, unitCount: 0, topicCount: 0, entitlementCount: 0 },
      { id: "s-uk-ss-4", nameEn: "Social Studies", gradeId: "g-uk-4", isActive: true, unitCount: 0, topicCount: 0, entitlementCount: 0 },
    ],
    offerings: [],
    entitlements: [],
    ...overrides,
  };
}

test("LEVEL_OFFSET is 0 — British level N maps to Egyptian level N", () => {
  expect(LEVEL_OFFSET).toBe(0);
});

test("links every target grade to the reference subject at the same level", () => {
  const plan = planSharedSubjects(snapshot());
  expect(plan.links).toEqual([
    { gradeId: "g-uk-2", subjectId: "s-eg-ar-2", curriculumCode: "BRITISH_INTL", level: 2, nameEn: "Arabic Language" },
    { gradeId: "g-uk-4", subjectId: "s-eg-ss-4", curriculumCode: "BRITISH_INTL", level: 4, nameEn: "Social Studies" },
  ]);
  expect(plan.blocked).toEqual([]);
});

test("withdraws an empty non-reference duplicate", () => {
  const plan = planSharedSubjects(snapshot());
  expect(plan.withdrawals).toEqual([
    { subjectId: "s-uk-ar-2", gradeId: "g-uk-2", nameEn: "Arabic", curriculumCode: "BRITISH_INTL", level: 2, reason: "EMPTY_DUPLICATE" },
    { subjectId: "s-uk-ss-4", gradeId: "g-uk-4", nameEn: "Social Studies", curriculumCode: "BRITISH_INTL", level: 4, reason: "EMPTY_DUPLICATE" },
  ]);
});

test("blocks a duplicate that carries content, and does not link over it", () => {
  const plan = planSharedSubjects(snapshot({
    subjects: snapshot().subjects.map((s) => (s.id === "s-uk-ar-2" ? { ...s, unitCount: 1, topicCount: 3 } : s)),
  }));
  expect(plan.withdrawals.map((w) => w.subjectId)).toEqual(["s-uk-ss-4"]);
  expect(plan.blocked).toEqual([
    { subjectId: "s-uk-ar-2", nameEn: "Arabic", curriculumCode: "BRITISH_INTL", level: 2, reason: "HAS_CONTENT", unitCount: 1, topicCount: 3, entitlementCount: 0 },
  ]);
  // Linking over a duplicate that cannot be withdrawn would show the student two
  // Arabics — one carrying the real content, one empty.
  expect(plan.links.map((l) => l.gradeId)).toEqual(["g-uk-4"]);
});

test("re-points a student's entitlement instead of blocking, because entitlements move with the withdrawal", () => {
  const plan = planSharedSubjects(snapshot({
    subjects: snapshot().subjects.map((s) => (s.id === "s-uk-ar-2" ? { ...s, entitlementCount: 1 } : s)),
    entitlements: [
      { studentId: "st-1", subjectId: "s-uk-ar-2", expiresAt: null, studentGradeLevel: 2, studentCurriculumCode: "BRITISH_INTL" },
    ],
  }));
  expect(plan.blocked).toEqual([]);
  expect(plan.entitlementRepoints).toEqual([
    { studentId: "st-1", fromSubjectId: "s-uk-ar-2", toSubjectId: "s-eg-ar-2" },
  ]);
  expect(plan.withdrawals.map((w) => w.subjectId)).toContain("s-uk-ar-2");
});

test("blocks instead of withdrawing when an entitlement cannot be moved to a reference subject", () => {
  const plan = planSharedSubjects(snapshot({
    subjects: snapshot().subjects.map((s) => (s.id === "s-uk-ar-2" ? { ...s, entitlementCount: 1 } : s)),
    // The student's own level has no Egyptian Arabic, so there is nothing to move the grant to.
    entitlements: [
      { studentId: "st-1", subjectId: "s-uk-ar-2", expiresAt: null, studentGradeLevel: 6, studentCurriculumCode: "BRITISH_INTL" },
    ],
  }));
  expect(plan.blocked.map((b) => b.reason)).toEqual(["CANNOT_REPOINT"]);
  expect(plan.withdrawals.map((w) => w.subjectId)).not.toContain("s-uk-ar-2");
  expect(plan.entitlementRepoints).toEqual([]);
  expect(plan.links.map((l) => l.gradeId)).not.toContain("g-uk-2");
});

test("is idempotent: an existing offering produces no duplicate link", () => {
  const plan = planSharedSubjects(snapshot({
    offerings: [{ gradeId: "g-uk-2", subjectId: "s-eg-ar-2", isActive: true }],
  }));
  expect(plan.links.map((l) => l.gradeId)).toEqual(["g-uk-4"]);
  expect(plan.withdrawals.map((w) => w.subjectId)).toContain("s-uk-ar-2");
});

test("reports a target curriculum that has no grades rather than failing", () => {
  const plan = planSharedSubjects(snapshot({
    grades: snapshot().grades.filter((g) => g.curriculumCode !== "BRITISH_INTL"),
  }));
  expect(plan.links).toEqual([]);
  expect(plan.notes).toEqual([
    { code: "NO_GRADES", curriculumCode: "BRITISH_INTL" },
    { code: "NO_GRADES", curriculumCode: "AMERICAN_INTL" },
    { code: "NO_GRADES", curriculumCode: "LOCAL" },
  ]);
});

test("notes a level with no reference subject and leaves that grade's duplicate alone", () => {
  const plan = planSharedSubjects(snapshot());
  // British level 2 has no Egyptian Social Studies, and British level 4 has no Egyptian Arabic.
  // The trailing NO_GRADES notes are the same "report it, don't fail" rule the
  // test above asserts: this fixture has no AMERICAN_INTL or LOCAL grades at
  // all, so the planner reports them. Omitting them here would have made the
  // two tests contradict each other.
  expect(plan.notes).toEqual([
    { code: "NO_REFERENCE_SUBJECT", curriculumCode: "BRITISH_INTL", level: 2 },
    { code: "NO_REFERENCE_SUBJECT", curriculumCode: "BRITISH_INTL", level: 4 },
    { code: "NO_GRADES", curriculumCode: "AMERICAN_INTL" },
    { code: "NO_GRADES", curriculumCode: "LOCAL" },
  ]);
});

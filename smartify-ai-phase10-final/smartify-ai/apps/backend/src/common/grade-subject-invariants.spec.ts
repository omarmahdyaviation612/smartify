import { findInvariantViolations } from "./grade-subject-invariants";

function db(overrides: { offerings?: any[]; subjects?: any[]; studentSubjects?: any[] }) {
  return {
    gradeSubject: { findMany: jest.fn(async () => overrides.offerings ?? []) },
    subject: { findMany: jest.fn(async () => overrides.subjects ?? []) },
    studentSubject: { findMany: jest.fn(async () => overrides.studentSubjects ?? []) },
  } as any;
}

const offered = (subjectId: string, gradeId: string, extra: any = {}) => ({
  id: `off-${subjectId}-${gradeId}`, gradeId, subjectId, isActive: true, subject: { isActive: true }, ...extra,
});

test("a healthy catalog has no violations", async () => {
  const violations = await findInvariantViolations(db({
    subjects: [{ id: "s1", nameEn: "Arabic", gradeId: "g-eg", isActive: true }],
    offerings: [offered("s1", "g-eg")],
    studentSubjects: [{ studentId: "st1", subjectId: "s1", student: { gradeId: "g-eg" } }],
  }));
  expect(violations).toEqual([]);
});

test("flags a subject that no grade offers", async () => {
  const violations = await findInvariantViolations(db({
    subjects: [{ id: "s1", nameEn: "Arabic", gradeId: "g-eg", isActive: true }],
    offerings: [],
  }));
  expect(violations).toEqual([
    { kind: "SUBJECT_WITHOUT_HOME_OFFERING", subjectId: "s1", nameEn: "Arabic", gradeId: "g-eg" },
  ]);
});

test("flags an active offering that points at an inactive subject", async () => {
  const violations = await findInvariantViolations(db({
    subjects: [{ id: "s1", nameEn: "Arabic", gradeId: "g-eg", isActive: false }],
    offerings: [{ ...offered("s1", "g-eg"), subject: { isActive: false } }],
  }));
  expect(violations).toEqual([
    { kind: "OFFERING_POINTS_AT_INACTIVE_SUBJECT", offeringId: "off-s1-g-eg", subjectId: "s1" },
  ]);
});

test("flags an entitlement the student's own grade does not offer", async () => {
  const violations = await findInvariantViolations(db({
    subjects: [{ id: "s1", nameEn: "Arabic", gradeId: "g-eg", isActive: true }],
    offerings: [offered("s1", "g-eg")],
    studentSubjects: [{ studentId: "st1", subjectId: "s1", student: { gradeId: "g-uk" } }],
  }));
  expect(violations).toEqual([
    { kind: "ENTITLEMENT_NOT_OFFERED_FOR_STUDENT_GRADE", studentId: "st1", subjectId: "s1", gradeId: "g-uk" },
  ]);
});

test("flags one grade offering two active rows for the same subject name", async () => {
  // Two Arabic rows under the same Egyptian grade, both offered there: an
  // accidental duplicate that would render twice in the student's list.
  const violations = await findInvariantViolations(db({
    subjects: [
      { id: "s1", nameEn: "Arabic", gradeId: "g-eg", isActive: true },
      { id: "s2", nameEn: "Arabic", gradeId: "g-eg", isActive: true },
    ],
    offerings: [offered("s1", "g-eg"), offered("s2", "g-eg")],
  }));
  expect(violations).toEqual([
    { kind: "GRADE_OFFERS_TWO_HOMES_FOR_SAME_SUBJECT", gradeId: "g-eg", nameEn: "Arabic", subjectIds: ["s1", "s2"] },
  ]);
});

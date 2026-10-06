import { findOfferedSubject, findOfferedSubjects, gradeOfferingWhere } from "./grade-subject.util";

function dbWith(rows: any[]) {
  const gradeSubject = {
    findMany: jest.fn(async ({ where }: any) =>
      rows
        .filter((r) => r.gradeId === where.gradeId)
        .filter((r) => (where.subjectId ? where.subjectId.in.includes(r.subjectId) : true))
        .filter((r) => r.isActive === where.isActive)
        .map((r) => ({ subject: r.subject })),
    ),
    findFirst: jest.fn(async ({ where }: any) =>
      rows
        .filter((r) => r.gradeId === where.gradeId && where.subjectId.in.includes(r.subjectId) && r.isActive === where.isActive)
        .map((r) => ({ subject: r.subject }))[0] ?? null,
    ),
  };
  return { gradeSubject } as any;
}

const arabic = { id: "subject-arabic-eg5", nameEn: "Arabic", nameAr: "اللغة العربية", gradeId: "grade-eg-5", isActive: true };
const math = { id: "subject-math-uk6", nameEn: "Mathematics", nameAr: "الرياضيات", gradeId: "grade-uk-6", isActive: true };

// British Year 6 offers Egyptian Grade 5 Arabic: the offering's grade and the
// subject's content home are deliberately different grades.
const OFFERINGS = [
  { gradeId: "grade-uk-6", subjectId: arabic.id, isActive: true, subject: arabic },
  { gradeId: "grade-uk-6", subjectId: math.id, isActive: true, subject: math },
  { gradeId: "grade-eg-5", subjectId: arabic.id, isActive: true, subject: arabic },
];

test("returns only the subjects the grade actually offers", async () => {
  const db = dbWith(OFFERINGS);
  const subjects = await findOfferedSubjects(db, "grade-uk-6");
  expect(subjects.map((s) => s.id).sort()).toEqual([arabic.id, math.id]);
});

test("a shared subject is returned for a grade that does not own its content home", async () => {
  const db = dbWith(OFFERINGS);
  const subjects = await findOfferedSubjects(db, "grade-uk-6", [arabic.id]);
  expect(subjects).toEqual([arabic]);
  expect(arabic.gradeId).toBe("grade-eg-5");
});

test("an empty id list means no subjects — never every subject of the grade", async () => {
  const db = dbWith(OFFERINGS);
  expect(gradeOfferingWhere("grade-uk-6", [])).toEqual({
    gradeId: "grade-uk-6",
    isActive: true,
    subject: { isActive: true, grade: { isActive: true, curriculum: { isActive: true } } },
    grade: { isActive: true, curriculum: { isActive: true } },
    subjectId: { in: [] },
  });
  expect(await findOfferedSubjects(db, "grade-uk-6", [])).toEqual([]);
});

test("omitting the id list lists the whole grade", async () => {
  // The publication gate (2026-10-06, merged from main): a subject is only
  // available through an active grade under an active curriculum — on both the
  // offering's grade and the subject's own content-home grade.
  expect(gradeOfferingWhere("grade-uk-6")).toEqual({
    gradeId: "grade-uk-6",
    isActive: true,
    subject: { isActive: true, grade: { isActive: true, curriculum: { isActive: true } } },
    grade: { isActive: true, curriculum: { isActive: true } },
  });
});

test("findOfferedSubject resolves a single offering, and null when the grade does not offer it", async () => {
  const db = dbWith(OFFERINGS);
  // Behaviour lock on the FAKE ITSELF: the real query carries gradeId, and a
  // mock that ignores it would make this test pass regardless of the filter.
  // Confirmed by execution — it returns null, so the fake does reject the
  // wrong grade and the two assertions below are not vacuous.
  const rawWrongGrade = await db.gradeSubject.findFirst({
    where: { gradeId: "grade-eg-5", isActive: true, subject: { isActive: true }, subjectId: { in: [math.id] } },
  });
  expect(rawWrongGrade).toBeNull();

  expect(await findOfferedSubject(db, "grade-uk-6", arabic.id)).toEqual(arabic);
  expect(await findOfferedSubject(db, "grade-eg-5", math.id)).toBeNull();
});

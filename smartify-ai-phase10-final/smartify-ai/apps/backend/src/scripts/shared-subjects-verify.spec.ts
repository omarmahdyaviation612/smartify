import { judgeSharedSubjects } from "./shared-subjects-verify";

const okInput = {
  invariants: [],
  sharedSubjects: [
    {
      subjectId: "s-eg-ar-2",
      nameEn: "Arabic Language",
      level: 2,
      sourceFile: "eg-national/grade-2/arabic-language/arabic-language-prim2-t1.pdf",
      units: [
        { id: "u1", sourceFileOverride: null },
        { id: "u2", sourceFileOverride: "egypt moe/grade 2/extra.pdf" },
      ],
      offeringCount: 2,
    },
  ],
};

test("a healthy shared subject produces neither failures nor warnings", () => {
  expect(judgeSharedSubjects(okInput)).toEqual({ failures: [], warnings: [] });
});

test("a unit with no resolvable source is a hard failure — shared with no grounding", () => {
  const judged = judgeSharedSubjects({
    ...okInput,
    sharedSubjects: [{ ...okInput.sharedSubjects[0], sourceFile: null, units: [{ id: "u1", sourceFileOverride: null }] }],
  });
  expect(judged.failures).toEqual([{ kind: "UNIT_WITHOUT_SOURCE", subjectId: "s-eg-ar-2", level: 2, unitId: "u1" }]);
});

test("a bare filename source is a warning, not a failure — the textbook repair is still in flight", () => {
  const judged = judgeSharedSubjects({
    ...okInput,
    sharedSubjects: [{ ...okInput.sharedSubjects[0], sourceFile: "Arabic_language_prim2_t1.pdf" }],
  });
  expect(judged.failures).toEqual([]);
  expect(judged.warnings).toEqual([
    { kind: "NON_CANONICAL_SOURCE_KEY", subjectId: "s-eg-ar-2", level: 2, sourceFile: "Arabic_language_prim2_t1.pdf" },
  ]);
});

test("a shared subject no grade offers is a hard failure", () => {
  const judged = judgeSharedSubjects({
    ...okInput,
    sharedSubjects: [{ ...okInput.sharedSubjects[0], offeringCount: 0 }],
  });
  expect(judged.failures).toEqual([{ kind: "SHARED_SUBJECT_NOT_OFFERED", subjectId: "s-eg-ar-2", level: 2 }]);
});

test("invariant violations are reported as failures", () => {
  const judged = judgeSharedSubjects({
    ...okInput,
    invariants: [{ kind: "SUBJECT_WITHOUT_HOME_OFFERING", subjectId: "s-x", nameEn: "X", gradeId: "g-x" }],
  });
  expect(judged.failures).toHaveLength(1);
});

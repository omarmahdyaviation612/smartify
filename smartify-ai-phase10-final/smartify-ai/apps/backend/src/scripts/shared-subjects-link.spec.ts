import { applyPlan, loadSnapshot, renderDryRun } from "./shared-subjects-link";
import { planSharedSubjects, type Snapshot } from "./shared-subjects-map";

type State = { offerings: any[]; subjects: any[]; entitlements: any[] };

function fakeDb(state: State) {
  const tx = {
    gradeSubject: {
      upsert: jest.fn(async ({ where, create }: any) => {
        const exists = state.offerings.find(
          (o) => o.gradeId === where.gradeId_subjectId.gradeId && o.subjectId === where.gradeId_subjectId.subjectId,
        );
        if (exists) {
          exists.isActive = true;
          return exists;
        }
        const row = { id: `off-${create.gradeId}-${create.subjectId}`, ...create, isActive: true };
        state.offerings.push(row);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const o of state.offerings) {
          if (o.gradeId === where.gradeId && o.subjectId === where.subjectId) {
            o.isActive = data.isActive;
            count += 1;
          }
        }
        return { count };
      }),
      findMany: jest.fn(async () => state.offerings),
    },
    subject: {
      update: jest.fn(async ({ where, data }: any) => {
        const s = state.subjects.find((x) => x.id === where.id)!;
        Object.assign(s, data);
        return s;
      }),
    },
    studentSubject: {
      findUnique: jest.fn(async ({ where }: any) =>
        state.entitlements.find(
          (e) => e.studentId === where.studentId_subjectId.studentId && e.subjectId === where.studentId_subjectId.subjectId,
        ) ?? null,
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const e = state.entitlements.find(
          (x) => x.studentId === where.studentId_subjectId.studentId && x.subjectId === where.studentId_subjectId.subjectId,
        )!;
        if (data.subjectId) e.subjectId = data.subjectId;
        if ("expiresAt" in data) e.expiresAt = data.expiresAt;
        return e;
      }),
      delete: jest.fn(async ({ where }: any) => {
        const i = state.entitlements.findIndex(
          (x) => x.studentId === where.studentId_subjectId.studentId && x.subjectId === where.studentId_subjectId.subjectId,
        );
        return state.entitlements.splice(i, 1)[0];
      }),
    },
  };
  return { client: tx, $transaction: (fn: any) => fn(tx) } as any;
}

const SNAPSHOT: Snapshot = {
  grades: [
    { id: "g-eg-2", level: 2, curriculumCode: "EG_NATIONAL", isActive: true },
    { id: "g-uk-2", level: 2, curriculumCode: "BRITISH_INTL", isActive: true },
  ],
  subjects: [
    { id: "s-eg-ar-2", nameEn: "Arabic Language", gradeId: "g-eg-2", isActive: true, unitCount: 4, topicCount: 19, entitlementCount: 0 },
    { id: "s-uk-ar-2", nameEn: "Arabic", gradeId: "g-uk-2", isActive: true, unitCount: 0, topicCount: 0, entitlementCount: 0 },
  ],
  offerings: [],
  entitlements: [],
};

/** Mirrors the real database after Phase 1's backfill: every subject has a home offering. */
function initialState(subjects: Snapshot["subjects"]): State {
  return {
    offerings: [
      { id: "off-g-eg-2-s-eg-ar-2", gradeId: "g-eg-2", subjectId: "s-eg-ar-2", isActive: true },
      { id: "off-g-uk-2-s-uk-ar-2", gradeId: "g-uk-2", subjectId: "s-uk-ar-2", isActive: true },
    ],
    subjects: JSON.parse(JSON.stringify(subjects)),
    entitlements: [],
  };
}

test("dry run reports what would change and never writes", async () => {
  const state = initialState(SNAPSHOT.subjects);
  const db = fakeDb(state);

  const text = renderDryRun(planSharedSubjects(SNAPSHOT));

  expect(text).toContain("links: 1");
  expect(text).toContain("withdrawals: 1");
  expect(text).toContain("blocked: 0");
  expect(db.client.gradeSubject.upsert).not.toHaveBeenCalled();
  expect(state.subjects.find((s: any) => s.id === "s-uk-ar-2").isActive).toBe(true);
});

test("apply links the offering, deactivates the empty duplicate, and is idempotent", async () => {
  const state = initialState(SNAPSHOT.subjects);
  const db = fakeDb(state);
  const plan = planSharedSubjects(SNAPSHOT);

  const first = await applyPlan(db, plan);
  expect(first.offeringsCreated).toBe(1);
  expect(first.offeringsDeactivated).toBe(1);
  expect(first.subjectsDeactivated).toBe(1);
  expect(state.offerings.find((o: any) => o.subjectId === "s-uk-ar-2").isActive).toBe(false);
  // The shared pair exists exactly once. Note s-eg-ar-2 is legitimately
  // offered by TWO grades now — its Egyptian content home (from Phase 1's
  // backfill) and British level 2 (this link). Counting all rows for the
  // subject would assert the link never happened, which is the opposite of
  // this phase's purpose.
  expect(
    state.offerings.filter((o: any) => o.gradeId === "g-uk-2" && o.subjectId === "s-eg-ar-2" && o.isActive),
  ).toHaveLength(1);
  expect(state.subjects.find((s: any) => s.id === "s-uk-ar-2").isActive).toBe(false);

  // Re-running the same plan must not create a second offering for the pair.
  const second = await applyPlan(db, planSharedSubjects({ ...SNAPSHOT, offerings: state.offerings as any }));
  expect(second.offeringsCreated).toBe(0);
  expect(state.offerings.filter((o: any) => o.gradeId === "g-uk-2" && o.subjectId === "s-eg-ar-2")).toHaveLength(1);
});

test("apply refuses to run at all while anything is blocked", async () => {
  const blockedSubjects = SNAPSHOT.subjects.map((s) => (s.id === "s-uk-ar-2" ? { ...s, unitCount: 2 } : s));
  const blockedSnapshot: Snapshot = { ...SNAPSHOT, subjects: blockedSubjects };
  const state = initialState(blockedSubjects);
  const db = fakeDb(state);

  await expect(applyPlan(db, planSharedSubjects(blockedSnapshot))).rejects.toThrow(/blocked/i);
  expect(db.client.gradeSubject.upsert).not.toHaveBeenCalled();
});

test("a collision keeps the more permissive entitlement and removes the redundant row", async () => {
  const snapshot: Snapshot = {
    ...SNAPSHOT,
    entitlements: [
      { studentId: "st-1", subjectId: "s-uk-ar-2", expiresAt: new Date("2026-11-01T00:00:00Z"), studentGradeLevel: 2, studentCurriculumCode: "BRITISH_INTL" },
    ],
  };
  const state = initialState(snapshot.subjects);
  state.entitlements = [
    { studentId: "st-1", subjectId: "s-uk-ar-2", expiresAt: new Date("2026-11-01T00:00:00Z") },
    { studentId: "st-1", subjectId: "s-eg-ar-2", expiresAt: null },
  ];
  const db = fakeDb(state);

  const result = await applyPlan(db, planSharedSubjects(snapshot));

  expect(result.entitlementsRepointed).toBe(0);
  expect(result.entitlementsDeduplicated).toBe(1);
  expect(state.entitlements).toEqual([{ studentId: "st-1", subjectId: "s-eg-ar-2", expiresAt: null }]);
});

test("a non-colliding entitlement is moved, not duplicated", async () => {
  const snapshot: Snapshot = {
    ...SNAPSHOT,
    entitlements: [
      { studentId: "st-1", subjectId: "s-uk-ar-2", expiresAt: null, studentGradeLevel: 2, studentCurriculumCode: "BRITISH_INTL" },
    ],
  };
  const state = initialState(snapshot.subjects);
  state.entitlements = [{ studentId: "st-1", subjectId: "s-uk-ar-2", expiresAt: null }];
  const db = fakeDb(state);

  const result = await applyPlan(db, planSharedSubjects(snapshot));

  expect(result.entitlementsRepointed).toBe(1);
  expect(result.entitlementsDeduplicated).toBe(0);
  expect(state.entitlements).toEqual([{ studentId: "st-1", subjectId: "s-eg-ar-2", expiresAt: null }]);
});

test("loadSnapshot reads counts and student levels into the shape the planner understands", async () => {
  const db = {
    grade: { findMany: jest.fn(async () => [
      { id: "g-eg-2", level: 2, isActive: true, curriculum: { code: "EG_NATIONAL" } },
      { id: "g-uk-2", level: 2, isActive: true, curriculum: { code: "BRITISH_INTL" } },
    ]) },
    subject: { findMany: jest.fn(async () => [
      { id: "s-eg-ar-2", nameEn: "Arabic Language", gradeId: "g-eg-2", isActive: true, _count: { studentSubjects: 0 }, units: [{ _count: { topics: 19 } }] },
      { id: "s-uk-ar-2", nameEn: "Arabic", gradeId: "g-uk-2", isActive: true, _count: { studentSubjects: 0 }, units: [] },
    ]) },
    gradeSubject: { findMany: jest.fn(async () => []) },
    studentSubject: { findMany: jest.fn(async () => [
      { studentId: "st-1", subjectId: "s-uk-ar-2", expiresAt: null, student: { grade: { level: 2, curriculum: { code: "BRITISH_INTL" } } } },
    ]) },
  } as any;

  const snapshot = await loadSnapshot(db);

  expect(snapshot.grades).toEqual([
    { id: "g-eg-2", level: 2, curriculumCode: "EG_NATIONAL", isActive: true },
    { id: "g-uk-2", level: 2, curriculumCode: "BRITISH_INTL", isActive: true },
  ]);
  expect(snapshot.subjects).toEqual([
    { id: "s-eg-ar-2", nameEn: "Arabic Language", gradeId: "g-eg-2", isActive: true, unitCount: 1, topicCount: 19, entitlementCount: 0 },
    { id: "s-uk-ar-2", nameEn: "Arabic", gradeId: "g-uk-2", isActive: true, unitCount: 0, topicCount: 0, entitlementCount: 0 },
  ]);
  expect(snapshot.entitlements).toEqual([
    { studentId: "st-1", subjectId: "s-uk-ar-2", expiresAt: null, studentGradeLevel: 2, studentCurriculumCode: "BRITISH_INTL" },
  ]);
});

test("subject identification uses (name, curriculum), never name alone", async () => {
  // "Social Studies" exists under BOTH curricula with the identical name, so the
  // query must separate the reference rows from the duplicates by curriculum.
  const db = {
    grade: { findMany: jest.fn(async () => []) },
    subject: { findMany: jest.fn(async ({ where }: any) => {
      expect(where.OR).toEqual([
        { nameEn: { in: ["Arabic Language", "Social Studies"] }, grade: { curriculum: { code: "EG_NATIONAL" } } },
        { nameEn: { in: ["Arabic Language", "Arabic", "Social Studies"] }, grade: { curriculum: { code: { not: "EG_NATIONAL" } } } },
      ]);
      return [];
    }) },
    gradeSubject: { findMany: jest.fn(async () => []) },
    studentSubject: { findMany: jest.fn(async () => []) },
  } as any;

  await loadSnapshot(db);
});

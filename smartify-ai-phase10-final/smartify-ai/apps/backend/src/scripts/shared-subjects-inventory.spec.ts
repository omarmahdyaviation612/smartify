import { collectInventory, parseIdList, SHARED_SUBJECT_NAMES } from "./shared-subjects-inventory";

const FORBIDDEN = /^(create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw|\$executeRawUnsafe|\$queryRawUnsafe)$/;

/** Any write method on any model throws, so "read-only" is enforced, not asserted. */
function readOnly(models: Record<string, any>) {
  return new Proxy<Record<string, any>>(models, {
    get(target, modelName: string) {
      const model = target[modelName];
      if (!model) return undefined;
      return new Proxy(model, {
        get(m, method: string) {
          if (FORBIDDEN.test(method)) throw new Error(`read-only inventory must not call ${modelName}.${method}`);
          return m[method];
        },
      });
    },
  });
}

function models(overrides: Record<string, any> = {}) {
  return {
    subject: {
      findMany: jest.fn(async () => overrides.subjects ?? [
        {
          id: "sub-ar-eg5", nameEn: "Arabic", nameAr: "اللغة العربية", isActive: true,
          sourceFile: "egypt moe/grade 5/arabic.pdf", priceEGP: 150,
          grade: { id: "g-eg-5", nameEn: "Grade 5", level: 5, isActive: true, curriculum: { code: "EG_NATIONAL", nameEn: "Egyptian National" } },
          _count: { studentSubjects: 12 },
        },
        {
          id: "sub-ar-uk6", nameEn: "Arabic", nameAr: "اللغة العربية", isActive: true,
          sourceFile: null, priceEGP: null,
          grade: { id: "g-uk-6", nameEn: "Year 6", level: 6, isActive: true, curriculum: { code: "BRITISH_INTL", nameEn: "British International" } },
          _count: { studentSubjects: 4 },
        },
        {
          id: "sub-ar-us5", nameEn: "Arabic", nameAr: "اللغة العربية", isActive: true,
          sourceFile: null, priceEGP: null,
          grade: { id: "g-us-5", nameEn: "Grade 5", level: 5, isActive: true, curriculum: { code: "AMERICAN_INTL", nameEn: "American International" } },
          _count: { studentSubjects: 0 },
        },
      ]),
    },
    unit: {
      findMany: jest.fn(async () => overrides.units ?? [
        { id: "u1", subjectId: "sub-ar-eg5", nameEn: "Unit 1", groundingNotesJson: { concepts: [] } },
        { id: "u2", subjectId: "sub-ar-eg5", nameEn: "Unit 2", groundingNotesJson: null },
      ]),
    },
    topic: {
      findMany: jest.fn(async () => overrides.topics ?? [
        { id: "t1", unitId: "u1", teachingStepsJson: { steps: [] } },
        { id: "t2", unitId: "u2", teachingStepsJson: null },
      ]),
    },
    lesson: { findMany: jest.fn(async () => overrides.lessons ?? [{ id: "l1", topicId: "t1" }]) },
    lessonTrial: { findMany: jest.fn(async () => overrides.trials ?? [{ id: "tr1", subjectIds: ["sub-ar-uk6", "sub-ar-us5"] }]) },
    subscription: { findMany: jest.fn(async () => overrides.subscriptions ?? [{ id: "s1", selectedSubjectIds: ["sub-ar-eg5"] }]) },
  };
}

test("groups duplicate subjects by name so the decision surface is explicit", async () => {
  const report = await collectInventory(readOnly(models()) as any);
  expect(report.subjectNames).toEqual([...SHARED_SUBJECT_NAMES]);
  expect(report.byName.Arabic).toHaveLength(3);
  expect(report.byName.Arabic[0]).toMatchObject({
    subjectId: "sub-ar-eg5", curriculumCode: "EG_NATIONAL", gradeLevel: 5,
    unitCount: 2, groundedUnitCount: 1, topicCount: 2, generatedTopicCount: 1,
    lessonCount: 1, studentSubjectCount: 12, trialRefCount: 0, subscriptionRefCount: 1,
  });
  expect(report.byName.Arabic[1]).toMatchObject({
    subjectId: "sub-ar-uk6", curriculumCode: "BRITISH_INTL", gradeLevel: 6,
    unitCount: 0, lessonCount: 0, studentSubjectCount: 4, trialRefCount: 1, subscriptionRefCount: 0,
  });
  expect(report.totals).toMatchObject({ subjectCount: 3, subjectsWithContent: 1, unitCount: 2, topicCount: 2, lessonCount: 1 });
});

test("the collector cannot write, even by accident", async () => {
  const db = readOnly(models()) as any;
  await collectInventory(db);
  expect(() => db.subject.deleteMany()).toThrow(/read-only/);
  expect(() => db.subject.updateMany()).toThrow(/read-only/);
});

test("parseIdList tolerates a JSON string, a JSON array, and junk", () => {
  expect(parseIdList('["a","b"]')).toEqual(["a", "b"]);
  expect(parseIdList(["a", 1, null, "b"])).toEqual(["a", "b"]);
  expect(parseIdList(null)).toEqual([]);
  expect(parseIdList("not json")).toEqual([]);
});

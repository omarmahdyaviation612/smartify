import { classify, applyReviewed } from "./map-core-textbooks-db";
import { phase1Mappings } from "./core-textbook-phase1-verified";

function harness() {
  const subject = {
    findMany: jest.fn(async ({ where }: any) => {
      const item = phase1Mappings.find(i => i.subject === where.nameEn && i.grade === where.grade.nameEn && i.curriculum === where.grade.curriculum.code)!;
      return [{ id: item.newSourceFile, sourceFile: item.expectedSourceFile }];
    }),
    updateMany: jest.fn(async () => ({ count: 1 })),
  };
  const db: any = { subject };
  db.$transaction = jest.fn(async (fn: any) => fn(db));
  return db;
}
test("dry-run matches 44 exact identities, excludes Year 5 Mathematics and never writes", async () => {
  const db = harness();
  const rows = await classify(db);
  expect(rows.filter(r => r.status === "READY_TO_UPDATE")).toHaveLength(44);
  expect(rows.filter(r => r.status === "EXCLUDED")).toHaveLength(1);
  expect(rows.find(r => r.status === "EXCLUDED")).toMatchObject({ curriculum: "BRITISH_INTL", grade: "Year 5", subject: "Mathematics" });
  expect(db.subject.findMany).toHaveBeenCalledTimes(44);
  expect(db.subject.updateMany).not.toHaveBeenCalled();
  expect(db.$transaction).not.toHaveBeenCalled();
});
test("classifies canonical, unexpected, absent and duplicate mappings conservatively", async () => {
  const db = harness();
  db.subject.findMany.mockResolvedValueOnce([{ id: "a", sourceFile: phase1Mappings[0].newSourceFile }])
    .mockResolvedValueOnce([{ id: "b", sourceFile: "extras/story.pdf" }])
    .mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "c", sourceFile: "x" }, { id: "d", sourceFile: "x" }]);
  expect((await classify(db)).slice(0, 4).map(r => r.status)).toEqual(["ALREADY_MAPPED", "SOURCE_MISMATCH", "SUBJECT_NOT_FOUND", "AMBIGUOUS"]);
});
test("apply changes only sourceFile using reviewed ID and old sourceFile; repeat skips", async () => {
  const db = harness();
  const row = (await classify(db))[0];
  expect(await applyReviewed(db, [row])).toEqual([{ subjectId: row.subjectId, status: "UPDATED" }]);
  expect(db.subject.updateMany).toHaveBeenCalledWith({ where: { id: row.subjectId, sourceFile: row.oldSourceFile }, data: { sourceFile: row.newSourceFile } });
  db.subject.updateMany.mockClear();
  db.subject.findMany.mockResolvedValue([{ id: row.subjectId!, sourceFile: row.newSourceFile }]);
  expect(await applyReviewed(db, [row])).toEqual([{ subjectId: row.subjectId, status: "SKIPPED_CHANGED_SINCE_REVIEW" }]);
  expect(db.subject.updateMany).not.toHaveBeenCalled();
});
test("apply skips changed Subject ID and refuses unreviewed mapping values", async () => {
  const db = harness();
  const row = (await classify(db))[0];
  db.subject.findMany.mockResolvedValue([{ id: "replaced-id", sourceFile: row.oldSourceFile! }]);
  expect(await applyReviewed(db, [row])).toEqual([{ subjectId: row.subjectId, status: "SKIPPED_CHANGED_SINCE_REVIEW" }]);
  expect(db.subject.updateMany).not.toHaveBeenCalled();
  await expect(applyReviewed(db, [{ ...row, newSourceFile: "extras/unsafe.pdf" }])).rejects.toThrow();
});

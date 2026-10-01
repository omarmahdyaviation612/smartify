import { parseArgs, planBook, runRepair, selectBooks, validatePlan, type LiveSubject, type PlanBook, type RepairPlan } from "./repair-unit-page-offset";

const SUBJ = "subjectaaaaaaaaaaaaaaaaaaaa1", OKB = "subjectokokokokokokokokokok1", EDM = "subjectededededededededede01", PCW = "subjectpwpwpwpwpwpwpwpwpwp01";
const book = (over: Partial<PlanBook> = {}): PlanBook => ({
  subjectId: SUBJ, label: "EG G4 Maths", classification: "OFFSET_CONSTANT", sourceFile: "eg/g4/math.pdf", sourceSha256: "a".repeat(64), physicalPageCount: 136, offset: 8,
  offsetEvidence: "P72=64", finalUnitContentEnd: 135, finalUnitBoundaryEvidence: "P136 colophon",
  expectedUnits: [{ unitId: "unitaaaaaaaaaaaaaaaaaaaaaa1", order: 1, persistedStart: 3, persistedEnd: 23 }, { unitId: "unitaaaaaaaaaaaaaaaaaaaaaa2", order: 2, persistedStart: 24, persistedEnd: 99 }, { unitId: "unitaaaaaaaaaaaaaaaaaaaaaa3", order: 3, persistedStart: 100, persistedEnd: 136 }],
  ...over,
});
const plan = (books: PlanBook[] = [book()]): RepairPlan => ({ version: 1, books, excluded: [
  { subjectId: OKB, label: "OK book", classification: "OK", reason: "offset 0" },
  { subjectId: EDM, label: "G5 Islamic", classification: "EDITION_MISMATCH", reason: "copied catalog" },
  { subjectId: PCW, label: "piecewise", classification: "OFFSET_NONCONSTANT", reason: "piecewise" },
] });
const live = (over: Partial<LiveSubject> = {}): LiveSubject => ({ id: SUBJ, sourceFile: "eg/g4/math.pdf", units: [
  { id: "unitaaaaaaaaaaaaaaaaaaaaaa1", order: 1, start: 3, end: 23, override: null, topics: [{ status: "READY" }, { status: "BLOCKED" }] },
  { id: "unitaaaaaaaaaaaaaaaaaaaaaa2", order: 2, start: 24, end: 99, override: null, topics: [{ status: "READY" }] },
  { id: "unitaaaaaaaaaaaaaaaaaaaaaa3", order: 3, start: 100, end: 136, override: null, topics: [{ status: null }] },
], ...over });
const deps = (subjects: LiveSubject[] = [live()]) => ({ loadLive: jest.fn().mockResolvedValue(subjects), applyRanges: jest.fn().mockResolvedValue(undefined) });

describe("repair-unit-page-offset argument parsing", () => {
  it("defaults to dry-run with an explicit allowlist", () => expect(parseArgs([`--plan=p.json`, `--subjectIds=${SUBJ}`])).toEqual({ plan: "p.json", subjectIds: [SUBJ], snapshot: undefined, apply: false }));
  it.each([
    [[`--subjectIds=${SUBJ}`]], [[`--plan=p.json`]], [[`--plan=p.json`, `--subjectIds=`]], [[`--plan=p.json`, `--subjectIds=${SUBJ},${SUBJ}`]],
    [[`--plan=p.json`, `--subjectIds=bad id`]], [[`--plan=p.json`, `--subjectIds`, `--subjectIds=${SUBJ}`]], [[`--plan=p.json`, `--subjectIds=${SUBJ}`, `--apply=yes`]],
    [[`--plan=p.json`, `--subjectIds=${SUBJ}`, `--all`]], [[`--plan=p.json`, `--subjectIds=${SUBJ}`, `stray`]], [[`--plan=p.json`, `--subjectIds=${SUBJ}`, `--snapshot=s.json`, `--apply`]],
    [[`--plan=a.json`, `--plan=b.json`, `--subjectIds=${SUBJ}`]],
  ])("rejects malformed input %j", (argv) => expect(() => parseArgs(argv as string[])).toThrow());
});

describe("plan validation and book selection", () => {
  it("rejects zero/missing offsets, bad boundaries, duplicates and non-constant books in the eligible list", () => {
    expect(() => validatePlan(plan([book({ offset: 0 })]))).toThrow(/offset/);
    expect(() => validatePlan(plan([book({ offset: undefined as any })]))).toThrow(/offset/);
    expect(() => validatePlan(plan([book({ finalUnitContentEnd: 137 })]))).toThrow(/boundary/);
    expect(() => validatePlan(plan([book(), book()]))).toThrow(/duplicate/);
    expect(() => validatePlan(plan([book({ classification: "OFFSET_NONCONSTANT" as any })]))).toThrow(/OFFSET_CONSTANT/);
    expect(() => validatePlan(plan([book({ sourceSha256: "x" })]))).toThrow(/source identity/);
  });
  it("rejects unknown, OK, edition-mismatch and piecewise books by name", () => {
    const p = validatePlan(plan());
    expect(() => selectBooks(p, ["subjectunknownunknownunknown1"])).toThrow(/unknown book/);
    expect(() => selectBooks(p, [OKB])).toThrow(/is OK/);
    expect(() => selectBooks(p, [EDM])).toThrow(/EDITION_MISMATCH/);
    expect(() => selectBooks(p, [PCW])).toThrow(/OFFSET_NONCONSTANT/);
    expect(selectBooks(p, [SUBJ])).toHaveLength(1);
  });
});

describe("deterministic range computation", () => {
  it("shifts starts by the verified offset, chains ends, and uses the verified final boundary (not the page count)", () => {
    const { rows } = planBook(book(), live());
    expect(rows.map((r) => [r.newStart, r.newEnd])).toEqual([[11, 31], [32, 107], [108, 135]]);
    expect(rows[2].newEnd).toBe(135);
    expect(rows[0]).toMatchObject({ startDelta: 8, endDelta: 8, ready: 1, blocked: 1, changes: true, includesPreviousUnitPages: true, missesCorrectedTail: true });
  });
  it("computes overlap percentage and severity against the corrected window", () => {
    const { rows } = planBook(book(), live());
    expect(rows[0]).toMatchObject({ overlapPages: 13, correctedPages: 21, overlapPct: 61.9, severity: "HIGH" });
    expect(rows[1]).toMatchObject({ overlapPages: 68, correctedPages: 76, overlapPct: 89.5, severity: "MEDIUM" });
  });
  it("is deterministic", () => expect(planBook(book(), live())).toEqual(planBook(book(), live())));
  it("never touches override (separate reader) units", () => {
    const withReader = live({ units: [...live().units, { id: "unitreaderreaderreaderread1", order: 4, start: 1, end: 12, override: "reader.pdf", topics: [{ status: "READY" }] }] });
    const { rows, skipped } = planBook(book(), withReader);
    expect(rows.map((r) => r.unitId)).not.toContain("unitreaderreaderreaderread1");
    expect(skipped).toEqual([{ subjectId: SUBJ, unitId: "unitreaderreaderreaderread1" }]);
  });
  it("fails closed on source-file change, unit drift, or invalid corrected ranges", () => {
    expect(() => planBook(book(), live({ sourceFile: "other.pdf" }))).toThrow(/source file changed/);
    expect(() => planBook(book(), live({ units: live().units.slice(0, 2) }))).toThrow(/unit count drifted/);
    const drifted = live(); drifted.units[1].start = 25; expect(() => planBook(book(), drifted)).toThrow(/drifted/);
    expect(() => planBook(book({ finalUnitContentEnd: 100 }), live())).toThrow(/correctedEnd < correctedStart/);
    expect(() => planBook(book({ offset: -5 }), live())).toThrow(/correctedStart < 1/);
    expect(() => planBook(book({ physicalPageCount: 120, finalUnitContentEnd: 120, offset: 30 }), live())).toThrow();
  });
});

describe("runRepair", () => {
  it("dry-run performs zero writes", async () => {
    const d = deps(); const r = await runRepair({ plan: plan(), subjectIds: [SUBJ], apply: false }, d);
    expect(r.mode).toBe("DRY_RUN"); expect(d.applyRanges).not.toHaveBeenCalled();
    expect(r.books[0]).toMatchObject({ units: 3, unitsChanging: 3, ready: 2, blocked: 1, correctedPages: 125 });
  });
  it("preflights the whole batch before any write: one invalid book blocks every write", async () => {
    const second = book({ subjectId: "subjectbbbbbbbbbbbbbbbbbbbb2", label: "second" });
    const d = deps([live(), live({ id: "subjectbbbbbbbbbbbbbbbbbbbb2", sourceFile: "changed.pdf" })]);
    await expect(runRepair({ plan: plan([book(), second]), subjectIds: [SUBJ, "subjectbbbbbbbbbbbbbbbbbbbb2"], apply: true }, d)).rejects.toThrow(/source file changed/);
    expect(d.applyRanges).not.toHaveBeenCalled();
  });
  it("apply passes compare-and-set expectations for changed units only", async () => {
    const d = deps(); await runRepair({ plan: plan(), subjectIds: [SUBJ], apply: true }, d);
    expect(d.applyRanges).toHaveBeenCalledTimes(1);
    expect(d.applyRanges.mock.calls[0][0][0]).toEqual({ unitId: "unitaaaaaaaaaaaaaaaaaaaaaa1", expectedStart: 3, expectedEnd: 23, start: 11, end: 31 });
  });
  it("rejects a missing live subject", async () => {
    const d = deps([]); await expect(runRepair({ plan: plan(), subjectIds: [SUBJ], apply: false }, d)).rejects.toThrow(/not found live/);
  });
});

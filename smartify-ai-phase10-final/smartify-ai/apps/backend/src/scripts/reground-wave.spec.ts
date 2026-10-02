import { classify, comparePageRanges, parseArgs, runWave, type LiveUnit, type Snapshot, type UnitOutcome } from "./reground-wave";
import { approvedTarget } from "./reground-unit";
import type { RepairPlan } from "./repair-unit-page-offset";

const KEY = "eg/g6/math.pdf", BOOK = "subjectaaaaaaaaaaaaaaaaaaaa1";
const U = ["unitaaaaaaaaaaaaaaaaaaaaaa1", "unitaaaaaaaaaaaaaaaaaaaaaa2", "unitaaaaaaaaaaaaaaaaaaaaaa3"];
const plan: RepairPlan = { version: 1, excluded: [], books: [{ subjectId: BOOK, label: "EG G6 Maths", classification: "OFFSET_CONSTANT", sourceFile: KEY, sourceSha256: "a".repeat(64), physicalPageCount: 122, offset: 9, offsetEvidence: "e", finalUnitContentEnd: 120, finalUnitBoundaryEvidence: "e",
  expectedUnits: [{ unitId: U[0], order: 1, persistedStart: 1, persistedEnd: 14 }, { unitId: U[1], order: 2, persistedStart: 15, persistedEnd: 34 }, { unitId: U[2], order: 3, persistedStart: 35, persistedEnd: 58 }] }] };
const T = U.map((u) => approvedTarget(plan, u));
const snap = (over: Partial<Snapshot> = {}): Snapshot => ({ units: {}, ranges: {}, assignByTopic: {}, teachingSteps: "t", questions: "q", questionDrafts: "d", tse: "e", progress: "p", ready: 10, blocked: 1, ...over });

function harness(initial: Record<string, "old" | "new">, opts: { genFail?: Record<string, string>; rebuildThrows?: string; casZero?: string; topicStates?: string } = {}) {
  const state: Record<string, LiveUnit> = {};
  T.forEach((t, i) => { const done = initial[t.unitId] === "new"; state[t.unitId] = { id: t.unitId, sourceFileOverride: null, subjectSourceFile: KEY, sourcePageStart: t.newStart, sourcePageEnd: t.newEnd, groundingSourceFingerprint: done ? t.newFingerprint : t.oldFingerprint, hasNotes: true, topics: [{ id: `topic${i}xxxxxxxxxxxxxxxxxxxx`, nameEn: "T", status: "READY", fingerprint: done ? t.newFingerprint : t.oldFingerprint }] }; });
  const reports: any[] = [];
  const deps: any = {
    loadUnit: jest.fn(async (id: string) => JSON.parse(JSON.stringify(state[id] ?? null))),
    generate: jest.fn(async (id: string) => { if (opts.genFail?.[id]) throw new Error(opts.genFail[id]); const t = T.find((x) => x.unitId === id)!; return { notes: { concepts: [{ name: "c", sourcePages: [t.newStart] }] }, model: "m", chunkCount: 2, sourceKey: KEY, pageStart: t.newStart, pageEnd: t.newEnd, groundingVersion: 1, groundingPromptVersion: "v2" }; }),
    replace: jest.fn(async (t: any) => { if (opts.casZero === t.unitId) return 0; state[t.unitId].groundingSourceFingerprint = t.newFingerprint; return 1; }),
    rebuildAssignments: jest.fn(async (ids: string[]) => { if (opts.rebuildThrows) throw new Error(opts.rebuildThrows); for (const u of Object.values(state)) for (const tp of u.topics) if (ids.includes(tp.id)) tp.fingerprint = u.groundingSourceFingerprint; return { deterministicRecovered: ids.length, compactMapperAttempted: 0, compactMapperRecovered: 0 }; }),
    verifyTopics: jest.fn(async (id: string) => state[id].topics.map((tp) => ({ id: tp.id, nameEn: "T", state: (opts.topicStates as any) ?? "READY_CURRENT", method: "KEYWORD_OVERLAP" }))),
    snapshot: jest.fn(async () => snap()),
    accountingSince: jest.fn(async () => ({ usageRows: 2, byFeature: { grounding_extraction: 2 }, inputTokens: 10, outputTokens: 1, costUsd: 0.02, reservations: { RECONCILED: 2 }, reconciledUsd: 0.02 })),
    health: jest.fn(async () => ({ live: 200, ready: 200 })),
    now: () => new Date("2026-10-02T00:00:00Z"),
    writeReport: (r: any) => reports.push(JSON.parse(JSON.stringify(r))),
  };
  return { deps, state, reports };
}
const run = (h: any, apply = true, prior = new Map<string, UnitOutcome>()) => runWave({ plan, subjectIds: [BOOK], apply, prior }, h.deps);

describe("reground-wave classification", () => {
  const live = (t: any, fp: string, topicFp = fp): LiveUnit => ({ id: t.unitId, sourceFileOverride: null, subjectSourceFile: KEY, sourcePageStart: t.newStart, sourcePageEnd: t.newEnd, groundingSourceFingerprint: fp, hasNotes: true, topics: [{ id: "x", nameEn: "x", status: "READY", fingerprint: topicFp }] });
  it("classifies completed, eligible, partial, drifted and previously failed Units", () => {
    expect(classify(T[0], live(T[0], T[0].newFingerprint), new Map())).toBe("ALREADY_COMPLETED");
    expect(classify(T[0], live(T[0], T[0].oldFingerprint), new Map())).toBe("READY_TO_REGROUND");
    expect(classify(T[0], live(T[0], T[0].newFingerprint, T[0].oldFingerprint), new Map())).toBe("PARTIAL_ASSIGNMENT");
    expect(classify(T[0], live(T[0], T[0].newFingerprint, T[0].oldFingerprint), new Map([[T[0].unitId, "COMPLETED" as UnitOutcome]]))).toBe("ALREADY_COMPLETED");
    expect(classify(T[0], live(T[0], "somethingelse"), new Map())).toBe("DRIFTED");
    expect(classify(T[0], { ...live(T[0], T[0].oldFingerprint), sourcePageStart: 1 }, new Map())).toBe("DRIFTED");
    expect(classify(T[0], { ...live(T[0], T[0].oldFingerprint), subjectSourceFile: "x.pdf" }, new Map())).toBe("DRIFTED");
    expect(classify(T[0], live(T[0], T[0].oldFingerprint), new Map([[T[0].unitId, "FAILED_BEFORE_REPLACEMENT" as UnitOutcome]]))).toBe("FAILED_PREVIOUSLY");
  });
  it("parses an explicit ordered book list", () => {
    expect(parseArgs([`--plan=p`, `--subjectIds=${BOOK}`]).apply).toBe(false);
    expect(() => parseArgs([`--plan=p`, `--subjectIds=${BOOK},${BOOK}`])).toThrow();
    expect(() => parseArgs([`--plan=p`])).toThrow();
    expect(() => parseArgs([`--plan=p`, `--subjectIds=${BOOK}`, `--force`])).toThrow();
  });
});

describe("reground-wave execution", () => {
  it("dry-run classifies only — no generation or writes", async () => {
    const h = harness({ [U[0]]: "new" }); const r = await run(h, false);
    expect(r.classification.map((c) => c.classification)).toEqual(["ALREADY_COMPLETED", "READY_TO_REGROUND", "READY_TO_REGROUND"]);
    expect(h.deps.generate).not.toHaveBeenCalled(); expect(h.deps.replace).not.toHaveBeenCalled();
  });
  it("skips completed (pilot) Units, re-grounds the rest, rebuilds only each Unit's Topics, and checkpoints the book", async () => {
    const h = harness({ [U[0]]: "new" }); const r = await run(h);
    expect(r.status).toBe("COMPLETED");
    expect(r.units.map((u) => u.outcome)).toEqual(["SKIPPED_ALREADY_COMPLETED", "COMPLETED", "COMPLETED"]);
    expect(h.deps.generate).toHaveBeenCalledTimes(2); expect(h.deps.generate).not.toHaveBeenCalledWith(U[0]);
    expect(h.deps.rebuildAssignments.mock.calls).toEqual([[["topic1xxxxxxxxxxxxxxxxxxxx"]], [["topic2xxxxxxxxxxxxxxxxxxxx"]]]);
    expect(r.books[0]).toMatchObject({ passed: true, unitsCompleted: 2 });
  });
  it("is resumable: a re-run regenerates nothing that already completed", async () => {
    const h = harness({ [U[0]]: "new", [U[1]]: "new", [U[2]]: "new" }); const r = await run(h);
    expect(r.units.every((u) => u.outcome === "SKIPPED_ALREADY_COMPLETED")).toBe(true); expect(h.deps.generate).not.toHaveBeenCalled();
  });
  it("stops before any work when a Unit has drifted", async () => {
    const h = harness({}); h.state[U[2]].groundingSourceFingerprint = "unexpected"; const r = await run(h);
    expect(r.status).toBe("STOPPED"); expect(r.stopReason).toMatch(/DRIFTED/); expect(h.deps.generate).not.toHaveBeenCalled();
  });
  it("stops before any work on a partial Unit (corrected grounding, stale assignments, no completion record)", async () => {
    const h = harness({}); h.state[U[1]].groundingSourceFingerprint = T[1].newFingerprint; const r = await run(h);
    expect(r.stopReason).toMatch(/PARTIAL_ASSIGNMENT/); expect(h.deps.generate).not.toHaveBeenCalled();
  });
  it("keeps old grounding on a generation failure, continues once, and stops on a repeated failure", async () => {
    const h = harness({}, { genFail: { [U[0]]: "Grounding extraction failed validation", [U[1]]: "Renderer page count does not match" } }); const r = await run(h);
    expect(r.units.map((u) => u.outcome)).toEqual(["FAILED_BEFORE_REPLACEMENT", "FAILED_BEFORE_REPLACEMENT"]);
    expect(r.stopReason).toMatch(/repeated failure/); expect(h.deps.replace).not.toHaveBeenCalled(); expect(h.state[U[0]].groundingSourceFingerprint).toBe(T[0].oldFingerprint);
  });
  it("stops immediately on a budget rejection without replacing", async () => {
    const h = harness({}, { genFail: { [U[0]]: "Grounding extraction budget reservation refused (daily_limit)." } }); const r = await run(h);
    expect(r.stopReason).toMatch(/budget rejection/); expect(h.deps.replace).not.toHaveBeenCalled(); expect(h.deps.generate).toHaveBeenCalledTimes(1);
  });
  it("skips Units recorded as failed in a prior report (no automatic retry)", async () => {
    const h = harness({}); const r = await run(h, true, new Map([[U[0], "FAILED_BEFORE_REPLACEMENT" as UnitOutcome]]));
    expect(r.units[0].outcome).toBe("SKIPPED_FAILED_PREVIOUSLY"); expect(h.deps.generate).not.toHaveBeenCalledWith(U[0]);
  });
  it("stops on a refused compare-and-set (state changed during generation)", async () => {
    const h = harness({}, { casZero: U[0] }); const r = await run(h);
    expect(r.units[0].outcome).toBe("FAILED_GUARDED_REPLACEMENT"); expect(r.status).toBe("STOPPED"); expect(h.deps.rebuildAssignments).not.toHaveBeenCalled();
  });
  it("records GROUNDING_REPLACED_ASSIGNMENT_FAILED and stops when the rebuild throws", async () => {
    const h = harness({}, { rebuildThrows: "mapper provider down" }); const r = await run(h);
    expect(r.units[0].outcome).toBe("GROUNDING_REPLACED_ASSIGNMENT_FAILED"); expect(h.deps.generate).toHaveBeenCalledTimes(1);
  });
  it("treats BLOCKED Topics as a normal outcome but a READY Topic with an empty slice as a stop", async () => {
    const blocked = harness({}, { topicStates: "BLOCKED_CURRENT" }); expect((await run(blocked)).status).toBe("COMPLETED");
    const empty = harness({}, { topicStates: "READY_EMPTY_SLICE" }); const r = await run(empty); expect(r.status).toBe("STOPPED"); expect(empty.deps.generate).toHaveBeenCalledTimes(1);
  });
  it("fails the book checkpoint on unrelated changes, unreconciled reservations, or health failure", async () => {
    const h = harness({}); let n = 0; h.deps.snapshot.mockImplementation(async () => snap(n++ === 0 ? {} : { units: { unrelatedunitunrelatedunit1: "changed" } }));
    expect((await run(h)).stopReason).toMatch(/onlyProcessedUnitsChanged/);
    const h2 = harness({}); h2.deps.health.mockResolvedValue({ live: 200, ready: 503 }); expect((await run(h2)).stopReason).toMatch(/healthReady/);
    const h3 = harness({}); h3.deps.accountingSince.mockResolvedValue({ usageRows: 1, byFeature: {}, inputTokens: 1, outputTokens: 1, costUsd: 0.01, reservations: { RESERVED: 1 }, reconciledUsd: 0 }); expect((await run(h3)).status).toBe("STOPPED");
  });
});

describe("pageRangesUnchanged checkpoint (deterministic, keyed by Unit ID)", () => {
  const pre = { unitaaaaaaaaaaaaaaaaaaaaaa1: "10-23", unitaaaaaaaaaaaaaaaaaaaaaa2: "24-43", unitaaaaaaaaaaaaaaaaaaaaaa3: "44-67" };
  const reordered = { unitaaaaaaaaaaaaaaaaaaaaaa3: "44-67", unitaaaaaaaaaaaaaaaaaaaaaa1: "10-23", unitaaaaaaaaaaaaaaaaaaaaaa2: "24-43" };
  it("passes when the same Units come back in a different row order (the 2026-10-02 production false positive)", () => {
    expect(JSON.stringify(pre)).not.toBe(JSON.stringify(reordered));
    expect(comparePageRanges(pre, reordered)).toEqual([]);
  });
  it("fails on an actual start-page change", () => expect(comparePageRanges(pre, { ...reordered, unitaaaaaaaaaaaaaaaaaaaaaa2: "25-43" })).toEqual(["unit unitaaaaaaaaaaaaaaaaaaaaaa2 range 24-43 -> 25-43"]));
  it("fails on an actual end-page change", () => expect(comparePageRanges(pre, { ...reordered, unitaaaaaaaaaaaaaaaaaaaaaa3: "44-66" })).toEqual(["unit unitaaaaaaaaaaaaaaaaaaaaaa3 range 44-67 -> 44-66"]));
  it("fails when a Unit is missing after", () => { const { unitaaaaaaaaaaaaaaaaaaaaaa1: _drop, ...rest } = reordered; expect(comparePageRanges(pre, rest)).toEqual(["unit unitaaaaaaaaaaaaaaaaaaaaaa1 missing after"]); });
  it("fails on an unexpected extra Unit", () => expect(comparePageRanges(pre, { ...reordered, unitextraextraextraextraext1: "1-2" })).toEqual(["unit unitextraextraextraextraext1 unexpected after"]));
  it("the book checkpoint passes with reordered identical ranges and stops on a real range change", async () => {
    const ok = harness({}); let n = 0; ok.deps.snapshot.mockImplementation(async () => snap({ ranges: n++ === 0 ? pre : reordered }));
    const r = await run(ok); expect(r.status).toBe("COMPLETED"); expect(r.books[0].gates.pageRangesUnchanged).toBe(true);
    const bad = harness({}); let m = 0; bad.deps.snapshot.mockImplementation(async () => snap({ ranges: m++ === 0 ? pre : { ...reordered, unitaaaaaaaaaaaaaaaaaaaaaa1: "10-24" } }));
    const r2 = await run(bad); expect(r2.status).toBe("STOPPED"); expect(r2.stopReason).toMatch(/pageRangesUnchanged/); expect(r2.books[0].problems).toContain("unit unitaaaaaaaaaaaaaaaaaaaaaa1 range 10-23 -> 10-24");
  });
});

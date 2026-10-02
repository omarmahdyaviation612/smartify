import { approvedTarget, groundingSourceFingerprint, parseArgs, preflight, runReground, validateReplacement, type LiveUnitGrounding } from "./reground-unit";
import type { RepairPlan } from "./repair-unit-page-offset";

const KEY = "eg/g6/math.pdf";
const U1 = "unitaaaaaaaaaaaaaaaaaaaaaa1", U2 = "unitaaaaaaaaaaaaaaaaaaaaaa2", U3 = "unitaaaaaaaaaaaaaaaaaaaaaa3";
const plan: RepairPlan = { version: 1, excluded: [], books: [{
  subjectId: "subjectaaaaaaaaaaaaaaaaaaaa1", label: "EG G6 Maths", classification: "OFFSET_CONSTANT", sourceFile: KEY, sourceSha256: "a".repeat(64), physicalPageCount: 122, offset: 9,
  offsetEvidence: "P60=51", finalUnitContentEnd: 120, finalUnitBoundaryEvidence: "P121 colophon",
  expectedUnits: [{ unitId: U1, order: 3, persistedStart: 35, persistedEnd: 58 }, { unitId: U2, order: 4, persistedStart: 59, persistedEnd: 68 }, { unitId: U3, order: 5, persistedStart: 69, persistedEnd: 80 }],
}] };
const t = approvedTarget(plan, U2);
const live = (over: Partial<LiveUnitGrounding> = {}): LiveUnitGrounding => ({ id: U2, sourceFileOverride: null, subjectSourceFile: KEY, sourcePageStart: 68, sourcePageEnd: 77, groundingSourceFingerprint: t.oldFingerprint, hasNotes: true, ...over });
const goodGen = { notes: { concepts: [{ name: "Equations", sourcePages: [68, 70] }], facts: [{ fact: "x", sourcePages: [77] }] }, model: "gpt-4o-mini", chunkCount: 5, sourceKey: KEY, pageStart: 68, pageEnd: 77, groundingVersion: 1, groundingPromptVersion: "grounding-extraction-v2" };
const deps = (state = live(), gen: any = goodGen) => ({ loadLive: jest.fn().mockResolvedValue(state), generate: jest.fn().mockResolvedValue(gen), replace: jest.fn().mockResolvedValue(1) });

describe("reground-unit", () => {
  it("derives the approved corrected range and both fingerprints from the plan", () => {
    expect(t).toMatchObject({ oldStart: 59, oldEnd: 68, newStart: 68, newEnd: 77 });
    expect(t.oldFingerprint).toBe(groundingSourceFingerprint(KEY, 59, 68));
    expect(t.newFingerprint).toBe(groundingSourceFingerprint(KEY, 68, 77));
    expect(approvedTarget(plan, U3)).toMatchObject({ newStart: 78, newEnd: 120 });
    expect(() => approvedTarget(plan, "unitnotinplannotinplannot1")).toThrow(/not in the reviewed/);
  });
  it("parses only an explicit unit allowlist and defaults to dry-run", () => {
    expect(parseArgs([`--plan=p.json`, `--unitIds=${U2}`])).toEqual({ plan: "p.json", unitIds: [U2], apply: false });
    for (const bad of [[`--unitIds=${U2}`], [`--plan=p.json`], [`--plan=p.json`, `--unitIds=${U2},${U2}`], [`--plan=p.json`, `--unitIds=x y`], [`--plan=p.json`, `--unitIds=${U2}`, `--all`], [`--plan=p.json`, `--unitIds=${U2}`, `--apply`, `--apply`]]) expect(() => parseArgs(bad)).toThrow();
  });
  it.each([
    ["source change", { subjectSourceFile: "other.pdf" }, /source file/],
    ["override", { sourceFileOverride: "reader.pdf" }, /source file/],
    ["range not corrected", { sourcePageStart: 59, sourcePageEnd: 68 }, /approved corrected/],
    ["already re-grounded", { groundingSourceFingerprint: t.newFingerprint }, /historical old-range/],
    ["no notes", { hasNotes: false }, /no existing grounding/],
  ])("preflight stops on %s", (_n, over, err) => expect(() => preflight(t, live(over as any))).toThrow(err));
  it("rejects empty, mis-sourced, or out-of-range replacement grounding", () => {
    expect(() => validateReplacement(t, { ...goodGen, notes: { concepts: [] } })).toThrow(/no concepts/);
    expect(() => validateReplacement(t, { ...goodGen, pageStart: 59 })).toThrow(/unexpected source identity/);
    expect(() => validateReplacement(t, { ...goodGen, notes: { concepts: [{ name: "Old", sourcePages: [62] }] } })).toThrow(/outside 68-77/);
    expect(() => validateReplacement(t, { ...goodGen, notes: { concepts: [{ name: "x", sourcePages: [] }] } })).toThrow(/cites no source pages/);
    expect(() => validateReplacement(t, goodGen)).not.toThrow();
  });
  it("dry-run preflights without generating or writing", async () => {
    const d = deps(); const r = await runReground({ plan, unitIds: [U2], apply: false }, d);
    expect(r.mode).toBe("DRY_RUN"); expect(d.generate).not.toHaveBeenCalled(); expect(d.replace).not.toHaveBeenCalled();
  });
  it("apply generates first and replaces atomically with the new canonical fingerprint", async () => {
    const d = deps(); const r = await runReground({ plan, unitIds: [U2], apply: true }, d);
    expect(d.generate.mock.invocationCallOrder[0]).toBeLessThan(d.replace.mock.invocationCallOrder[0]);
    expect(d.replace).toHaveBeenCalledWith(expect.objectContaining({ newFingerprint: groundingSourceFingerprint(KEY, 68, 77), oldFingerprint: groundingSourceFingerprint(KEY, 59, 68) }), goodGen);
    expect(r.results[0]).toMatchObject({ unitId: U2, concepts: 1 });
  });
  it("keeps the old grounding when generation fails (no write)", async () => {
    const d = deps(); d.generate.mockRejectedValue(new Error("Grounding extraction budget reservation refused (daily_limit)."));
    await expect(runReground({ plan, unitIds: [U2], apply: true }, d)).rejects.toThrow(/budget/); expect(d.replace).not.toHaveBeenCalled();
  });
  it("keeps the old grounding when the replacement fails validation (no write)", async () => {
    const d = deps(live(), { ...goodGen, notes: { concepts: [{ name: "Prev unit", sourcePages: [60] }] } });
    await expect(runReground({ plan, unitIds: [U2], apply: true }, d)).rejects.toThrow(/outside/); expect(d.replace).not.toHaveBeenCalled();
  });
  it("fails closed when live state changed during generation (compare-and-set matched 0 rows)", async () => {
    const d = deps(); d.replace.mockResolvedValue(0);
    await expect(runReground({ plan, unitIds: [U2], apply: true }, d)).rejects.toThrow(/nothing written/);
  });
  it("stops at the first failing Unit and never generates for later Units", async () => {
    const d = deps(); d.loadLive.mockImplementation(async (id: string) => (id === U2 ? live() : live({ id: U3, sourcePageStart: 69, sourcePageEnd: 80 })));
    await expect(runReground({ plan, unitIds: [U2, U3], apply: true }, d)).rejects.toThrow(/approved corrected/);
    expect(d.generate).not.toHaveBeenCalled();
  });
});

describe("reground-unit with a large (>40-page) Unit", () => {
  const LU = "unitlargelargelargelargel1";
  const largePlan: RepairPlan = { version: 1, excluded: [], books: [{ ...plan.books[0], offset: 1, finalUnitContentEnd: 55, physicalPageCount: 154, expectedUnits: [{ unitId: LU, order: 1, persistedStart: 7, persistedEnd: 54 }] }] };
  const lt = approvedTarget(largePlan, LU);
  const liveLarge = (fp: string): LiveUnitGrounding => ({ id: LU, sourceFileOverride: null, subjectSourceFile: KEY, sourcePageStart: 8, sourcePageEnd: 55, groundingSourceFingerprint: fp, hasNotes: true });
  const largeGen = { notes: { concepts: [{ name: "first", sourcePages: [8] }, { name: "boundary-a", sourcePages: [31] }, { name: "boundary-b", sourcePages: [32] }, { name: "last", sourcePages: [55] }] }, model: "gpt-4o-mini", chunkCount: 24, sourceKey: KEY, pageStart: 8, pageEnd: 55, groundingVersion: 1, groundingPromptVersion: "grounding-extraction-v2" };
  it("15: the replacement fingerprint is the FULL corrected Unit identity, not any window's", () => {
    expect(lt).toMatchObject({ newStart: 8, newEnd: 55 });
    expect(lt.newFingerprint).toBe(groundingSourceFingerprint(KEY, 8, 55));
    expect(lt.newFingerprint).not.toBe(groundingSourceFingerprint(KEY, 8, 31));
    expect(lt.newFingerprint).not.toBe(groundingSourceFingerprint(KEY, 32, 55));
  });
  it("5: all windows succeed -> exactly one guarded replacement at the end with the full-range fingerprint", async () => {
    const d = { loadLive: jest.fn().mockResolvedValue(liveLarge(lt.oldFingerprint)), generate: jest.fn().mockResolvedValue(largeGen), replace: jest.fn().mockResolvedValue(1) };
    await runReground({ plan: largePlan, unitIds: [LU], apply: true }, d);
    expect(d.replace).toHaveBeenCalledTimes(1);
    expect(d.replace.mock.calls[0][0]).toMatchObject({ newFingerprint: groundingSourceFingerprint(KEY, 8, 55), newStart: 8, newEnd: 55 });
  });
  it("6/7: a failed window (generation throws) -> zero replacement writes", async () => {
    const d = { loadLive: jest.fn().mockResolvedValue(liveLarge(lt.oldFingerprint)), generate: jest.fn().mockRejectedValue(new Error("Grounding extraction failed validation for pages 40-41 after 2 attempt(s).")), replace: jest.fn() };
    await expect(runReground({ plan: largePlan, unitIds: [LU], apply: true }, d)).rejects.toThrow(/failed validation/);
    expect(d.replace).not.toHaveBeenCalled();
  });
  it("12/13: boundary-page evidence inside the corrected range is accepted; anything outside it is rejected", () => {
    expect(() => validateReplacement(lt, largeGen)).not.toThrow();
    expect(() => validateReplacement(lt, { ...largeGen, notes: { concepts: [{ name: "x", sourcePages: [56] }] } })).toThrow(/outside 8-55/);
  });
  it("20: an idempotent re-run after a successful replacement does not regenerate", async () => {
    const d = { loadLive: jest.fn().mockResolvedValue(liveLarge(lt.newFingerprint)), generate: jest.fn(), replace: jest.fn() };
    await expect(runReground({ plan: largePlan, unitIds: [LU], apply: true }, d)).rejects.toThrow(/historical old-range fingerprint/);
    expect(d.generate).not.toHaveBeenCalled(); expect(d.replace).not.toHaveBeenCalled();
  });
});

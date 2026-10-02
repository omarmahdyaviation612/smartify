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

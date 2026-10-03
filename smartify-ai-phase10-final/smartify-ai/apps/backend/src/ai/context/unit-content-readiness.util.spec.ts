import { currentGateProvenance, gateAssignment, gateUnit, GATE_FINGERPRINT } from "./topic-content-gate.fixtures.testspec";
import { questionServabilityByTopic } from "./topic-content-provenance.util";
import { classifyUnitContentReadiness, READINESS_POOL_TARGET, type ReadinessQuestion, type ReadinessTopic } from "./unit-content-readiness.util";
import { POOL_TARGET } from "../../scripts/regenerate-topic-content";
import { buildReadinessPlan, summarize } from "../../scripts/plan-wave-content-readiness";

const STRICT = { contentProvenanceEnforcedAt: new Date("2026-10-02T00:00:00Z") };
const cur = currentGateProvenance();
const CURRENT = { groundingSourceFingerprint: cur.groundingSourceFingerprint, groundingAssignmentFingerprint: cur.groundingAssignmentFingerprint };
const MISMATCH = { groundingSourceFingerprint: cur.groundingSourceFingerprint, groundingAssignmentFingerprint: "tga1:old-narrow-assignment" };
const LEGACY = { groundingSourceFingerprint: null, groundingAssignmentFingerprint: null };
const STEPS = [{ type: "explain", textEn: "step" }];

const qs = (n: number, prov: object, topicId = "t1"): ReadinessQuestion[] => Array.from({ length: n }, () => ({ topicId, isPlaceholder: false, ...prov }));
const steps = (prov: typeof CURRENT | typeof LEGACY | typeof MISMATCH | null) =>
  prov === null ? { teachingStepsJson: null } : { teachingStepsJson: STEPS, groundingSourceFingerprintUsed: prov.groundingSourceFingerprint, groundingAssignmentFingerprintUsed: prov.groundingAssignmentFingerprint };

function topic(questions: ReadinessQuestion[], lesson: typeof CURRENT | typeof LEGACY | typeof MISMATCH | null = CURRENT, overrides: Partial<ReadinessTopic> = {}): ReadinessTopic {
  return { id: "t1", ...steps(lesson), groundingAssignment: gateAssignment() as any, topicSourceEvidence: [], questions, ...overrides } as ReadinessTopic;
}
const unit = (topics: ReadinessTopic[], overrides: Record<string, unknown> = {}) => ({ ...gateUnit(overrides), topics }) as any;
const classify = (topics: ReadinessTopic[], overrides: Record<string, unknown> = {}, opts = {}) => classifyUnitContentReadiness(unit(topics, overrides), opts);

describe("classifyUnitContentReadiness — historical non-servable content", () => {
  it("pool target agrees with the STRICT enforcement / runtime target", () => {
    expect(READINESS_POOL_TARGET).toBe(POOL_TARGET);
    expect(READINESS_POOL_TARGET).toBe(8);
  });

  it("1. STRICT + CURRENT lesson + 8 CURRENT + historical MISMATCH => ALREADY_STRICT", () => {
    const r = classify([topic([...qs(8, CURRENT), ...qs(8, MISMATCH)])], STRICT);
    expect(r.class).toBe("ALREADY_STRICT");
    expect(r.issues).toEqual([]);
    expect(r.historicalNonServable).toEqual({ legacyQuestions: 0, mismatchQuestions: 8, retiredQuestions: 0 });
    expect(r.topics[0]).toMatchObject({ servable: { CURRENT: 8 }, historicalNonServable: { MISMATCH: 8 }, lazyLessonRequired: false, topUpRequired: false });
  });

  it("2. same with historical LEGACY => ALREADY_STRICT", () => {
    const r = classify([topic([...qs(8, CURRENT), ...qs(8, LEGACY)])], STRICT);
    expect(r.class).toBe("ALREADY_STRICT");
    expect(r.historicalNonServable).toEqual({ legacyQuestions: 8, mismatchQuestions: 0, retiredQuestions: 0 });
  });

  it("3. same with both LEGACY and MISMATCH historical rows => ALREADY_STRICT (the production 29-Unit shape)", () => {
    const r = classify([topic([...qs(7, LEGACY), ...qs(8, MISMATCH), ...qs(8, CURRENT)])], STRICT);
    expect(r.class).toBe("ALREADY_STRICT");
    expect(r).toMatchObject({ qCurrent: 8, qLegacy: 7, qMismatch: 8, readyUnder8: 0, historicalNonServable: { legacyQuestions: 7, mismatchQuestions: 8 } });
  });
});

describe("classifyUnitContentReadiness — real failures stay INVALID_STATE", () => {
  it("4. STRICT with only MISMATCH Questions and no CURRENT pool", () => {
    const r = classify([topic(qs(8, MISMATCH))], STRICT);
    expect(r.class).toBe("INVALID_STATE");
    expect(r.issues).toEqual(["t1: STRICT_POOL_UNDER_TARGET 0/8"]);
    expect(r.topics[0].topUpRequired).toBe(true);
  });

  it("5. STRICT with 7 CURRENT + historical MISMATCH", () => {
    const r = classify([topic([...qs(7, CURRENT), ...qs(8, MISMATCH)])], STRICT);
    expect(r.class).toBe("INVALID_STATE");
    expect(r.issues).toEqual(["t1: STRICT_POOL_UNDER_TARGET 7/8"]);
  });

  it("6. STRICT with MISMATCH lesson provenance", () => {
    const r = classify([topic(qs(8, CURRENT), MISMATCH)], STRICT);
    expect(r.class).toBe("INVALID_STATE");
    expect(r.issues).toEqual(["t1: ACTIVE_LESSON_PROVENANCE_MISMATCH", "t1: STRICT_LESSON_NOT_SERVABLE"]);
    expect(r.topics[0].lazyLessonRequired).toBe(true);
  });

  it("STRICT with a LEGACY or missing lesson (would need lazy generation)", () => {
    expect(classify([topic(qs(8, CURRENT), LEGACY)], STRICT).issues).toEqual(["t1: STRICT_LESSON_NOT_SERVABLE"]);
    expect(classify([topic(qs(8, CURRENT), null)], STRICT).issues).toEqual(["t1: STRICT_LESSON_NOT_SERVABLE"]);
  });

  it("CURRENT-stamped lesson with no steps is not accepted as a CURRENT lesson", () => {
    const r = classify([topic(qs(8, CURRENT), CURRENT, { teachingStepsJson: [] as any })], STRICT);
    expect(r.class).toBe("INVALID_STATE");
    expect(r.issues).toContain("t1: CURRENT_LESSON_EMPTY");
  });

  it("7. stale assignment", () => {
    const r = classify([topic(qs(8, CURRENT), CURRENT, { groundingAssignment: gateAssignment({ unitSourceFingerprint: "fp-old" }) as any })], STRICT);
    expect(r.class).toBe("INVALID_STATE");
    expect(r.issues).toEqual(["t1: ASSIGNMENT_STALE"]);
  });

  it("8. READY-empty assignment", () => {
    const r = classify([topic(qs(8, CURRENT), CURRENT, { groundingAssignment: gateAssignment({ matchedConceptNames: ["Not In Notes"] }) as any })], STRICT);
    expect(r.class).toBe("INVALID_STATE");
    expect(r.issues).toEqual(["t1: ASSIGNMENT_EMPTY"]);
  });

  it("9. grounding identity not canonical for the Unit's range", () => {
    const r = classify([topic(qs(8, CURRENT))], STRICT, { expectedSourceFingerprint: "fp-canonical-for-range" });
    expect(r.class).toBe("INVALID_STATE");
    expect(r.issues).toEqual(["GROUNDING_IDENTITY_MISMATCH: grounding fingerprint not canonical for range"]);
    expect(classify([topic(qs(8, CURRENT))], STRICT, { expectedSourceFingerprint: GATE_FINGERPRINT }).class).toBe("ALREADY_STRICT");
  });

  it("student activity on READY content stays an issue", () => {
    expect(classify([topic(qs(8, CURRENT), CURRENT, { activity: 2 })], STRICT).issues).toEqual(["STUDENT_ACTIVITY_ON_READY_CONTENT: 2"]);
  });

  it("BLOCKED Topics are ignored; a BLOCKED-only Unit is not ALREADY_READY_FOR_STRICT", () => {
    const blocked = topic([], null, { id: "t2", groundingAssignment: gateAssignment({ status: "BLOCKED" }) as any });
    expect(classify([topic([...qs(8, CURRENT), ...qs(8, MISMATCH)]), blocked], STRICT)).toMatchObject({ class: "ALREADY_STRICT", ready: 1, blocked: 1, blockedTopicIds: ["t2"] });
    expect(classify([blocked]).class).toBe("NEEDS_PREPARATION");
  });
});

describe("classifyUnitContentReadiness — TRANSITION keeps the original preparation semantics", () => {
  it("10. TRANSITION: stored MISMATCH still blocks preparation; LEGACY-only needs preparation; fully CURRENT is ready for STRICT", () => {
    expect(classify([topic([...qs(8, CURRENT), ...qs(8, MISMATCH)])]).issues).toEqual(["t1: TRANSITION_QUESTION_MISMATCH"]);
    expect(classify([topic(qs(8, LEGACY), LEGACY)])).toMatchObject({ class: "NEEDS_PREPARATION", issues: [], readyUnder8: 1, stepsLegacy: 1 });
    expect(classify([topic(qs(8, LEGACY), null)])).toMatchObject({ class: "NEEDS_PREPARATION", stepsMissing: 1 });
    expect(classify([topic([...qs(8, CURRENT), ...qs(8, LEGACY)])])).toMatchObject({ class: "ALREADY_READY_FOR_STRICT", historicalNonServable: { legacyQuestions: 8, mismatchQuestions: 0 } });
    expect(classify([topic([...qs(5, CURRENT), ...qs(8, LEGACY)])]).class).toBe("NEEDS_PREPARATION");
  });

  it("TRANSITION MISMATCH lesson remains INVALID_STATE", () => {
    expect(classify([topic(qs(8, LEGACY), MISMATCH)]).issues).toEqual(["t1: ACTIVE_LESSON_PROVENANCE_MISMATCH"]);
  });
});

describe("classifyUnitContentReadiness — agrees with runtime servability", () => {
  it("11. historical excluded Questions never count toward the required 8", () => {
    const r = classify([topic([...qs(4, CURRENT), ...qs(20, MISMATCH), ...qs(20, LEGACY)])], STRICT);
    expect(r.topics[0].servable).toEqual({ CURRENT: 4 });
    expect(r.readyUnder8).toBe(1);
    expect(r.class).toBe("INVALID_STATE");
  });

  it("placeholder Questions are outside the pool, like runtime", () => {
    const r = classify([topic([...qs(7, CURRENT), { topicId: "t1", isPlaceholder: true, ...CURRENT }])], STRICT);
    expect(r.topics[0].servable).toEqual({ CURRENT: 7 });
  });

  it.each([
    ["STRICT mixed history", STRICT, [...qs(8, CURRENT), ...qs(3, LEGACY), ...qs(5, MISMATCH)]],
    ["TRANSITION LEGACY only", {}, qs(8, LEGACY)],
    ["TRANSITION CURRENT + LEGACY", {}, [...qs(2, CURRENT), ...qs(8, LEGACY)]],
    ["STRICT LEGACY only", STRICT, qs(8, LEGACY)],
  ])("12. servable counts equal questionServabilityByTopic (%s)", (_label, mode, pool) => {
    const t = topic(pool as ReadinessQuestion[]);
    const r = classify([t], mode as Record<string, unknown>);
    const runtime = (pool as ReadinessQuestion[]).filter(questionServabilityByTopic([{ ...t, unit: gateUnit(mode as Record<string, unknown>) } as any], pool as ReadinessQuestion[])).length;
    const planned = Object.values(r.topics[0].servable).reduce((a, b) => a + (b ?? 0), 0);
    expect(planned).toBe(runtime);
    expect(r.topics[0].topUpRequired).toBe(runtime < 8);
  });
});

describe("buildReadinessPlan — read-only", () => {
  // CURRENT stamps include the Unit id, so each DB Unit gets its own live provenance.
  const dbUnit = (id: string, order: number, overrides: Record<string, unknown>, pool: Array<[number, "CURRENT" | "MISMATCH" | "LEGACY"]>, lesson: "CURRENT" | "LEGACY") => {
    const p = currentGateProvenance({ id });
    const prov = { CURRENT: { groundingSourceFingerprint: p.groundingSourceFingerprint, groundingAssignmentFingerprint: p.groundingAssignmentFingerprint }, MISMATCH, LEGACY };
    const questions = pool.flatMap(([n, k]) => qs(n, prov[k]).map((q) => ({ ...q, _count: { attempts: 0 } })));
    return {
      ...gateUnit({ id, ...overrides }), nameEn: `Unit ${order}`, order, sourcePageStart: 1, sourcePageEnd: 2, sourceFileOverride: null,
      subject: { nameEn: "Science", sourceFile: "src.pdf", grade: { nameEn: "Year 1", level: 1 } },
      topics: [{ ...topic(questions as any, prov[lesson]), lessons: [], _count: { lessonSessions: 0, quizResults: 0 } }],
    };
  };

  it("13/14. makes exactly one read (unit.findMany), no writes, no provider/network calls", async () => {
    const calls: string[] = [];
    const deny = (path: string): any => new Proxy(() => undefined, {
      get: (_t, k) => { if (typeof k === "symbol" || k === "then") return undefined; return deny(`${path}.${String(k)}`); },
      apply: () => { calls.push(path); throw new Error(`unexpected prisma call ${path}`); },
    });
    const units = [dbUnit("u2", 2, {}, [[8, "LEGACY"]], "LEGACY"), dbUnit("u1", 1, STRICT, [[8, "CURRENT"], [8, "MISMATCH"]], "CURRENT")];
    const prisma = new Proxy({} as any, {
      get: (_t, k) => k === "unit" ? new Proxy({}, { get: (_u, m) => m === "findMany" ? async (args: any) => { calls.push("unit.findMany"); expect(args.where).toEqual({ id: { in: ["u1", "u2"] } }); return units; } : deny(`unit.${String(m)}`) }) : deny(String(k)),
    });
    const fetchSpy = jest.spyOn(globalThis as any, "fetch").mockImplementation(() => { throw new Error("network call"); });
    try {
      // The fixture fingerprint is not sha256("src.pdf|1-2"), so the canonical-identity check must fire — and be the ONLY issue (historical MISMATCH rows are not issues).
      const { summary, rows } = await buildReadinessPlan(prisma, ["u1", "u2"]);
      expect(calls).toEqual(["unit.findMany"]);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(rows.map((r) => r.unitId)).toEqual(["u1", "u2"]);
      expect(rows.map((r) => r.issues)).toEqual([["GROUNDING_IDENTITY_MISMATCH: grounding fingerprint not canonical for range"], ["GROUNDING_IDENTITY_MISMATCH: grounding fingerprint not canonical for range"]]);
      expect(rows[0].historicalNonServable).toEqual({ legacyQuestions: 0, mismatchQuestions: 8, retiredQuestions: 0 });
      expect(summary.units).toBe(2);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("refuses a plan whose Units are not all found", async () => {
    const prisma = { unit: { findMany: async () => [] } };
    await expect(buildReadinessPlan(prisma, ["u1"])).rejects.toThrow("plan lists 1 Units, found 0");
  });

  it("summarize counts classes and historical rows", () => {
    const a = { ...classify([topic([...qs(8, CURRENT), ...qs(8, MISMATCH)])], STRICT) };
    const b = { ...classify([topic(qs(8, LEGACY), LEGACY)]) };
    expect(summarize([a, b] as any)).toMatchObject({ units: 2, classes: { ALREADY_STRICT: 1, NEEDS_PREPARATION: 1 }, strictUnits: 1, historicalNonServable: { legacyQuestions: 0, mismatchQuestions: 8 } });
  });
});

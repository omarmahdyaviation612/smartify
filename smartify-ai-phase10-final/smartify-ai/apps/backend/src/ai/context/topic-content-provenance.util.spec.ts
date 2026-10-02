import {
  canServeTopicSteps,
  classifyContentProvenance,
  computeAssignmentFingerprint,
  enforcementForUnit,
  evaluateTopicGroundingGate,
  isProvenanceServable,
  questionServabilityByTopic,
} from "./topic-content-provenance.util";
import { resolveAssignedGroundingSlice } from "./topic-grounding-assignment.util";
import { currentGateProvenance, GATE_FINGERPRINT, GATE_NOTES, gateAssignment, gateUnit, withBlockedGate, withReadyGate } from "./topic-content-gate.fixtures.testspec";

const topic = (over: Record<string, unknown> = {}) => withReadyGate({ id: "t1", ...over });

describe("evaluateTopicGroundingGate — READY_CURRENT_NON_EMPTY", () => {
  it("E: READY current assignment + non-empty slice -> READY with provenance", () => {
    const gate = evaluateTopicGroundingGate(topic() as any);
    expect(gate.state).toBe("READY");
    if (gate.state !== "READY") return;
    expect(gate.provenance.groundingSourceFingerprint).toBe(GATE_FINGERPRINT);
    expect(gate.provenance.groundingAssignmentFingerprint).toMatch(/^tga1:[0-9a-f]{64}$/);
  });
  it("BLOCKED assignment -> UNAVAILABLE:BLOCKED", () => {
    expect(evaluateTopicGroundingGate(withBlockedGate({ id: "t1" }) as any)).toEqual({ state: "UNAVAILABLE", reason: "BLOCKED" });
  });
  it("F: READY row whose fingerprint is not the Unit's current one -> UNAVAILABLE:STALE", () => {
    expect(evaluateTopicGroundingGate({ ...topic(), groundingAssignment: gateAssignment({ unitSourceFingerprint: "fp-old" }) } as any)).toEqual({ state: "UNAVAILABLE", reason: "STALE" });
  });
  it("G: READY row resolving to an EMPTY slice -> UNAVAILABLE:EMPTY", () => {
    expect(evaluateTopicGroundingGate({ ...topic(), groundingAssignment: gateAssignment({ matchedConceptNames: ["Not In Notes"] }) } as any)).toEqual({ state: "UNAVAILABLE", reason: "EMPTY" });
  });
  it("H: no assignment / no Unit -> UNAVAILABLE:MISSING", () => {
    expect(evaluateTopicGroundingGate({ ...topic(), groundingAssignment: null } as any)).toEqual({ state: "UNAVAILABLE", reason: "MISSING" });
    expect(evaluateTopicGroundingGate({ groundingAssignment: gateAssignment() } as any)).toEqual({ state: "UNAVAILABLE", reason: "MISSING" });
  });
  it("P: the gate agrees with the unchanged runtime resolver on every state", () => {
    const cases = [
      topic(),
      withBlockedGate({ id: "t1" }),
      { ...topic(), groundingAssignment: gateAssignment({ unitSourceFingerprint: "fp-old" }) },
      { ...topic(), groundingAssignment: gateAssignment({ matchedConceptNames: ["Not In Notes"] }) },
      { ...topic(), groundingAssignment: null },
    ];
    for (const c of cases as any[]) {
      const resolved = resolveAssignedGroundingSlice(c.groundingAssignment, c.unit, c.topicSourceEvidence).state;
      const gate = evaluateTopicGroundingGate(c);
      expect(gate.state === "READY" ? "READY" : gate.reason).toBe(resolved);
    }
  });
});

describe("computeAssignmentFingerprint", () => {
  const slice = () => {
    const g = evaluateTopicGroundingGate(topic() as any);
    if (g.state !== "READY") throw new Error("fixture");
    return g.slice;
  };
  it("is deterministic and independent of matched-name order", () => {
    const a = computeAssignmentFingerprint(gateUnit() as any, gateAssignment({ matchedConceptNames: ["Addition", "Zeta"] }) as any, slice());
    const b = computeAssignmentFingerprint(gateUnit() as any, gateAssignment({ matchedConceptNames: ["Zeta", "Addition"] }) as any, slice());
    expect(a).toBe(b);
  });
  it("changes when the Unit grounding identity changes", () => {
    expect(computeAssignmentFingerprint(gateUnit() as any, gateAssignment() as any, slice())).not.toBe(computeAssignmentFingerprint(gateUnit({ groundingSourceFingerprint: "fp-new" }) as any, gateAssignment() as any, slice()));
  });
  it("changes when the resolved slice content changes (same names, re-extracted notes)", () => {
    const notes2 = { ...GATE_NOTES, concepts: [{ ...GATE_NOTES.concepts[0], description: "Re-extracted wording." }] };
    const p1 = currentGateProvenance();
    const p2 = currentGateProvenance({ groundingNotesJson: notes2 });
    expect(p1.groundingSourceFingerprint).toBe(p2.groundingSourceFingerprint);
    expect(p1.groundingAssignmentFingerprint).not.toBe(p2.groundingAssignmentFingerprint);
  });
});

describe("classifyContentProvenance / enforcement", () => {
  const cur = currentGateProvenance();
  it("CURRENT only when BOTH stored values equal the live ones", () => {
    expect(classifyContentProvenance({ ...cur }, cur)).toBe("CURRENT");
  });
  it("M: any difference — including a partial stamp — is MISMATCH, never LEGACY", () => {
    expect(classifyContentProvenance({ groundingSourceFingerprint: "fp-old", groundingAssignmentFingerprint: cur.groundingAssignmentFingerprint }, cur)).toBe("MISMATCH");
    expect(classifyContentProvenance({ groundingSourceFingerprint: cur.groundingSourceFingerprint, groundingAssignmentFingerprint: null }, cur)).toBe("MISMATCH");
  });
  it("N: missing provenance is LEGACY — never inferred current", () => {
    expect(classifyContentProvenance({}, cur)).toBe("LEGACY");
    expect(classifyContentProvenance({ groundingSourceFingerprint: null, groundingAssignmentFingerprint: null }, cur)).toBe("LEGACY");
  });
  it("N: TRANSITION serves LEGACY, STRICT does not; MISMATCH is refused in both; CURRENT served in both", () => {
    expect(enforcementForUnit({ contentProvenanceEnforcedAt: null })).toBe("TRANSITION");
    expect(enforcementForUnit({ contentProvenanceEnforcedAt: new Date() })).toBe("STRICT");
    expect(isProvenanceServable("LEGACY", "TRANSITION")).toBe(true);
    expect(isProvenanceServable("LEGACY", "STRICT")).toBe(false);
    expect(isProvenanceServable("MISMATCH", "TRANSITION")).toBe(false);
    expect(isProvenanceServable("MISMATCH", "STRICT")).toBe(false);
    expect(isProvenanceServable("CURRENT", "TRANSITION")).toBe(true);
    expect(isProvenanceServable("CURRENT", "STRICT")).toBe(true);
  });
});

describe("canServeTopicSteps / questionServabilityByTopic", () => {
  const cur = currentGateProvenance();
  const stamped = { groundingSourceFingerprintUsed: cur.groundingSourceFingerprint, groundingAssignmentFingerprintUsed: cur.groundingAssignmentFingerprint };
  const strict = { contentProvenanceEnforcedAt: new Date() };
  it("A: a BLOCKED Topic's steps are never servable, whatever their provenance", () => {
    expect(canServeTopicSteps({ ...withBlockedGate({ id: "t1" }), ...stamped } as any)).toBe(false);
    expect(canServeTopicSteps(withBlockedGate({ id: "t1" }) as any)).toBe(false);
  });
  it("L: CURRENT steps are served under STRICT", () => {
    expect(canServeTopicSteps({ ...withReadyGate({ id: "t1" }, strict), ...stamped } as any)).toBe(true);
  });
  it("M: MISMATCHED steps are refused under TRANSITION", () => {
    expect(canServeTopicSteps({ ...topic(), groundingSourceFingerprintUsed: "fp-old", groundingAssignmentFingerprintUsed: "tga1:old" } as any)).toBe(false);
  });
  it("N: LEGACY steps served under TRANSITION, refused under STRICT", () => {
    expect(canServeTopicSteps(topic() as any)).toBe(true);
    expect(canServeTopicSteps(withReadyGate({ id: "t1" }, strict) as any)).toBe(false);
  });
  it("B/L/M/N: per-Question servability", () => {
    const servable = questionServabilityByTopic([withReadyGate({ id: "ready" }) as any, withBlockedGate({ id: "blocked" }) as any, withReadyGate({ id: "strict" }, strict) as any]);
    expect(servable({ topicId: "ready" })).toBe(true); // LEGACY, TRANSITION
    expect(servable({ topicId: "ready", ...cur })).toBe(true); // CURRENT
    expect(servable({ topicId: "ready", groundingSourceFingerprint: "fp-old", groundingAssignmentFingerprint: "tga1:old" })).toBe(false); // MISMATCH
    expect(servable({ topicId: "blocked" })).toBe(false);
    expect(servable({ topicId: "blocked", ...cur })).toBe(false);
    expect(servable({ topicId: "strict" })).toBe(false); // LEGACY under STRICT
    expect(servable({ topicId: "strict", ...cur })).toBe(true);
    expect(servable({ topicId: "unknown-topic" })).toBe(false);
  });
});

/**
 * Test-only fixtures for the student-runtime grounding gate
 * (topic-content-provenance.util.ts). The `.testspec.ts` suffix keeps this
 * file out of the production build (tsconfig.build excludes `*spec.ts`)
 * without jest treating it as a suite (jest matches `.spec.ts` only).
 */
import { DETERMINISTIC_ASSIGNMENT_VERSION } from "./topic-grounding-assignment.util";
import { evaluateTopicGroundingGate, type TopicContentProvenance } from "./topic-content-provenance.util";

export const GATE_FINGERPRINT = "fp-gate-current";

export const GATE_NOTES = {
  learningObjectives: ["Understand the topic."],
  concepts: [{ name: "Addition", description: "Adding numbers together.", sourcePages: [10], importance: "core" }],
  facts: [{ fact: "A fact on the same page.", sourcePages: [10], importance: "core" }],
  vocabulary: [],
  skills: [],
  topicHints: [],
  scopeNotes: [],
};

/** Unit fields the gate reads — spread into a fixture's existing `unit` object. */
export function gateUnit(overrides: Record<string, unknown> = {}) {
  return { id: "unit-gate", groundingVersion: 1, groundingSourceFingerprint: GATE_FINGERPRINT, groundingNotesJson: GATE_NOTES, contentProvenanceEnforcedAt: null, ...overrides };
}

export function gateAssignment(overrides: Record<string, unknown> = {}) {
  return {
    unitGroundingVersion: 1,
    unitSourceFingerprint: GATE_FINGERPRINT,
    assignmentVersion: DETERMINISTIC_ASSIGNMENT_VERSION,
    method: "KEYWORD_OVERLAP",
    mapperPromptVersion: null,
    confidence: "HIGH",
    status: "READY",
    matchedConceptNames: ["Addition"],
    matchedHintTitles: null,
    ...overrides,
  };
}

/** Adds READY_CURRENT_NON_EMPTY gate state to a Topic fixture, keeping its other unit fields (subjectId, subject, ...); the gate fields always win. */
export function withReadyGate<T extends Record<string, any>>(topic: T, unitOverrides: Record<string, unknown> = {}): T & Record<string, any> {
  return { ...topic, groundingAssignment: gateAssignment(), topicSourceEvidence: [], unit: { ...(topic.unit ?? {}), ...gateUnit(unitOverrides) } };
}

/** Same Topic, but its CURRENT assignment is BLOCKED (identity-valid, status BLOCKED). */
export function withBlockedGate<T extends Record<string, any>>(topic: T): T & Record<string, any> {
  return { ...topic, groundingAssignment: gateAssignment({ status: "BLOCKED", method: "AI_MAPPER", mapperPromptVersion: 1, confidence: "LOW", matchedConceptNames: [] }), topicSourceEvidence: [], unit: { ...(topic.unit ?? {}), ...gateUnit() } };
}

/** The provenance a generator would stamp right now for a withReadyGate() Topic. */
export function currentGateProvenance(unitOverrides: Record<string, unknown> = {}): TopicContentProvenance {
  const gate = evaluateTopicGroundingGate({ groundingAssignment: gateAssignment() as any, topicSourceEvidence: [], unit: gateUnit(unitOverrides) as any });
  if (gate.state !== "READY") throw new Error("fixture gate is not READY");
  return gate.provenance;
}

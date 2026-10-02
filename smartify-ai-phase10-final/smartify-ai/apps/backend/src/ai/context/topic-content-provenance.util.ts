import { createHash } from "crypto";
import type { GroundingNotes, GroundingSlice } from "../../interactive-lesson/unit-grounding/unit-grounding.types";
import { resolveAssignedGroundingSlice, type PersistedTopicGroundingAssignment } from "./topic-grounding-assignment.util";

/**
 * Downstream content provenance + the single student-runtime grounding gate
 * (2026-10-03, Wave B runtime safety).
 *
 * WHY: the Wave B downstream audit proved that existing teachingSteps/
 * Questions/QuestionDrafts cannot be classified as current or stale from what
 * they store — `groundingVersionUsed` is 1 for BOTH the old shifted grounding
 * and the corrected one, and no downstream row stored any grounding identity.
 * New generation therefore stamps two immutable identity strings onto the
 * content it produces:
 *
 *   groundingSourceFingerprint     — the Unit's `groundingSourceFingerprint`
 *                                    at generation time (WHICH textbook pages).
 *   groundingAssignmentFingerprint — a hash of the Topic's resolved assignment
 *                                    decision AND the exact slice content it
 *                                    resolved to (WHAT the generator was given).
 *
 * Content is CURRENT only when both stored values equal the values computed
 * from the Topic's live state; any difference is MISMATCH and is never
 * served. Content with neither value is LEGACY (generated before provenance
 * existed): it is never fabricated or backfilled as current. Whether LEGACY
 * content may still be served is an explicit, per-Unit transition decision —
 * see `ProvenanceEnforcement` below.
 */

export const ASSIGNMENT_FINGERPRINT_PREFIX = "tga1:";

export interface TopicContentProvenance {
  groundingSourceFingerprint: string;
  groundingAssignmentFingerprint: string;
}

export type TopicGroundingUnavailableReason = "MISSING" | "STALE" | "BLOCKED" | "EMPTY";

export type TopicGroundingGate =
  | { state: "READY"; slice: GroundingSlice; provenance: TopicContentProvenance }
  | { state: "UNAVAILABLE"; reason: TopicGroundingUnavailableReason };

/** The Unit fields the gate needs — a structural subset of Prisma's Unit. */
export interface GateUnit {
  id: string;
  groundingVersion: number | null;
  groundingSourceFingerprint: string | null;
  groundingNotesJson: unknown;
  contentProvenanceEnforcedAt?: Date | null;
}

type EvidenceRow = { status: string; unitId: string; sourceFingerprint: string; evidenceJson: unknown };

/** The Topic fields the gate needs — every runtime consumer already loads these in its own Topic query. */
export interface GateTopic {
  groundingAssignment?: PersistedTopicGroundingAssignment | null;
  topicSourceEvidence?: EvidenceRow[];
  unit: GateUnit;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function sortedStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").sort() : [];
}

/**
 * Deterministic identity of "what this Topic's generator is given": the Unit
 * grounding identity, the persisted assignment decision, and the resolved slice
 * content itself — so a change to any of them (re-grounding, a different
 * assignment, new evidence merged into the slice) yields a different value.
 */
export function computeAssignmentFingerprint(
  unit: Pick<GateUnit, "id" | "groundingVersion" | "groundingSourceFingerprint">,
  assignment: PersistedTopicGroundingAssignment,
  slice: GroundingSlice,
): string {
  const payload = {
    unitId: unit.id,
    unitSourceFingerprint: unit.groundingSourceFingerprint,
    unitGroundingVersion: unit.groundingVersion,
    method: assignment.method,
    matchedConceptNames: sortedStrings(assignment.matchedConceptNames),
    matchedHintTitles: sortedStrings(assignment.matchedHintTitles),
    slice: {
      matchedViaHint: slice.matchedViaHint,
      learningObjectives: slice.learningObjectives,
      concepts: slice.concepts,
      facts: slice.facts,
      vocabulary: slice.vocabulary,
    },
  };
  return ASSIGNMENT_FINGERPRINT_PREFIX + createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

/**
 * The ONE grounding gate for student runtime AND generation: READY only when
 * the persisted assignment is READY, matches the Unit's current grounding
 * identity, and resolves to a NON-EMPTY slice (READY_CURRENT_NON_EMPTY).
 * Pure — never a query, never a provider call.
 */
export function evaluateTopicGroundingGate(topic: GateTopic): TopicGroundingGate {
  if (!topic?.unit) return { state: "UNAVAILABLE", reason: "MISSING" };
  const outcome = resolveAssignedGroundingSlice(
    topic.groundingAssignment,
    {
      id: topic.unit.id,
      groundingVersion: topic.unit.groundingVersion,
      groundingSourceFingerprint: topic.unit.groundingSourceFingerprint,
      groundingNotesJson: topic.unit.groundingNotesJson as GroundingNotes | null,
    },
    topic.topicSourceEvidence,
  );
  if (outcome.state !== "READY") return { state: "UNAVAILABLE", reason: outcome.state };
  return {
    state: "READY",
    slice: outcome.slice,
    provenance: {
      groundingSourceFingerprint: topic.unit.groundingSourceFingerprint!,
      groundingAssignmentFingerprint: computeAssignmentFingerprint(topic.unit, topic.groundingAssignment!, outcome.slice),
    },
  };
}

export type ContentProvenanceState = "CURRENT" | "MISMATCH" | "LEGACY";

/** Stored provenance of one piece of content (Topic steps use the `...Used` columns, mapped by the caller). */
export interface StoredProvenance {
  groundingSourceFingerprint?: string | null;
  groundingAssignmentFingerprint?: string | null;
}

/** Never infers currency: both values must be present AND equal the live ones. A partial stamp is MISMATCH, not LEGACY. */
export function classifyContentProvenance(stored: StoredProvenance, current: TopicContentProvenance): ContentProvenanceState {
  const source = stored.groundingSourceFingerprint ?? null;
  const assignment = stored.groundingAssignmentFingerprint ?? null;
  if (source === null && assignment === null) return "LEGACY";
  if (source === current.groundingSourceFingerprint && assignment === current.groundingAssignmentFingerprint) return "CURRENT";
  return "MISMATCH";
}

/**
 * TRANSITION: LEGACY (pre-provenance) content may still be served, so the
 * migration itself breaks nothing before the controlled regeneration phase.
 * STRICT: only CURRENT content is served. Enabled per Unit, explicitly, by
 * setting Unit.contentProvenanceEnforcedAt (scripts/enforce-content-provenance.ts,
 * which refuses unless every READY Topic in the Unit already has CURRENT
 * content). MISMATCH content is refused in BOTH modes.
 */
export type ProvenanceEnforcement = "TRANSITION" | "STRICT";

export function enforcementForUnit(unit: Pick<GateUnit, "contentProvenanceEnforcedAt">): ProvenanceEnforcement {
  return unit.contentProvenanceEnforcedAt ? "STRICT" : "TRANSITION";
}

export function isProvenanceServable(state: ContentProvenanceState, enforcement: ProvenanceEnforcement): boolean {
  if (state === "CURRENT") return true;
  if (state === "LEGACY") return enforcement === "TRANSITION";
  return false;
}

/** Topic teachingSteps provenance, stored on Topic as the `...Used` columns. */
export interface TopicStepsProvenanceFields {
  groundingSourceFingerprintUsed?: string | null;
  groundingAssignmentFingerprintUsed?: string | null;
}

export function topicStepsProvenance(topic: TopicStepsProvenanceFields): StoredProvenance {
  return { groundingSourceFingerprint: topic.groundingSourceFingerprintUsed ?? null, groundingAssignmentFingerprint: topic.groundingAssignmentFingerprintUsed ?? null };
}

/** May this Topic's EXISTING teachingSteps be served to a student right now? */
export function canServeTopicSteps(topic: GateTopic & TopicStepsProvenanceFields): boolean {
  const gate = evaluateTopicGroundingGate(topic);
  if (gate.state !== "READY") return false;
  return isProvenanceServable(classifyContentProvenance(topicStepsProvenance(topic), gate.provenance), enforcementForUnit(topic.unit));
}

/**
 * Builds a per-Topic predicate deciding whether one stored Question may be
 * served. Gate evaluated ONCE per Topic (not per Question). A Topic that is
 * not READY_CURRENT_NON_EMPTY serves no Questions at all.
 */
export function questionServabilityByTopic(topics: Array<GateTopic & { id: string }>): (question: { topicId: string } & StoredProvenance) => boolean {
  const byTopic = new Map<string, { gate: TopicGroundingGate; enforcement: ProvenanceEnforcement }>();
  for (const t of topics) byTopic.set(t.id, { gate: evaluateTopicGroundingGate(t), enforcement: enforcementForUnit(t.unit) });
  return (question) => {
    const entry = byTopic.get(question.topicId);
    if (!entry || entry.gate.state !== "READY") return false;
    return isProvenanceServable(classifyContentProvenance(question, entry.gate.provenance), entry.enforcement);
  };
}

/** Prisma `select`/`include` fragment every consumer adds to its Topic query to feed the gate. */
export const TOPIC_GATE_INCLUDE = {
  groundingAssignment: true,
  topicSourceEvidence: true,
} as const;

export const UNIT_GATE_SELECT = {
  id: true,
  groundingVersion: true,
  groundingSourceFingerprint: true,
  groundingNotesJson: true,
  contentProvenanceEnforcedAt: true,
} as const;

export const QUESTION_PROVENANCE_SELECT = {
  groundingSourceFingerprint: true,
  groundingAssignmentFingerprint: true,
} as const;

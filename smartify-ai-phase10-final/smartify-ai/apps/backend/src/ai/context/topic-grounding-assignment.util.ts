import type { GroundingNotes, GroundingSlice } from "../../interactive-lesson/unit-grounding/unit-grounding.types";

/**
 * The READ side of the persisted Topic->grounding assignment (2026-09-27).
 *
 * Deliberately a pure util, not a service: all four consumers (lesson
 * authoring, question authoring, runtime interactive teaching, Tutor) already
 * load the Topic and its Unit for their own reasons, so each one only needs
 * to add `groundingAssignment` to its existing `include` and call
 * `resolveAssignedGroundingSlice()` — no new query, no new injected
 * dependency, and structurally no way for a runtime request path to reach the
 * AI mapper.
 *
 * Bumped when the deterministic Steps 1-5 logic OR the AI mapper's
 * prompt/behavior changes in a way that would make previously-persisted
 * assignments stale. This is intentionally SEPARATE from
 * Unit.groundingVersion / Unit.groundingSourceFingerprint, which describe the
 * TEXTBOOK EXTRACTION — improving the assignment algorithm must never require
 * fake-bumping an extraction identity (and vice versa: a re-extracted Unit
 * invalidates its Topics' assignments without any code change here).
 *
 * 1 -> 2 (2026-09-27): Step 4 extended to also recognise assessment-shell
 * Topics ("Unit One Assessment", "Final Assessment of the First Term", ...)
 * as a REVIEW_FULL_UNIT-equivalent structural match — see
 * ASSESSMENT_SHELL_TITLE_PATTERN in topic-grounding-assignment.service.ts.
 * This changes deterministic-assignment semantics (a new class of Topic now
 * resolves where it previously did not), so every previously-persisted
 * READY/BLOCKED row is correctly invalidated and recomputed on the next run.
 */
export const TOPIC_GROUNDING_ASSIGNMENT_VERSION = 2;

/** The minimal persisted-row shape the read path needs (a structural subset of Prisma's TopicGroundingAssignment). */
export interface PersistedTopicGroundingAssignment {
  unitGroundingVersion: number;
  unitSourceFingerprint: string;
  assignmentVersion: number;
  status: "READY" | "BLOCKED";
  matchedConceptNames: unknown;
  matchedHintTitles: unknown;
}

/** The minimal Unit shape the read path needs. */
export interface AssignmentUnitIdentity {
  groundingVersion: number | null;
  groundingSourceFingerprint: string | null;
}

export type AssignmentReadOutcome =
  | { state: "READY"; slice: GroundingSlice }
  | { state: "MISSING" }
  | { state: "STALE" }
  | { state: "BLOCKED" }
  | { state: "EMPTY" };

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/**
 * Both the Unit grounding's identity AND the assignment algorithm's own
 * version must match for a persisted row to be trusted. A Unit that was never
 * successfully grounded (null version/fingerprint) can never match — there is
 * nothing to reconstruct a slice from.
 */
export function assignmentIdentityMatches(assignment: PersistedTopicGroundingAssignment, unit: AssignmentUnitIdentity): boolean {
  if (unit.groundingVersion === null || unit.groundingSourceFingerprint === null) return false;
  return (
    assignment.unitGroundingVersion === unit.groundingVersion &&
    assignment.unitSourceFingerprint === unit.groundingSourceFingerprint &&
    assignment.assignmentVersion === TOPIC_GROUNDING_ASSIGNMENT_VERSION
  );
}

/**
 * Rebuilds the Topic's GroundingSlice from the Unit's CURRENT
 * groundingNotesJson, selected by the persisted NAMES only — never from
 * cached copies of the concept/fact objects themselves. A Unit's real content
 * is therefore always live; only the decision of which names belong to this
 * Topic is cached.
 */
export function sliceFromAssignment(notes: GroundingNotes | null | undefined, assignment: PersistedTopicGroundingAssignment): GroundingSlice | null {
  if (!notes) return null;

  const conceptNames = new Set(asStringArray(assignment.matchedConceptNames).map((n) => n.toLowerCase()));
  const hintTitles = new Set(asStringArray(assignment.matchedHintTitles).map((t) => t.toLowerCase()));

  const matchedHints = (notes.topicHints ?? []).filter((h) => hintTitles.has(h.topicTitle.toLowerCase()));
  const hintPages = new Set(matchedHints.flatMap((h) => h.sourcePages ?? []));
  const hintConceptNames = new Set(matchedHints.flatMap((h) => h.relevantConcepts ?? []).map((n) => n.toLowerCase()));

  const concepts = notes.concepts.filter(
    (c) => conceptNames.has(c.name.toLowerCase()) || hintConceptNames.has(c.name.toLowerCase()) || c.sourcePages.some((p) => hintPages.has(p)),
  );

  const selectedNames = new Set(concepts.map((c) => c.name.toLowerCase()));
  const pages = new Set<number>([...hintPages, ...concepts.flatMap((c) => c.sourcePages)]);

  return {
    matchedViaHint: matchedHints.length > 0,
    learningObjectives: notes.learningObjectives,
    concepts,
    facts: notes.facts.filter((f) => f.sourcePages.some((p) => pages.has(p))),
    vocabulary: notes.vocabulary.filter((v) => v.sourcePages.some((p) => pages.has(p)) || selectedNames.has(v.term.toLowerCase())),
  };
}

/**
 * The single authoritative read every consumer uses. Returns a discriminated
 * outcome rather than `GroundingSlice | null` so a caller can distinguish
 * "never prepared" / "stale" / "explicitly blocked" / "prepared but selects
 * nothing" — all four of which must be treated as today's safe "no grounding
 * available" path (PREPARING / blocked), never as a reason to silently fall
 * back to live title-inference or to call the AI mapper.
 */
export function resolveAssignedGroundingSlice(
  assignment: PersistedTopicGroundingAssignment | null | undefined,
  unit: AssignmentUnitIdentity & { groundingNotesJson: GroundingNotes | null | undefined },
): AssignmentReadOutcome {
  if (!assignment) return { state: "MISSING" };
  if (!assignmentIdentityMatches(assignment, unit)) return { state: "STALE" };
  if (assignment.status !== "READY") return { state: "BLOCKED" };

  const slice = sliceFromAssignment(unit.groundingNotesJson, assignment);
  if (!slice) return { state: "MISSING" };
  if (slice.concepts.length === 0 && slice.facts.length === 0 && slice.vocabulary.length === 0) return { state: "EMPTY" };
  return { state: "READY", slice };
}

/**
 * Convenience wrapper for the consumers that only need "the slice, or nothing"
 * — every non-READY outcome collapses to null, which each consumer already
 * handles as its own safe "no grounding available" path. There is deliberately
 * no fallback to live title-inference and no path from here to the AI mapper.
 */
export function assignedGroundingSliceOrNull(
  assignment: PersistedTopicGroundingAssignment | null | undefined,
  unit: AssignmentUnitIdentity & { groundingNotesJson: GroundingNotes | null | undefined },
): GroundingSlice | null {
  const outcome = resolveAssignedGroundingSlice(assignment, unit);
  return outcome.state === "READY" ? outcome.slice : null;
}

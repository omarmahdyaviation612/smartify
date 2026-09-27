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
 *
 * 2 -> 3 (2026-09-27): a production forensic audit found
 * `validateMapperResponse` (topic-grounding-mapper.service.ts) only accepted
 * a returned name against `notes.concepts[].name` / `notes.topicHints[].
 * topicTitle`, wrongly rejecting genuinely-correct mapper responses that
 * named an item verbatim present in `notes.vocabulary[].term` instead (real
 * cases: Topics "Honoring the Guest", "A Collage") — a validation field-scope
 * bug, not evidence actually being absent. `validateMapperResponse` now also
 * accepts a verbatim `notes.vocabulary[].term` match (still exact,
 * character-for-character — only the POOL widened), and `sliceFromAssignment`
 * below now resolves such a persisted name back to real vocabulary content
 * (previously it would silently resolve to nothing).
 *
 * ---------------------------------------------------------------------------
 * 2026-09-27 (later same day) — SPLIT INTO TWO INDEPENDENT ALGORITHM AXES
 * ---------------------------------------------------------------------------
 * The single version above used to gate BOTH the deterministic Steps 1-5 AND
 * the AI mapper's own logic. In production this caused a real reliability
 * bug: the 1->2 bump (a purely deterministic Step 4 pattern change, see
 * ASSESSMENT_SHELL_TITLE_PATTERN in topic-grounding-assignment.service.ts)
 * never touched `validateMapperResponse` or the mapper prompt at all, yet it
 * invalidated every persisted `AI_MAPPER` row too — forcing ~48 paid,
 * stochastic LLM re-invocations that had nothing to do with the change, and
 * because the mapper is stochastic, some previously-READY Topics randomly
 * flipped to BLOCKED on re-sampling. The 2->3 bump above, by contrast,
 * genuinely DID change mapper validation and correctly needed to invalidate
 * AI_MAPPER rows — that bump was right; the mechanism was too coarse.
 *
 * `DETERMINISTIC_ASSIGNMENT_VERSION` (renamed from
 * `TOPIC_GROUNDING_ASSIGNMENT_VERSION`, old name kept as a compatibility
 * alias below) now governs ONLY deterministic-method rows (HINT_MATCH,
 * KEYWORD_OVERLAP, SINGLE_TOPIC_FALLBACK, REVIEW_FULL_UNIT, PAGE_ORDER_GAP).
 * `AI_MAPPER` rows are governed instead by the mapper's OWN, already-existing
 * per-row `mapperPromptVersion` field against `MAPPER_PROMPT_VERSION` (also
 * re-exported here so both the read util and the write service/mapper share
 * one definition without a circular import — this file has no dependency on
 * either service). A deterministic-only version bump therefore never
 * revisits an AI_MAPPER row's mapper-identity validity, and a mapper-only
 * version bump never revisits a deterministic row's validity — each row is
 * checked only against the axis that actually produced it, on top of the
 * Unit factual-identity check (`unitGroundingVersion`/
 * `unitSourceFingerprint`), which unconditionally invalidates BOTH kinds of
 * row exactly as before: re-grounding a Unit always invalidates everything
 * under it, regardless of algorithm version.
 *
 * No data migration was required: `assignmentVersion` keeps its existing
 * column and existing persisted values (1, 2 or 3) are untouched — the
 * change is purely in what is CHECKED, not what is stored. See
 * `assignGroundingForTopic` (topic-grounding-assignment.service.ts) for the
 * companion write-side decision: whether a stale-for-mapper-purposes
 * AI_MAPPER row should ever be opportunistically re-derived by an IMPROVED
 * deterministic pass without re-invoking the paid mapper.
 */
export const DETERMINISTIC_ASSIGNMENT_VERSION = 3;
/** @deprecated Use `DETERMINISTIC_ASSIGNMENT_VERSION`. Kept so any external/tooling import of the old name keeps compiling. */
export const TOPIC_GROUNDING_ASSIGNMENT_VERSION = DETERMINISTIC_ASSIGNMENT_VERSION;

/**
 * Bumped whenever the AI mapper's prompt or response-validation behavior
 * changes (mirrors `MAPPER_PROMPT_VERSION` in topic-grounding-mapper.service.ts
 * — defined here, the shared dependency-free layer, and re-exported from
 * there, to avoid a circular import between the read util and the mapper
 * service). Governs ONLY `AI_MAPPER`-method rows; deterministic rows never
 * check this value.
 */
export const MAPPER_PROMPT_VERSION = 1;

/** The minimal persisted-row shape the read path needs (a structural subset of Prisma's TopicGroundingAssignment). */
export interface PersistedTopicGroundingAssignment {
  unitGroundingVersion: number;
  unitSourceFingerprint: string;
  assignmentVersion: number;
  method: string;
  mapperPromptVersion: number | null;
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
 * The Unit grounding's factual identity ALWAYS gates trust (a re-grounded
 * Unit invalidates everything under it, unconditionally). Which ALGORITHM
 * axis additionally gates trust depends on which method produced the row:
 * an `AI_MAPPER` row is checked against `mapperPromptVersion` only (the
 * mapper's own, independently-versioned axis); every deterministic-method
 * row is checked against `DETERMINISTIC_ASSIGNMENT_VERSION` only. Neither
 * axis is cross-checked against the other's rows — see the version-history
 * comment above `DETERMINISTIC_ASSIGNMENT_VERSION` for why that used to be a
 * production reliability bug. A Unit that was never successfully grounded
 * (null version/fingerprint) can never match — there is nothing to
 * reconstruct a slice from.
 */
export function assignmentIdentityMatches(assignment: PersistedTopicGroundingAssignment, unit: AssignmentUnitIdentity): boolean {
  if (unit.groundingVersion === null || unit.groundingSourceFingerprint === null) return false;
  if (assignment.unitGroundingVersion !== unit.groundingVersion || assignment.unitSourceFingerprint !== unit.groundingSourceFingerprint) {
    return false;
  }
  if (assignment.method === "AI_MAPPER") {
    return assignment.mapperPromptVersion === MAPPER_PROMPT_VERSION;
  }
  return assignment.assignmentVersion === DETERMINISTIC_ASSIGNMENT_VERSION;
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

  // 2026-09-27 field-scope fix: a persisted name (from either the AI mapper —
  // see validateMapperResponse's `allowedVocabulary` — or, in principle, any
  // future deterministic step) may be a verbatim `notes.vocabulary[].term`
  // rather than a `notes.concepts[].name`. Resolving names ONLY against
  // `notes.concepts` (as before) silently dropped such a name entirely —
  // producing a persisted READY row whose rebuilt slice had none of the
  // evidence the assignment actually recorded (an empty/broken slice,
  // sometimes tripping the "EMPTY" outcome below). Directly matching
  // `conceptNames` against vocabulary terms too (same lowercase-verbatim rule
  // already used for concepts/hints here) fixes that without loosening the
  // match itself — still exact string comparison, only the pool widened.
  const directVocabMatches = notes.vocabulary.filter((v) => conceptNames.has(v.term.toLowerCase()));
  const vocabPages = new Set(directVocabMatches.flatMap((v) => v.sourcePages));

  const selectedNames = new Set(concepts.map((c) => c.name.toLowerCase()));
  const pages = new Set<number>([...hintPages, ...vocabPages, ...concepts.flatMap((c) => c.sourcePages)]);

  return {
    matchedViaHint: matchedHints.length > 0,
    learningObjectives: notes.learningObjectives,
    concepts,
    facts: notes.facts.filter((f) => f.sourcePages.some((p) => pages.has(p))),
    vocabulary: notes.vocabulary.filter(
      (v) => v.sourcePages.some((p) => pages.has(p)) || selectedNames.has(v.term.toLowerCase()) || conceptNames.has(v.term.toLowerCase()),
    ),
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

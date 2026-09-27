import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { GroundingNotes } from "../../interactive-lesson/unit-grounding/unit-grounding.types";
import { selectRelevantGrounding } from "./grounding-selector.util";
import { TOPIC_GROUNDING_ASSIGNMENT_VERSION } from "./topic-grounding-assignment.util";

/**
 * The WRITE side of the persisted Topic->grounding assignment (2026-09-27) —
 * the one-time PREPARATION step that decides, once, which items from a Unit's
 * groundingNotesJson belong to one Topic under it, so that lesson authoring,
 * question authoring, runtime teaching and Tutor all read the SAME persisted
 * decision instead of each re-inferring relevance from the Topic's title on
 * every call.
 *
 * Steps 1-3 are not reimplemented here: they delegate straight to the existing,
 * proven `selectRelevantGrounding()` and merely RECORD which of its internal
 * branches fired (via the optional, additive `matchedVia` discriminant added to
 * GroundingSlice — see unit-grounding.types.ts). Steps 4-5 are the two new
 * deterministic steps. Everything in this file is pure/DB-free except
 * `assignGroundingForTopic()`, and nothing here ever calls an AI provider —
 * the bounded AI mapper is a separate service, invoked only from the
 * preparation/backfill script, never from a request path.
 *
 * ---------------------------------------------------------------------------
 * DESIGN DECISION — "no row" vs a BLOCKED placeholder for an unresolved Topic
 * ---------------------------------------------------------------------------
 * `method` is non-nullable in the Prisma schema, and there is no honest method
 * value for "the deterministic steps found nothing". So a Topic that Steps 1-5
 * all decline simply has NO `TopicGroundingAssignment` row: the deterministic
 * pass reports `{ outcome: "UNRESOLVED" }` and writes nothing. The read path
 * treats a missing row exactly like a BLOCKED one (safe "not ready"), so this
 * costs nothing in safety, and it keeps a real, honest distinction in the data:
 *   - NO ROW      = never resolved deterministically; eligible for Phase 2's mapper.
 *   - BLOCKED row = the mapper RAN and either failed validation, returned an
 *                   empty selection, or reported LOW confidence. Re-running the
 *                   mapper on it is pointless until the mapper itself changes
 *                   (which bumps TOPIC_GROUNDING_ASSIGNMENT_VERSION and thereby
 *                   invalidates the row anyway).
 * A BLOCKED placeholder written by Steps 1-5 would erase that distinction and
 * make "which Topics still need the mapper?" unanswerable from the table.
 */

export type DeterministicMethod = "HINT_MATCH" | "KEYWORD_OVERLAP" | "SINGLE_TOPIC_FALLBACK" | "REVIEW_FULL_UNIT" | "PAGE_ORDER_GAP";

export interface AssignmentTopic {
  id: string;
  nameEn: string;
  order: number;
}

export interface DeterministicAssignment {
  method: DeterministicMethod;
  confidence: "HIGH";
  matchedConceptNames: string[];
  matchedHintTitles: string[] | null;
  reason: string;
}

/**
 * Step 4's structural pattern. This is NOT a textbook-content synonym table:
 * it is tested ONLY against `Topic.nameEn` — curriculum METADATA, which is
 * always authored in English in this database regardless of the source
 * curriculum's language (an Arabic Grade 3 Topic still carries an English
 * `nameEn` alongside its `nameAr`). A revision/recap Topic by definition
 * covers its whole Unit, so the full Unit grounding is its correct, unambiguous
 * scope — not a guess.
 */
const REVIEW_TITLE_PATTERN = /\b(review|revision|recap|summary)\b/i;

function conceptNamesOf(names: Iterable<string>): string[] {
  return Array.from(new Set(names));
}

/** Steps 1-3 only — delegates entirely to the existing selector. */
function stepsOneToThree(notes: GroundingNotes, topic: AssignmentTopic, unitTopicCount: number): DeterministicAssignment | null {
  const slice = selectRelevantGrounding(notes, topic.nameEn, unitTopicCount);
  if (!slice) return null;

  // `matchedViaHint` alone cannot separate the keyword-overlap branch from the
  // single-Topic-Unit fallback (both report false), hence the additive
  // `matchedVia` discriminant. The `matchedViaHint`-based fallbacks below keep
  // this correct even if an older/hand-built slice lacks the new field.
  const method: DeterministicMethod =
    slice.matchedVia === "HINT" || slice.matchedViaHint
      ? "HINT_MATCH"
      : slice.matchedVia === "SINGLE_TOPIC_UNIT" || (slice.matchedVia === undefined && unitTopicCount === 1)
        ? "SINGLE_TOPIC_FALLBACK"
        : "KEYWORD_OVERLAP";

  return {
    method,
    confidence: "HIGH",
    matchedConceptNames: conceptNamesOf(slice.concepts.map((c) => c.name)),
    matchedHintTitles: slice.matchedHintTitle ? [slice.matchedHintTitle] : null,
    reason: `selectRelevantGrounding matched via ${method}.`,
  };
}

/** Step 4 — a Review/Revision/Recap/Summary Topic legitimately spans its whole Unit. */
function stepFour(notes: GroundingNotes, topic: AssignmentTopic): DeterministicAssignment | null {
  if (!REVIEW_TITLE_PATTERN.test(topic.nameEn)) return null;
  return {
    method: "REVIEW_FULL_UNIT",
    confidence: "HIGH",
    matchedConceptNames: conceptNamesOf(notes.concepts.map((c) => c.name)),
    matchedHintTitles: null,
    reason: `Topic title "${topic.nameEn}" is a structural review/revision/recap/summary Topic — its scope is the whole Unit.`,
  };
}

interface PageWindow {
  min: number;
  max: number;
}

function pageWindowOf(notes: GroundingNotes, conceptNames: string[]): PageWindow | null {
  const wanted = new Set(conceptNames.map((n) => n.toLowerCase()));
  const concepts = notes.concepts.filter((c) => wanted.has(c.name.toLowerCase()));
  const pages = concepts.flatMap((c) => c.sourcePages);
  // Facts are included so a sibling's claimed window reflects everything it
  // actually pulls in at read time, not just its concepts' own pages.
  const conceptPages = new Set(pages);
  const factPages = notes.facts.filter((f) => f.sourcePages.some((p) => conceptPages.has(p))).flatMap((f) => f.sourcePages);
  const all = [...pages, ...factPages];
  if (all.length === 0) return null;
  return { min: Math.min(...all), max: Math.max(...all) };
}

/**
 * Step 5 — PAGE_ORDER_GAP. ONLY the proven-safe isolated case.
 *
 * Deliberately NOT a cross-Topic proportional split (explicitly out of scope):
 * this resolves exactly one shape of situation — a Topic sitting in a page
 * range that is bounded on BOTH sides by already-assigned sibling Topics, where
 * no OTHER still-unassigned sibling computes to the identical gap boundaries,
 * and where at least one concept lies wholly inside that gap and is not already
 * claimed by a sibling. Anything ambiguous, unbounded or empty returns null and
 * proceeds to the AI mapper — it must never receive a guessed or shared
 * assignment.
 */
function stepFive(
  notes: GroundingNotes,
  topic: AssignmentTopic,
  siblings: AssignmentTopic[],
  assignedByTopicId: Map<string, string[]>,
): DeterministicAssignment | null {
  const ordered = [...siblings].sort((a, b) => a.order - b.order);

  const gapFor = (t: AssignmentTopic): { start: number; end: number } | null => {
    const idx = ordered.findIndex((s) => s.id === t.id);
    if (idx < 0) return null;
    let prev: PageWindow | null = null;
    for (let i = idx - 1; i >= 0; i--) {
      const names = assignedByTopicId.get(ordered[i].id);
      if (!names) continue;
      const w = pageWindowOf(notes, names);
      if (w) { prev = w; break; }
    }
    let next: PageWindow | null = null;
    for (let i = idx + 1; i < ordered.length; i++) {
      const names = assignedByTopicId.get(ordered[i].id);
      if (!names) continue;
      const w = pageWindowOf(notes, names);
      if (w) { next = w; break; }
    }
    // Both bounds are required. An unbounded "gap" (this Topic is first or last
    // with no assigned neighbour on one side) could swallow front/back matter or
    // a whole neighbouring Topic's content — not a proven-safe isolated case.
    if (!prev || !next) return null;
    if (next.min - prev.max < 2) return null; // no room between the neighbours at all
    return { start: prev.max, end: next.min };
  };

  const myGap = gapFor(topic);
  if (!myGap) return null;

  // Isolation: no OTHER still-unassigned sibling may compute to the identical
  // gap boundaries. If one does, the gap is shared and therefore ambiguous.
  for (const sib of ordered) {
    if (sib.id === topic.id) continue;
    if (assignedByTopicId.has(sib.id)) continue;
    const g = gapFor(sib);
    if (g && g.start === myGap.start && g.end === myGap.end) return null;
  }

  const claimed = new Set(
    Array.from(assignedByTopicId.values())
      .flat()
      .map((n) => n.toLowerCase()),
  );
  const inGap = notes.concepts.filter(
    (c) =>
      !claimed.has(c.name.toLowerCase()) &&
      c.sourcePages.length > 0 &&
      c.sourcePages.every((p) => p > myGap.start && p < myGap.end),
  );
  if (inGap.length === 0) return null;

  return {
    method: "PAGE_ORDER_GAP",
    confidence: "HIGH",
    matchedConceptNames: conceptNamesOf(inGap.map((c) => c.name)),
    matchedHintTitles: null,
    reason: `Isolated, unshared page gap (${myGap.start + 1}-${myGap.end - 1}) between assigned sibling Topics; ${inGap.length} unclaimed concept(s) fall wholly inside it.`,
  };
}

/**
 * The full deterministic pass (Steps 1-5) for ONE Topic.
 *
 * `siblings` must be every Topic under the same Unit INCLUDING `topic` itself
 * (that is also how `unitTopicCount` is derived, so the existing
 * single-Topic-Unit fallback keeps behaving exactly as it does today).
 * `priorAssignments` optionally supplies concept names already persisted for
 * sibling Topics, so Step 5 can build on a previous preparation run's results
 * as well as on the Steps 1-4 results it computes here.
 *
 * Returns null when every step declines — the Topic is UNRESOLVED and eligible
 * for the AI mapper (see the "no row vs BLOCKED" note at the top of this file).
 */
export function computeDeterministicAssignment(
  notes: GroundingNotes | null | undefined,
  topic: AssignmentTopic,
  siblings: AssignmentTopic[],
  priorAssignments?: Map<string, string[]>,
): DeterministicAssignment | null {
  if (!notes) return null;
  const all = siblings.some((s) => s.id === topic.id) ? siblings : [...siblings, topic];

  const mine = stepsOneToThree(notes, topic, all.length) ?? stepFour(notes, topic);
  if (mine) return mine;

  // Step 5 needs every OTHER sibling's already-decided page window. A sibling
  // is "assigned" if a prior persisted assignment supplies its names, or if
  // Steps 1-4 resolve it here. Step 5 itself is never recursed into.
  const assignedByTopicId = new Map<string, string[]>();
  for (const sib of all) {
    if (sib.id === topic.id) continue;
    const prior = priorAssignments?.get(sib.id);
    if (prior && prior.length > 0) {
      assignedByTopicId.set(sib.id, prior);
      continue;
    }
    const sibAssignment = stepsOneToThree(notes, sib, all.length) ?? stepFour(notes, sib);
    if (sibAssignment && sibAssignment.matchedConceptNames.length > 0) {
      assignedByTopicId.set(sib.id, sibAssignment.matchedConceptNames);
    }
  }

  return stepFive(notes, topic, all, assignedByTopicId);
}

export type PrepareOutcome =
  | { outcome: "UNCHANGED"; method: DeterministicMethod | "AI_MAPPER"; status: "READY" | "BLOCKED" }
  | { outcome: "ASSIGNED"; method: DeterministicMethod; status: "READY" }
  | { outcome: "UNRESOLVED"; reason: string }
  | { outcome: "NOT_GROUNDED"; reason: string };

/** Persisted-row payload shared by this service and the AI mapper. */
export interface AssignmentUpsertInput {
  topicId: string;
  unitGroundingVersion: number;
  unitSourceFingerprint: string;
  method: DeterministicMethod | "AI_MAPPER";
  confidence: "HIGH" | "LOW";
  status: "READY" | "BLOCKED";
  matchedConceptNames: string[];
  matchedHintTitles: string[] | null;
  mapperModel?: string | null;
  mapperPromptVersion?: number | null;
  reason?: string | null;
}

@Injectable()
export class TopicGroundingAssignmentService {
  private readonly logger = new Logger(TopicGroundingAssignmentService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The preparation entrypoint for ONE Topic. Deterministic only — it never
   * calls an AI provider. When it returns `UNRESOLVED`, the caller (the
   * preparation/backfill script) may hand the Topic to
   * TopicGroundingMapperService; nothing on a student-facing request path ever
   * does.
   */
  async assignGroundingForTopic(topicId: string): Promise<PrepareOutcome> {
    const topic = await this.prisma.client.topic.findUnique({
      where: { id: topicId },
      include: {
        groundingAssignment: true,
        unit: {
          select: {
            id: true,
            groundingNotesJson: true,
            groundingVersion: true,
            groundingSourceFingerprint: true,
            topics: { select: { id: true, nameEn: true, order: true }, orderBy: { order: "asc" } },
          },
        },
      },
    });
    if (!topic) return { outcome: "NOT_GROUNDED", reason: `Topic ${topicId} not found.` };

    const unit = topic.unit;
    if (unit.groundingVersion === null || unit.groundingSourceFingerprint === null || !unit.groundingNotesJson) {
      return { outcome: "NOT_GROUNDED", reason: `Unit ${unit.id} has no completed grounding — nothing to assign from.` };
    }

    const existing = topic.groundingAssignment;
    if (
      existing &&
      existing.unitGroundingVersion === unit.groundingVersion &&
      existing.unitSourceFingerprint === unit.groundingSourceFingerprint &&
      existing.assignmentVersion === TOPIC_GROUNDING_ASSIGNMENT_VERSION
    ) {
      // Idempotent no-op: identity matches on all three axes, so the persisted
      // decision is still valid. Nothing is recomputed and nothing is written.
      return { outcome: "UNCHANGED", method: existing.method as DeterministicMethod | "AI_MAPPER", status: existing.status as "READY" | "BLOCKED" };
    }

    const notes = unit.groundingNotesJson as unknown as GroundingNotes;
    const siblings = unit.topics.map((t) => ({ id: t.id, nameEn: t.nameEn, order: t.order }));
    const prior = await this.loadPriorAssignments(unit.id, unit.groundingVersion, unit.groundingSourceFingerprint, topicId);

    const assignment = computeDeterministicAssignment(notes, { id: topic.id, nameEn: topic.nameEn, order: topic.order }, siblings, prior);
    if (!assignment) {
      this.logger.log(
        JSON.stringify({ event: "TOPIC_GROUNDING_ASSIGNMENT_UNRESOLVED", topicId, unitId: unit.id, topicTitle: topic.nameEn, assignmentVersion: TOPIC_GROUNDING_ASSIGNMENT_VERSION }),
      );
      return { outcome: "UNRESOLVED", reason: "Deterministic Steps 1-5 found no assignment — eligible for the bounded AI mapper." };
    }

    await this.upsert({
      topicId,
      unitGroundingVersion: unit.groundingVersion,
      unitSourceFingerprint: unit.groundingSourceFingerprint,
      method: assignment.method,
      confidence: assignment.confidence,
      status: "READY",
      matchedConceptNames: assignment.matchedConceptNames,
      matchedHintTitles: assignment.matchedHintTitles,
      reason: assignment.reason,
    });

    this.logger.log(
      JSON.stringify({
        event: "TOPIC_GROUNDING_ASSIGNMENT_PERSISTED",
        topicId,
        unitId: unit.id,
        method: assignment.method,
        conceptCount: assignment.matchedConceptNames.length,
        assignmentVersion: TOPIC_GROUNDING_ASSIGNMENT_VERSION,
      }),
    );
    return { outcome: "ASSIGNED", method: assignment.method, status: "READY" };
  }

  /** Sibling Topics' still-valid persisted concept names, for Step 5's page windows. */
  private async loadPriorAssignments(unitId: string, groundingVersion: number, fingerprint: string, excludeTopicId: string): Promise<Map<string, string[]>> {
    const rows = await this.prisma.client.topicGroundingAssignment.findMany({
      where: {
        topic: { unitId },
        topicId: { not: excludeTopicId },
        status: "READY",
        unitGroundingVersion: groundingVersion,
        unitSourceFingerprint: fingerprint,
        assignmentVersion: TOPIC_GROUNDING_ASSIGNMENT_VERSION,
      },
      select: { topicId: true, matchedConceptNames: true },
    });
    const map = new Map<string, string[]>();
    for (const row of rows) {
      const names = Array.isArray(row.matchedConceptNames) ? (row.matchedConceptNames as unknown[]).filter((n): n is string => typeof n === "string") : [];
      if (names.length > 0) map.set(row.topicId, names);
    }
    return map;
  }

  /** The single write path for every method, including the AI mapper's result. */
  async upsert(input: AssignmentUpsertInput): Promise<void> {
    const data = {
      unitGroundingVersion: input.unitGroundingVersion,
      unitSourceFingerprint: input.unitSourceFingerprint,
      assignmentVersion: TOPIC_GROUNDING_ASSIGNMENT_VERSION,
      method: input.method as any,
      confidence: input.confidence as any,
      status: input.status as any,
      matchedConceptNames: input.matchedConceptNames as any,
      matchedHintTitles: (input.matchedHintTitles ?? null) as any,
      mapperModel: input.mapperModel ?? null,
      mapperPromptVersion: input.mapperPromptVersion ?? null,
      reason: input.reason ?? null,
    };
    await this.prisma.client.topicGroundingAssignment.upsert({
      where: { topicId: input.topicId },
      create: { topicId: input.topicId, ...data },
      update: data,
    });
  }
}

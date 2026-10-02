import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { GroundingNotes } from "../../interactive-lesson/unit-grounding/unit-grounding.types";
import { selectRelevantGrounding } from "./grounding-selector.util";
import { DETERMINISTIC_ASSIGNMENT_VERSION, MAPPER_PROMPT_VERSION, resolveAssignedGroundingSlice } from "./topic-grounding-assignment.util";

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

/** Adds only current, topic/unit-scoped READY evidence to the in-memory
 * candidate pool. The persisted Unit grounding object is never changed. */
export function mergeReadyTopicEvidence(notes: GroundingNotes, rows: any[] | undefined, topicId: string, unitId: string, fingerprint: string, unitStart?: number | null, unitEnd?: number | null): GroundingNotes {
  const hasWindow = Number.isInteger(unitStart) && Number.isInteger(unitEnd);
  const extra = (rows ?? []).filter((row) => row.topicId === topicId && row.unitId === unitId && row.sourceFingerprint === fingerprint && row.status === "READY" && (!hasWindow || (row.sourcePageStart >= (unitStart as number) && row.sourcePageEnd <= (unitEnd as number))));
  if (extra.length === 0) return notes;
  const merged: GroundingNotes = {
    ...notes,
    concepts: [...notes.concepts], facts: [...notes.facts], vocabulary: [...notes.vocabulary], topicHints: [...notes.topicHints],
  };
  for (const row of extra) {
    const payload = row.evidenceJson;
    if (!Array.isArray(payload)) continue;
    for (const item of payload) {
      if (!item || typeof item.label !== "string" || !Array.isArray(item.sourcePages) || item.sourcePages.some((p: unknown) => !Number.isInteger(p))) continue;
      const pages = item.sourcePages as number[];
      if (item.type === "concept") merged.concepts.push({ name: item.label, description: item.label, sourcePages: pages, importance: "core" });
      else if (item.type === "fact") merged.facts.push({ fact: item.label, sourcePages: pages, importance: "core" });
      else if (item.type === "vocabulary") merged.vocabulary.push({ term: item.label, meaning: item.label, sourcePages: pages });
      else if (item.type === "hint") merged.topicHints.push({ topicTitle: item.label, relevantConcepts: [item.label], sourcePages: pages });
      else if (item.type === "objective") merged.learningObjectives.push(item.label);
    }
  }
  return merged;
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

/**
 * Step 4's sibling structural pattern (2026-09-27, assignmentVersion bump
 * 1->2): an "assessment shell" Topic — e.g. "Unit One Assessment", "Final
 * Assessment of the First Term", "First Term Assessments" — is structurally
 * identical to a Review/Revision Topic: it has no content of its own and its
 * correct, unambiguous scope is the whole Unit, exactly like
 * REVIEW_TITLE_PATTERN above. Tested ONLY against `Topic.nameEn`, same as
 * REVIEW_TITLE_PATTERN, never Arabic title or textbook content.
 *
 * Deliberately NOT a bare `/assessment/i`: a bare match on the word
 * "Assessment" alone risks a false positive on a real content Topic whose
 * title genuinely mentions assessment as its subject matter (e.g. a Topic
 * titled "Assessment Types in Science" that actually teaches assessment
 * concepts, or "Self-Assessment Journal" as a genuine writing-skill Topic).
 * The whole-word "assessment(s)" must therefore co-occur with a structural
 * marker — "Unit"/"Term" (the shell's scope noun) or "Final" (as in "Final
 * Assessment of the ... Term") — which is exactly the shape every real
 * assessment-shell title in production takes and is not the shape an
 * ordinary content Topic's title takes. "Assess" alone (e.g. "How Teachers
 * Assess Progress") never matches — \b word boundaries require the whole
 * word "assessment"/"assessments".
 */
const ASSESSMENT_SHELL_TITLE_PATTERN =
  /\b(unit|term)\b[^]*\bassessments?\b|\bassessments?\b[^]*\b(unit|term)\b|\bfinal\b[^]*\bassessments?\b/i;

function conceptNamesOf(names: Iterable<string>): string[] {
  return Array.from(new Set(names));
}

/** Steps 1-3 only — delegates entirely to the existing selector. */
export function stepsOneToThree(notes: GroundingNotes, topic: AssignmentTopic, unitTopicCount: number): DeterministicAssignment | null {
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

  // A sole-Topic (whole-Unit) row must resolve the WHOLE Unit at read time.
  // The read path re-filters the Unit's notes by persisted NAMES and pulls in
  // facts/vocabulary only by shared pages, so items on pages without any
  // concept would silently drop out. Their verbatim term/fact text is
  // persisted too — the opaque-identifier convention sliceFromAssignment
  // already resolves (topic-grounding-assignment.util.ts). Other methods are
  // unchanged.
  const names =
    method === "SINGLE_TOPIC_FALLBACK"
      ? [...slice.concepts.map((c) => c.name), ...slice.vocabulary.map((v) => v.term), ...slice.facts.map((f) => f.fact)]
      : slice.concepts.map((c) => c.name);

  return {
    method,
    confidence: "HIGH",
    matchedConceptNames: conceptNamesOf(names),
    matchedHintTitles: slice.matchedHintTitle ? [slice.matchedHintTitle] : null,
    reason: `selectRelevantGrounding matched via ${method}.`,
  };
}

/**
 * Step 4 — a Review/Revision/Recap/Summary Topic, OR an assessment-shell
 * Topic (see ASSESSMENT_SHELL_TITLE_PATTERN above), legitimately spans its
 * whole Unit. Same priority tier for both: only reached when Steps 1-3 found
 * nothing, and takes effect before Step 5.
 */
export function stepFour(notes: GroundingNotes, topic: AssignmentTopic): DeterministicAssignment | null {
  const isReview = REVIEW_TITLE_PATTERN.test(topic.nameEn);
  const isAssessmentShell = !isReview && ASSESSMENT_SHELL_TITLE_PATTERN.test(topic.nameEn);
  if (!isReview && !isAssessmentShell) return null;
  return {
    method: "REVIEW_FULL_UNIT",
    confidence: "HIGH",
    matchedConceptNames: conceptNamesOf(notes.concepts.map((c) => c.name)),
    matchedHintTitles: null,
    reason: isReview
      ? `Topic title "${topic.nameEn}" is a structural review/revision/recap/summary Topic — its scope is the whole Unit.`
      : `Topic title "${topic.nameEn}" is a structural assessment-shell Topic — its scope is the whole Unit.`,
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
        topicSourceEvidence: {
          where: { status: "READY" },
          select: { id: true, topicId: true, unitId: true, sourceFingerprint: true, evidenceJson: true, status: true, sourcePageStart: true, sourcePageEnd: true, promptVersion: true, extractorModel: true },
        },
        unit: {
          select: {
            id: true,
            sourcePageStart: true,
            sourcePageEnd: true,
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
    const notes = mergeReadyTopicEvidence(unit.groundingNotesJson as unknown as GroundingNotes, (topic as any).topicSourceEvidence, topic.id, unit.id, unit.groundingSourceFingerprint, (unit as any).sourcePageStart, (unit as any).sourcePageEnd);
    const siblings = unit.topics.map((t) => ({ id: t.id, nameEn: t.nameEn, order: t.order }));

    const factualIdentityMatches =
      !!existing && existing.unitGroundingVersion === unit.groundingVersion && existing.unitSourceFingerprint === unit.groundingSourceFingerprint;

    // Read-side READY invariant (2026-10-02): an identity-valid READY row is authoritative only if
    // the SAME runtime slice resolver yields a non-empty slice. A READY row resolving EMPTY is not a
    // valid cached decision, so it skips both authoritative branches below and is recomputed through
    // the existing path (deterministic first; UNRESOLVED -> bounded mapper). Nothing else changes.
    const readyResolvesEmpty =
      !!existing && factualIdentityMatches && existing.status === "READY" &&
      resolveAssignedGroundingSlice(existing as any, { id: unit.id, groundingVersion: unit.groundingVersion, groundingSourceFingerprint: unit.groundingSourceFingerprint, groundingNotesJson: unit.groundingNotesJson as unknown as GroundingNotes }, (topic as any).topicSourceEvidence).state === "EMPTY";

    if (existing && factualIdentityMatches && existing.method === "AI_MAPPER" && !readyResolvesEmpty) {
      // AI_MAPPER rows are governed by their OWN mapperPromptVersion axis, not
      // by DETERMINISTIC_ASSIGNMENT_VERSION — see assignmentIdentityMatches in
      // topic-grounding-assignment.util.ts for why conflating the two axes
      // was the production reliability bug this split fixes (a purely
      // deterministic version bump must never force-recompute — and
      // re-sample, since the mapper is stochastic — an unrelated, already
      // validated AI_MAPPER row).
      if (existing.mapperPromptVersion === MAPPER_PROMPT_VERSION) {
        // Opportunistic, FREE upgrade check: deterministic Steps 1-5 are
        // pure/DB-free, so re-running them here costs nothing (no LLM call,
        // no budget spend). If an IMPROVED deterministic pass can now resolve
        // this Topic on its own, that is strictly better than a stochastic
        // mapper result and replaces it. If deterministic still declines
        // (the common case), the existing validated AI_MAPPER row is left
        // completely untouched — no recompute, no re-invocation, no
        // re-sampling risk.
        const prior = await this.loadPriorAssignments(unit.id, unit.groundingVersion, unit.groundingSourceFingerprint, topicId);
        const upgraded = computeDeterministicAssignment(notes, { id: topic.id, nameEn: topic.nameEn, order: topic.order }, siblings, prior);
        if (upgraded) {
          await this.upsert({
            topicId,
            unitGroundingVersion: unit.groundingVersion,
            unitSourceFingerprint: unit.groundingSourceFingerprint,
            method: upgraded.method,
            confidence: upgraded.confidence,
            status: "READY",
            matchedConceptNames: upgraded.matchedConceptNames,
            matchedHintTitles: upgraded.matchedHintTitles,
            reason: upgraded.reason,
          });
          this.logger.log(
            JSON.stringify({ event: "TOPIC_GROUNDING_ASSIGNMENT_UPGRADED_FROM_MAPPER", topicId, unitId: unit.id, method: upgraded.method }),
          );
          return { outcome: "ASSIGNED", method: upgraded.method, status: "READY" };
        }
        return { outcome: "UNCHANGED", method: "AI_MAPPER", status: existing.status as "READY" | "BLOCKED" };
      }
      // mapperPromptVersion is stale: fall through to the normal deterministic
      // pass below, exactly as if there were no existing row — if Steps 1-5
      // still decline, this Topic becomes UNRESOLVED and is correctly
      // eligible for the (corrected) mapper to re-run.
    } else if (existing && factualIdentityMatches && existing.assignmentVersion === DETERMINISTIC_ASSIGNMENT_VERSION && !readyResolvesEmpty) {
      // Idempotent no-op for a deterministic-method row: identity matches on
      // both axes, so the persisted decision is still valid. Nothing is
      // recomputed and nothing is written.
      return { outcome: "UNCHANGED", method: existing.method as DeterministicMethod | "AI_MAPPER", status: existing.status as "READY" | "BLOCKED" };
    }

    const prior = await this.loadPriorAssignments(unit.id, unit.groundingVersion, unit.groundingSourceFingerprint, topicId);

    const assignment = computeDeterministicAssignment(notes, { id: topic.id, nameEn: topic.nameEn, order: topic.order }, siblings, prior);
    if (!assignment) {
      if (readyResolvesEmpty) {
        // Never leave an invalid READY in place: persist BLOCKED before handing over to the mapper
        // (which overwrites it with READY+non-empty or BLOCKED, and writes nothing when it has no candidates).
        await this.upsert({ topicId, unitGroundingVersion: unit.groundingVersion, unitSourceFingerprint: unit.groundingSourceFingerprint, method: existing!.method as DeterministicMethod | "AI_MAPPER", confidence: "LOW", status: "BLOCKED", matchedConceptNames: [], matchedHintTitles: null, mapperModel: (existing as any).mapperModel ?? null, mapperPromptVersion: existing!.mapperPromptVersion, reason: "Existing READY assignment resolved to an EMPTY slice; invalidated for recomputation." });
      }
      this.logger.log(
        JSON.stringify({ event: "TOPIC_GROUNDING_ASSIGNMENT_UNRESOLVED", topicId, unitId: unit.id, topicTitle: topic.nameEn, assignmentVersion: DETERMINISTIC_ASSIGNMENT_VERSION }),
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
        assignmentVersion: DETERMINISTIC_ASSIGNMENT_VERSION,
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
        assignmentVersion: DETERMINISTIC_ASSIGNMENT_VERSION,
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
      assignmentVersion: DETERMINISTIC_ASSIGNMENT_VERSION,
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

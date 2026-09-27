import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AIProviderFactory } from "../ai-provider.factory";
import { AIUsageService } from "../usage/ai-usage.service";
import { CONTENT_AUTHORING_ACTOR_ID } from "../content-authoring-actor.const";
import type { GroundingNotes } from "../../interactive-lesson/unit-grounding/unit-grounding.types";
import { TopicGroundingAssignmentService, computeDeterministicAssignment, type AssignmentTopic } from "./topic-grounding-assignment.service";

/**
 * The bounded COARSE-GROUNDING REFINEMENT selector (2026-09-28) — for
 * Category B ("COARSE_GROUNDING") Topics: Topics whose evidence is
 * genuinely scattered across facts/hints/vocabulary/learningObjectives, not
 * concentrated in one dominant unclaimed concept/hint the way
 * TopicGroundingValidatorService's single-candidate confirm handles.
 *
 * Unlike the validator (a yes/no confirm on ONE pre-identified candidate),
 * this is a CLOSED-SET SELECTOR: the model is shown the Unit's full
 * concepts/hints/facts/vocabulary/learningObjectives (all of it — broader
 * than the mapper's concept+hint-only surface) plus sibling Topics' already-
 * claimed items, and must either select a subset of what is shown or
 * report NOT_SUPPORTED. It may never invent, never use general knowledge,
 * never pull from another Unit.
 *
 * ---------------------------------------------------------------------------
 * NEVER REACHABLE FROM A STUDENT-FACING RUNTIME REQUEST PATH
 * ---------------------------------------------------------------------------
 * Deliberately NOT registered in any module — mirrors
 * TopicGroundingMapperService/TopicGroundingValidatorService exactly. Only
 * ever constructed explicitly by the scoped backfill runner
 * (topic-grounding-scoped-backfill.ts), called ONLY for the explicit,
 * pre-identified Category B topicId list — never via `assignGroundingForTopic`
 * or any mapper-version-bump path, and never for any topicId outside that
 * list.
 */

/** Own independent prompt-version axis — never confused with DETERMINISTIC_ASSIGNMENT_VERSION/MAPPER_PROMPT_VERSION/VALIDATOR_PROMPT_VERSION. */
export const REFINEMENT_PROMPT_VERSION = 1;

/**
 * Marks a persisted BLOCKED row as a genuinely-decided verdict (real
 * NOT_SUPPORTED, or supported:true at LOW confidence) rather than a
 * technical failure — see the "no row vs BLOCKED" persistence rule at the
 * `persist` call site below and the skip-guard in `refineCoarseGrounding`.
 * A BLOCKED row whose reason does NOT start with this exact prefix (e.g. an
 * older row persisted before this fix, or one this service never wrote) is
 * never treated as a decided verdict — it always falls through to a real
 * retry attempt.
 */
export const DECIDED_PREFIX = "[REFINEMENT:DECIDED] ";

const REFINEMENT_SYSTEM_PROMPT_HEADER = `You are a curriculum librarian determining whether the EXISTING verified grounding already contains sufficient evidence for one lesson Topic.

You may ONLY reference/select existing items already shown below — you must NOT create facts, invent source pages, add an unsupported concept, use general knowledge to fill a gap, or select anything from another Unit. If the evidence is insufficient, respond with supported: false — do not force a weak match.

Reply with ONLY a JSON object of exactly this shape:
{"supported": boolean, "selectedItems": [{"kind": "CONCEPT" | "HINT" | "FACT" | "VOCABULARY" | "OBJECTIVE", "name": string}], "confidence": "HIGH" | "LOW", "reason": string}

- selectedItems: only present/meaningful when supported is true. Each "name" must be copied VERBATIM from the lists below: a concept's name, a hint's topicTitle, a fact's exact text, a vocabulary term, or a learning objective's exact text.
- confidence: HIGH only when you are certain the selected items are this Topic's own content and nothing is missing/borrowed. Otherwise LOW.
- If supported is false, selectedItems may be omitted or empty.`;

export interface RefinementPromptInput {
  topicNameEn: string;
  topicNameAr: string;
  topicOrder: number;
  siblingTopics: { nameEn: string; order: number; claimedNames: string[] }[];
  notes: GroundingNotes;
}

export function buildRefinementPrompt(input: RefinementPromptInput): string {
  const { notes } = input;
  const siblings = input.siblingTopics
    .filter((t) => !(t.order === input.topicOrder && t.nameEn === input.topicNameEn))
    .sort((a, b) => a.order - b.order)
    .map((t) => `  ${t.order}. ${t.nameEn}${t.claimedNames.length ? ` (already claims: ${t.claimedNames.join(" ; ")})` : ""}`)
    .join("\n");

  const concepts = notes.concepts.map((c) => `  - [CONCEPT] "${c.name}" (pages ${c.sourcePages.join(",")}): ${c.description}`).join("\n");
  const hints = (notes.topicHints ?? []).map((h) => `  - [HINT] "${h.topicTitle}" (pages ${(h.sourcePages ?? []).join(",")}): ${h.relevantConcepts.join(" ; ")}`).join("\n");
  const facts = notes.facts.map((f) => `  - [FACT] "${f.fact}" (pages ${f.sourcePages.join(",")})`).join("\n");
  const vocabulary = notes.vocabulary.map((v) => `  - [VOCABULARY] "${v.term}" (pages ${v.sourcePages.join(",")}): ${v.meaning}`).join("\n");
  const objectives = notes.learningObjectives.map((o) => `  - [OBJECTIVE] "${o}"`).join("\n");

  return [
    REFINEMENT_SYSTEM_PROMPT_HEADER,
    "",
    `UNIT: ${notes.unitTitle} (${notes.subject}, ${notes.gradeLevel})`,
    "",
    `TOPIC TO EVALUATE: "${input.topicNameEn}" / "${input.topicNameAr}" (order ${input.topicOrder})`,
    "",
    `THE UNIT'S OTHER TOPICS (never select items reserved to a sibling below):\n${siblings || "  (none)"}`,
    "",
    `CONCEPTS:\n${concepts || "  (none)"}`,
    "",
    `TOPIC HINTS:\n${hints || "  (none)"}`,
    "",
    `FACTS:\n${facts || "  (none)"}`,
    "",
    `VOCABULARY:\n${vocabulary || "  (none)"}`,
    "",
    `LEARNING OBJECTIVES:\n${objectives || "  (none)"}`,
    "",
    "Determine support and respond with the JSON object now.",
  ].join("\n");
}

export interface SelectedItem {
  kind: "CONCEPT" | "HINT" | "FACT" | "VOCABULARY" | "OBJECTIVE";
  name: string;
}

export type RefinementValidationResult =
  | { ok: true; supported: true; selectedItems: SelectedItem[]; confidence: "HIGH" | "LOW"; reason: string }
  | { ok: true; supported: false; confidence: "HIGH" | "LOW"; reason: string }
  | {
      ok: false;
      code: "UNPARSEABLE_JSON" | "NOT_AN_OBJECT" | "MISSING_FIELDS" | "HALLUCINATED_ITEM" | "EMPTY_BUT_SUPPORTED";
      detail: string;
    };

/**
 * Strict post-validation, "one bad item rejects the whole response"
 * philosophy: every selectedItems[].name must exist VERBATIM in that exact
 * category of the Unit's CURRENT grounding. Malformed JSON, missing fields,
 * a hallucinated item, or supported:true with an empty selectedItems are all
 * rejected outright.
 */
export function validateRefinementResponse(raw: string, notes: GroundingNotes): RefinementValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: "UNPARSEABLE_JSON", detail: `Could not parse JSON: ${raw.slice(0, 200)}` };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, code: "NOT_AN_OBJECT", detail: "Response was not a JSON object." };
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.supported !== "boolean") {
    return { ok: false, code: "MISSING_FIELDS", detail: `Missing/invalid required field "supported": ${JSON.stringify(obj)}` };
  }

  // NEGATIVE path: {"supported": false} is a complete, valid response on its
  // own — confidence/reason/selectedItems are optional extras, never
  // required. A model that correctly determined "no evidence here" must
  // never be penalized for omitting fields that only matter on the positive
  // path; requiring them here previously caused genuine NOT_SUPPORTED
  // verdicts to be wrongly rejected as MISSING_FIELDS (2026-09-28 production
  // incident — 12 of 17 remaining-BLOCKED Category B topics were exactly
  // this). Malformed/irrelevant extra fields alongside supported:false are
  // ignored, never used to promote or alter the verdict.
  if (obj.supported === false) {
    const confidence = obj.confidence === "HIGH" || obj.confidence === "LOW" ? obj.confidence : "LOW";
    const reason = typeof obj.reason === "string" ? obj.reason : "Model reported supported:false.";
    return { ok: true, supported: false, confidence, reason };
  }

  // POSITIVE path: every existing strict field requirement remains mandatory
  // and unweakened.
  if ((obj.confidence !== "HIGH" && obj.confidence !== "LOW") || typeof obj.reason !== "string") {
    return { ok: false, code: "MISSING_FIELDS", detail: `Missing/invalid required fields for supported:true: ${JSON.stringify(obj)}` };
  }

  const rawItems = obj.selectedItems;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { ok: false, code: "EMPTY_BUT_SUPPORTED", detail: "supported: true with no (or non-array) selectedItems." };
  }

  const conceptNames = new Set(notes.concepts.map((c) => c.name));
  const hintTitles = new Set((notes.topicHints ?? []).map((h) => h.topicTitle));
  const factTexts = new Set(notes.facts.map((f) => f.fact));
  const vocabTerms = new Set(notes.vocabulary.map((v) => v.term));
  const objectiveTexts = new Set(notes.learningObjectives);

  const poolFor = (kind: SelectedItem["kind"]): Set<string> => {
    switch (kind) {
      case "CONCEPT":
        return conceptNames;
      case "HINT":
        return hintTitles;
      case "FACT":
        return factTexts;
      case "VOCABULARY":
        return vocabTerms;
      case "OBJECTIVE":
        return objectiveTexts;
    }
  };

  const selectedItems: SelectedItem[] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") return { ok: false, code: "MISSING_FIELDS", detail: `Non-object selectedItems entry: ${JSON.stringify(raw)}` };
    const item = raw as Record<string, unknown>;
    const kind = item.kind;
    const name = item.name;
    if ((kind !== "CONCEPT" && kind !== "HINT" && kind !== "FACT" && kind !== "VOCABULARY" && kind !== "OBJECTIVE") || typeof name !== "string") {
      return { ok: false, code: "MISSING_FIELDS", detail: `Invalid selectedItems entry: ${JSON.stringify(item)}` };
    }
    if (!poolFor(kind).has(name)) {
      return { ok: false, code: "HALLUCINATED_ITEM", detail: `"${name}" (${kind}) is not verbatim present in the Unit's current grounding.` };
    }
    selectedItems.push({ kind, name });
  }

  return { ok: true, supported: true, selectedItems, confidence: obj.confidence, reason: obj.reason };
}

export type RefinementOutcome =
  | { outcome: "SKIPPED_DETERMINISTIC"; reason: string }
  | { outcome: "NOT_GROUNDED"; reason: string }
  | { outcome: "SKIPPED_ALREADY_READY"; reason: string }
  /**
   * A prior run already reached a genuine, well-formed NOT_SUPPORTED (or
   * supported:true/LOW-confidence) verdict for this exact refinement
   * identity — re-asking the same question is pointless until
   * REFINEMENT_PROMPT_VERSION or the Unit's factual identity changes. This
   * is distinct from a technical failure (malformed/hallucinated/provider
   * error), which is NEVER persisted and therefore always eligible for
   * retry on the next run — see the "no row vs BLOCKED" persistence rule
   * below.
   */
  | { outcome: "SKIPPED_ALREADY_VALID_NOT_SUPPORTED"; reason: string }
  | { outcome: "READY"; matchedConceptNames: string[]; matchedHintTitles: string[] | null; model: string }
  | { outcome: "VALID_NOT_SUPPORTED"; reason: string }
  | { outcome: "TECHNICAL_FAILURE"; code: string; detail: string };

@Injectable()
export class TopicGroundingRefinementService {
  private readonly logger = new Logger(TopicGroundingRefinementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: AIProviderFactory,
    private readonly usageService: AIUsageService,
    private readonly assignmentService: TopicGroundingAssignmentService,
  ) {}

  async refineCoarseGrounding(topicId: string): Promise<RefinementOutcome> {
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
      return { outcome: "NOT_GROUNDED", reason: `Unit ${unit.id} has no completed grounding.` };
    }

    const existing = topic.groundingAssignment;
    const existingFactualIdentityMatches =
      !!existing && existing.unitGroundingVersion === unit.groundingVersion && existing.unitSourceFingerprint === unit.groundingSourceFingerprint;

    if (existing && existingFactualIdentityMatches && existing.status === "READY") {
      return { outcome: "SKIPPED_ALREADY_READY", reason: `Topic ${topicId} already has a valid READY assignment.` };
    }

    // A genuinely-decided verdict (real NOT_SUPPORTED, or supported:true at
    // LOW confidence) is tagged with the DECIDED_PREFIX below and is only
    // ever retried if REFINEMENT_PROMPT_VERSION or the Unit's factual
    // identity changes — re-asking the identical question is pointless
    // otherwise. A TECHNICAL failure (malformed/hallucinated/provider
    // error) is NEVER persisted (see the persist-site below), so it has no
    // row here at all and always falls through to a real retry — this
    // check can never accidentally skip one, by construction: only a row
    // whose reason literally starts with DECIDED_PREFIX can match.
    if (
      existing &&
      existingFactualIdentityMatches &&
      existing.status === "BLOCKED" &&
      existing.method === "AI_MAPPER" &&
      existing.mapperPromptVersion === REFINEMENT_PROMPT_VERSION &&
      typeof existing.reason === "string" &&
      existing.reason.startsWith(DECIDED_PREFIX)
    ) {
      return { outcome: "SKIPPED_ALREADY_VALID_NOT_SUPPORTED", reason: `Topic ${topicId} already has a decided, current NOT_SUPPORTED/LOW-confidence verdict.` };
    }

    const notes = unit.groundingNotesJson as unknown as GroundingNotes;
    const siblings: AssignmentTopic[] = unit.topics.map((t) => ({ id: t.id, nameEn: t.nameEn, order: t.order }));
    const thisTopic: AssignmentTopic = { id: topic.id, nameEn: topic.nameEn, order: topic.order };

    const deterministic = computeDeterministicAssignment(notes, thisTopic, siblings);
    if (deterministic) {
      return { outcome: "SKIPPED_DETERMINISTIC", reason: `Deterministic Steps 1-5 resolved this Topic as ${deterministic.method} — refinement must not override cheaper logic.` };
    }

    const siblingsForPrompt = siblings.map((s) => {
      if (s.id === topic.id) return { nameEn: s.nameEn, order: s.order, claimedNames: [] as string[] };
      const sibAssignment = computeDeterministicAssignment(notes, s, siblings);
      return { nameEn: s.nameEn, order: s.order, claimedNames: sibAssignment ? [...sibAssignment.matchedConceptNames, ...(sibAssignment.matchedHintTitles ?? [])] : [] };
    });

    const systemPrompt = buildRefinementPrompt({
      topicNameEn: topic.nameEn,
      topicNameAr: topic.nameAr,
      topicOrder: topic.order,
      siblingTopics: siblingsForPrompt,
      notes,
    });
    const userMessage = "Evaluate support and respond with the JSON object now.";

    const { provider, providerKey, model } = await this.providerFactory.getActiveProvider();
    const estimatedUsd = await this.usageService.estimateMaxChatCostUsd({ providerKey, inputText: systemPrompt + userMessage });
    const reserveResult = await this.usageService.reserveBudget(CONTENT_AUTHORING_ACTOR_ID, estimatedUsd);
    if (!reserveResult.ok) {
      return { outcome: "TECHNICAL_FAILURE", code: "BUDGET_UNAVAILABLE", detail: `Budget unavailable (${reserveResult.reason}) — nothing persisted, safe to retry later.` };
    }

    let result: Awaited<ReturnType<typeof provider.generate>>;
    try {
      result = await provider.generate({ systemPrompt, messages: [{ role: "user", content: userMessage }] });
    } catch (err) {
      await this.usageService.releaseBudget(reserveResult.reservationId).catch(() => undefined);
      throw err;
    }

    const rates = await this.providerFactory.getCostRates(providerKey);
    const actualCostUsd = result.inputTokens * rates.costPerInputToken + result.outputTokens * rates.costPerOutputToken;
    await this.prisma.client.aIUsage
      .create({
        data: {
          userId: CONTENT_AUTHORING_ACTOR_ID,
          studentId: null,
          subjectId: null,
          feature: "topic_grounding_refinement",
          provider: providerKey,
          model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          creditsUsed: 0,
          costUsd: actualCostUsd,
        },
      })
      .catch((err) => this.logger.warn(`Usage log failed (refinement still completed): ${err instanceof Error ? err.message : String(err)}`));
    await this.usageService.reconcileBudget(reserveResult.reservationId, actualCostUsd).catch(() => undefined);

    const validated = validateRefinementResponse(result.content, notes);

    const persist = (status: "READY" | "BLOCKED", names: string[], titles: string[] | null, reason: string) =>
      this.assignmentService.upsert({
        topicId,
        unitGroundingVersion: unit.groundingVersion!,
        unitSourceFingerprint: unit.groundingSourceFingerprint!,
        method: "AI_MAPPER",
        confidence: status === "READY" ? "HIGH" : "LOW",
        status,
        matchedConceptNames: names,
        matchedHintTitles: titles,
        mapperModel: model,
        mapperPromptVersion: REFINEMENT_PROMPT_VERSION,
        reason: `${DECIDED_PREFIX}${reason}`,
      });

    if (!validated.ok) {
      // TECHNICAL failure — never persisted. No row means this Topic is
      // always eligible for a real retry on the next run (the existing
      // "no row vs BLOCKED" convention already used elsewhere in this
      // codebase), rather than being wrongly frozen as a decided verdict.
      this.logger.warn(JSON.stringify({ event: "TOPIC_GROUNDING_REFINEMENT_REJECTED", topicId, unitId: unit.id, code: validated.code, detail: validated.detail }));
      return { outcome: "TECHNICAL_FAILURE", code: validated.code, detail: validated.detail };
    }

    if (!validated.supported) {
      const reason = validated.reason || "NOT_SUPPORTED.";
      await persist("BLOCKED", [], null, reason);
      return { outcome: "VALID_NOT_SUPPORTED", reason };
    }

    if (validated.confidence === "LOW") {
      const reason = validated.reason || "supported:true at LOW confidence — never treated as usable grounding.";
      await persist("BLOCKED", [], null, reason);
      return { outcome: "VALID_NOT_SUPPORTED", reason };
    }

    // Persist concept/hint names normally; fact/vocabulary/objective
    // selections are persisted as their own verbatim TEXT into
    // matchedConceptNames (an opaque identifier string, mirroring the exact
    // convention Phase 1 established for vocabulary — see the design-
    // decision comment in topic-grounding-assignment.util.ts's
    // sliceFromAssignment). This never leaves a selected item unresolvable
    // at read time.
    const matchedConceptNames: string[] = [];
    const matchedHintTitles: string[] = [];
    for (const item of validated.selectedItems) {
      if (item.kind === "HINT") matchedHintTitles.push(item.name);
      else matchedConceptNames.push(item.name); // CONCEPT, FACT, VOCABULARY, OBJECTIVE all flow into the opaque names array
    }

    await persist("READY", matchedConceptNames, matchedHintTitles.length > 0 ? matchedHintTitles : null, validated.reason);
    this.logger.log(JSON.stringify({ event: "TOPIC_GROUNDING_REFINEMENT_ASSIGNED", topicId, unitId: unit.id, model, refinementPromptVersion: REFINEMENT_PROMPT_VERSION }));
    return { outcome: "READY", matchedConceptNames, matchedHintTitles: matchedHintTitles.length > 0 ? matchedHintTitles : null, model };
  }
}

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AIProviderFactory } from "../ai-provider.factory";
import { AIUsageService } from "../usage/ai-usage.service";
import { CONTENT_AUTHORING_ACTOR_ID } from "../content-authoring-actor.const";
import type { GroundingNotes } from "../../interactive-lesson/unit-grounding/unit-grounding.types";
import { TopicGroundingAssignmentService, computeDeterministicAssignment } from "./topic-grounding-assignment.service";
import { MAPPER_PROMPT_VERSION } from "./topic-grounding-assignment.util";
import { prefilterCompactCandidates, validateCompactResponse } from "./compact-grounding-mapper.util";

/**
 * The bounded AI mapper — the LAST resort for a Topic whose grounding
 * assignment the deterministic Steps 1-5 could not decide (2026-09-27).
 *
 * ---------------------------------------------------------------------------
 * NEVER REACHABLE FROM A STUDENT-FACING RUNTIME REQUEST PATH
 * ---------------------------------------------------------------------------
 * This service is deliberately NOT registered as a provider in AIModule (or
 * any other module that a request-handling controller can reach) — see the
 * comment in ai.module.ts. It is constructed explicitly, by the
 * preparation/backfill script only (apps/backend/src/scripts/
 * prepare-topic-grounding-assignments.ts). The four runtime consumers read the
 * PERSISTED TopicGroundingAssignment row via
 * topic-grounding-assignment.util.ts and have no reference to this file at
 * all; a missing/stale/blocked row makes them fail safely as "not ready", it
 * never triggers a live mapper call.
 *
 * The model is never allowed to AUTHOR anything. It only SELECTS from the
 * verbatim lists it is shown, and every string it returns is re-checked
 * against those lists before anything is persisted. Any violation at all —
 * one hallucinated name, unparseable JSON, a missing field, an
 * empty-but-HIGH-confidence contradiction — discards the WHOLE response and
 * persists a BLOCKED row. LOW confidence is likewise persisted as BLOCKED and
 * never usable as grounding.
 */

/**
 * Bumped whenever this prompt or the mapper's behavior changes. Defined in
 * topic-grounding-assignment.util.ts (the shared, dependency-free layer both
 * this service and the read path use) and re-exported here so existing
 * imports of `MAPPER_PROMPT_VERSION` from this module keep compiling.
 */
export { MAPPER_PROMPT_VERSION };

const MAPPER_SYSTEM_PROMPT_HEADER = `You are a curriculum librarian assigning ONE lesson Topic to the already-extracted study notes of the textbook Unit it belongs to.

You are selecting EXISTING items from the lists provided below. You may NEVER invent a concept name or hint title that is not verbatim present in the lists. Copy the strings character-for-character, exactly as written, including capitalisation and punctuation. If nothing in the provided lists is genuinely relevant to this Topic, return an empty selection with confidence LOW. Never guess.

The Unit's other Topics are listed so you know what NOT to claim: content that clearly belongs to a sibling Topic must be left to that sibling.

Reply with ONLY a JSON object of exactly this shape:
{"matchedConceptNames": string[], "matchedHintTitles": string[] | null, "confidence": "HIGH" | "LOW", "reason": string}

- matchedConceptNames: verbatim names from CONCEPTS below that this Topic teaches.
- matchedHintTitles: verbatim topicTitle values from TOPIC HINTS below that describe this Topic, or null.
- confidence: HIGH only when you are certain the selected items are this Topic's own content. Otherwise LOW.
- reason: one short sentence explaining the selection (or why nothing matched).`;

export interface MapperValidationSuccess {
  ok: true;
  matchedConceptNames: string[];
  matchedHintTitles: string[] | null;
  confidence: "HIGH" | "LOW";
  reason: string;
}
export interface MapperValidationFailure {
  ok: false;
  /** Machine-readable rejection code, logged verbatim. */
  code:
    | "UNPARSEABLE_JSON"
    | "NOT_AN_OBJECT"
    | "MISSING_FIELDS"
    | "HALLUCINATED_CONCEPT_NAME"
    | "HALLUCINATED_HINT_TITLE"
    | "EMPTY_BUT_HIGH_CONFIDENCE";
  detail: string;
}
export type MapperValidationResult = MapperValidationSuccess | MapperValidationFailure;

/**
 * Post-validation. Runs on EVERY mapper response before anything is persisted.
 * A single violation rejects the WHOLE response — a bad name is never silently
 * dropped while the rest is kept, because a response that invented one string
 * is not trustworthy for the others either.
 */
export function validateMapperResponse(rawContent: string, notes: GroundingNotes): MapperValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    return { ok: false, code: "UNPARSEABLE_JSON", detail: "Response was not valid JSON." };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, code: "NOT_AN_OBJECT", detail: "Response was not a JSON object." };
  }

  const obj = parsed as Record<string, unknown>;
  const names = obj.matchedConceptNames;
  const titles = obj.matchedHintTitles;
  const confidence = obj.confidence;
  const reason = obj.reason;

  const namesOk = Array.isArray(names) && names.every((n) => typeof n === "string");
  const titlesOk = titles === null || titles === undefined || (Array.isArray(titles) && titles.every((t) => typeof t === "string"));
  const confidenceOk = confidence === "HIGH" || confidence === "LOW";
  if (!namesOk || !titlesOk || !confidenceOk || typeof reason !== "string") {
    return {
      ok: false,
      code: "MISSING_FIELDS",
      detail: `Required fields missing or wrongly typed (matchedConceptNames=${namesOk}, matchedHintTitles=${titlesOk}, confidence=${confidenceOk}, reason=${typeof reason}).`,
    };
  }

  const conceptNames = names as string[];
  const hintTitles = (titles ?? null) as string[] | null;

  // Defence in depth: structurally the model is only ever shown ONE Unit's
  // lists, so a cross-Unit reference should be impossible — verify anyway.
  //
  // 2026-09-27 field-scope fix: a forensic production audit (Topics "Honoring
  // the Guest", "A Collage") found the model sometimes names an item that is
  // verbatim present in this Unit's own VOCABULARY list rather than its
  // CONCEPTS list — both are shown to the model in the same prompt (see
  // buildMapperPrompt) as real, already-verified evidence for this Unit, so a
  // verbatim vocabulary term is exactly as trustworthy as a verbatim concept
  // name; only the POOL being checked was too narrow, never the match rule
  // itself (still character-for-character, never fuzzy/substring/normalized).
  // `matchedConceptNames` is not renamed/split here: downstream
  // (sliceFromAssignment in topic-grounding-assignment.util.ts) already
  // resolves a persisted name against both `notes.concepts` and
  // `notes.vocabulary`, so one flat name list remains the correct persisted
  // shape.
  const allowedConcepts = new Set(notes.concepts.map((c) => c.name));
  const allowedVocabulary = new Set((notes.vocabulary ?? []).map((v) => v.term));
  for (const name of conceptNames) {
    if (!allowedConcepts.has(name) && !allowedVocabulary.has(name)) {
      return { ok: false, code: "HALLUCINATED_CONCEPT_NAME", detail: `"${name}" is not a verbatim concept name or vocabulary term in this Unit's grounding.` };
    }
  }
  const allowedHints = new Set((notes.topicHints ?? []).map((h) => h.topicTitle));
  for (const title of hintTitles ?? []) {
    if (!allowedHints.has(title)) {
      return { ok: false, code: "HALLUCINATED_HINT_TITLE", detail: `"${title}" is not a verbatim topicHints title in this Unit's grounding.` };
    }
  }

  const selectedNothing = conceptNames.length === 0 && (hintTitles === null || hintTitles.length === 0);
  if (selectedNothing && confidence === "HIGH") {
    return { ok: false, code: "EMPTY_BUT_HIGH_CONFIDENCE", detail: "Empty selection reported as HIGH confidence — a contradiction." };
  }

  return { ok: true, matchedConceptNames: conceptNames, matchedHintTitles: hintTitles, confidence, reason };
}

/** Builds the mapper prompt for ONE Topic from ONE Unit's data only. */
export function buildMapperPrompt(input: {
  topicNameEn: string;
  topicOrder: number;
  siblingTopics: { nameEn: string; order: number }[];
  notes: GroundingNotes;
}): string {
  const { notes } = input;
  const siblings = input.siblingTopics
    .filter((t) => !(t.order === input.topicOrder && t.nameEn === input.topicNameEn))
    .sort((a, b) => a.order - b.order)
    .map((t) => `  ${t.order}. ${t.nameEn}`)
    .join("\n");

  return [
    MAPPER_SYSTEM_PROMPT_HEADER,
    "",
    `UNIT: ${notes.unitTitle} (${notes.subject}, ${notes.gradeLevel})`,
    "",
    `TOPIC TO ASSIGN: "${input.topicNameEn}" (order ${input.topicOrder})`,
    "",
    `THE UNIT'S OTHER TOPICS (do not claim their content):\n${siblings || "  (none)"}`,
    "",
    `LEARNING OBJECTIVES:\n${notes.learningObjectives.map((o) => `  - ${o}`).join("\n") || "  (none)"}`,
    "",
    `TOPIC HINTS (verbatim topicTitle values you may select):\n${
      (notes.topicHints ?? []).map((h) => `  - topicTitle: ${h.topicTitle} | pages: ${(h.sourcePages ?? []).join(",")} | relevantConcepts: ${h.relevantConcepts.join(" ; ")}`).join("\n") || "  (none)"
    }`,
    "",
    `CONCEPTS (verbatim names you may select):\n${notes.concepts.map((c) => `  - name: ${c.name} | pages: ${c.sourcePages.join(",")} | ${c.description}`).join("\n") || "  (none)"}`,
    "",
    `FACTS:\n${notes.facts.map((f) => `  - ${f.fact} | pages: ${f.sourcePages.join(",")}`).join("\n") || "  (none)"}`,
    "",
    `VOCABULARY:\n${notes.vocabulary.map((v) => `  - ${v.term}: ${v.meaning} | pages: ${v.sourcePages.join(",")}`).join("\n") || "  (none)"}`,
  ].join("\n");
}

export type MapperOutcome =
  | { outcome: "SKIPPED_DETERMINISTIC"; reason: string }
  | { outcome: "NOT_GROUNDED"; reason: string }
  | { outcome: "READY"; matchedConceptNames: string[]; matchedHintTitles: string[] | null; model: string }
  | { outcome: "BLOCKED"; reason: string; code?: MapperValidationFailure["code"] | "BUDGET_UNAVAILABLE" };

@Injectable()
export class TopicGroundingMapperService {
  private readonly logger = new Logger(TopicGroundingMapperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: AIProviderFactory,
    private readonly usageService: AIUsageService,
    private readonly assignmentService: TopicGroundingAssignmentService,
  ) {}

  /**
   * One bounded AI call for ONE Topic. Refuses to run at all if the
   * deterministic Steps 1-5 would in fact have resolved this Topic (so the
   * mapper can never override cheaper, provable logic), and always persists an
   * outcome: READY, or BLOCKED on any validation failure / LOW confidence.
   *
   * Budgeted exactly like every other content-authoring call: platform-scoped
   * CONTENT_AUTHORING_ACTOR_ID, reserve -> provider call -> log usage ->
   * reconcile, never a real student's per-student budget.
   */
  async mapTopic(topicId: string): Promise<MapperOutcome> {
    const topic = await this.prisma.client.topic.findUnique({
      where: { id: topicId },
      include: {
        topicSourceEvidence: { where: { status: "READY" } },
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
      return { outcome: "NOT_GROUNDED", reason: `Unit ${unit.id} has no completed grounding — nothing to map from.` };
    }
    const notes = appendReadyEvidence(unit.groundingNotesJson as unknown as GroundingNotes, (topic as any).topicSourceEvidence, topic.id, unit.id, unit.groundingSourceFingerprint);
    const siblings = unit.topics.map((t) => ({ id: t.id, nameEn: t.nameEn, order: t.order }));

    const deterministic = computeDeterministicAssignment(notes, { id: topic.id, nameEn: topic.nameEn, order: topic.order }, siblings);
    if (deterministic) {
      return { outcome: "SKIPPED_DETERMINISTIC", reason: `Deterministic Step resolved this Topic as ${deterministic.method} — the mapper must not override it.` };
    }

    // Compact closed-set mapper: only request-local indexed candidates are sent.
    const candidates = prefilterCompactCandidates(topic.nameEn, notes);
    if (candidates.length === 0) return { outcome: "NOT_GROUNDED", reason: "No compact grounding candidates; provider call skipped." };
    const compactPrompt = `Select evidence for Topic "${topic.nameEn}". Return ONLY {"supported":false} or {"supported":true,"matches":[{"type":"concept","index":0}]}. Candidates:\n${candidates.map(c => `${c.type}[${c.index}]: ${c.label}`).join("\n")}`;
    const { provider, providerKey, model } = await this.providerFactory.getActiveProvider();
    const estimatedUsd = await this.usageService.estimateMaxChatCostUsd({ providerKey, inputText: compactPrompt });
    const reserveResult = await this.usageService.reserveBudget(CONTENT_AUTHORING_ACTOR_ID, estimatedUsd);
    if (!reserveResult.ok) return { outcome: "BLOCKED", reason: `Budget unavailable (${reserveResult.reason})`, code: "BUDGET_UNAVAILABLE" };
    let result: Awaited<ReturnType<typeof provider.generate>>;
    try { result = await provider.generate({ systemPrompt: compactPrompt, messages: [{ role: "user", content: "Select now. Return JSON only." }], responseFormat: "json_object" }); }
    catch (err) { await this.usageService.releaseBudget(reserveResult.reservationId).catch(() => undefined); throw err; }
    const actualCostUsd = await this.logUsage(providerKey, model, result.inputTokens, result.outputTokens);
    await this.usageService.reconcileBudget(reserveResult.reservationId, actualCostUsd).catch(() => undefined);
    let compact: ReturnType<typeof validateCompactResponse>;
    try { compact = validateCompactResponse(JSON.parse(result.content), candidates); }
    catch (err) { await this.assignmentService.upsert({ topicId, unitGroundingVersion: unit.groundingVersion!, unitSourceFingerprint: unit.groundingSourceFingerprint!, method: "AI_MAPPER", confidence: "LOW", status: "BLOCKED", matchedConceptNames: [], matchedHintTitles: null, mapperModel: model, mapperPromptVersion: MAPPER_PROMPT_VERSION, reason: `Compact mapper rejected: ${err instanceof Error ? err.message : "invalid response"}` }); return { outcome: "BLOCKED", reason: "Compact mapper response rejected" }; }
    if (!compact.supported) { await this.assignmentService.upsert({ topicId, unitGroundingVersion: unit.groundingVersion!, unitSourceFingerprint: unit.groundingSourceFingerprint!, method: "AI_MAPPER", confidence: "LOW", status: "BLOCKED", matchedConceptNames: [], matchedHintTitles: null, mapperModel: model, mapperPromptVersion: MAPPER_PROMPT_VERSION, reason: "[REFINEMENT:DECIDED] Model reported supported:false." }); return { outcome: "BLOCKED", reason: "Topic unsupported by existing grounding" }; }
    const resolved = compact.matches.map(m => candidates.find(c => c.type === m.type && c.index === m.index)!);
    const names = resolved.filter(x => x.type === "concept" || x.type === "vocabulary").map(x => x.label);
    await this.assignmentService.upsert({ topicId, unitGroundingVersion: unit.groundingVersion!, unitSourceFingerprint: unit.groundingSourceFingerprint!, method: "AI_MAPPER", confidence: "HIGH", status: "READY", matchedConceptNames: names, matchedHintTitles: resolved.filter(x => x.type === "topicHint").map(x => x.label), mapperModel: model, mapperPromptVersion: MAPPER_PROMPT_VERSION, reason: "Compact mapper selected persisted evidence." });
    return { outcome: "READY", matchedConceptNames: names, matchedHintTitles: resolved.filter(x => x.type === "topicHint").map(x => x.label), model };
  }

  private async logUsage(providerKey: string, model: string, inputTokens: number, outputTokens: number): Promise<number> {
    const rates = await this.providerFactory.getCostRates(providerKey);
    const costUsd = inputTokens * rates.costPerInputToken + outputTokens * rates.costPerOutputToken;
    await this.prisma.client.aIUsage
      .create({
        data: {
          userId: CONTENT_AUTHORING_ACTOR_ID,
          studentId: null,
          subjectId: null,
          feature: "topic_grounding_mapper",
          provider: providerKey,
          model,
          inputTokens,
          outputTokens,
          creditsUsed: 0,
          costUsd,
        },
      })
      .catch((err) => this.logger.warn(`Usage log failed (mapping still completed): ${err instanceof Error ? err.message : String(err)}`));
    return costUsd;
  }
}

function appendReadyEvidence(notes:GroundingNotes,rows:any[],topicId:string,unitId:string,fingerprint:string):GroundingNotes{const merged:GroundingNotes={...notes,concepts:[...notes.concepts],facts:[...notes.facts],vocabulary:[...notes.vocabulary],learningObjectives:[...notes.learningObjectives],topicHints:[...notes.topicHints]};for(const row of rows??[]){if(row.topicId!==topicId||row.unitId!==unitId||row.sourceFingerprint!==fingerprint||row.status!=="READY"||!Array.isArray(row.evidenceJson))continue;for(const item of row.evidenceJson){if(!item||typeof item.label!=="string"||!Array.isArray(item.sourcePages))continue;if(item.type==="concept")merged.concepts.push({name:item.label,description:item.label,sourcePages:item.sourcePages,importance:"core"});else if(item.type==="fact")merged.facts.push({fact:item.label,sourcePages:item.sourcePages,importance:"core"});else if(item.type==="vocabulary")merged.vocabulary.push({term:item.label,meaning:item.label,sourcePages:item.sourcePages});else if(item.type==="objective")merged.learningObjectives.push(item.label);else if(item.type==="hint")merged.topicHints.push({topicTitle:item.label,relevantConcepts:[item.label],sourcePages:item.sourcePages});}}return merged;}




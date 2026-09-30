import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AIProviderFactory } from "../ai-provider.factory";
import { AIUsageService } from "../usage/ai-usage.service";
import { CONTENT_AUTHORING_ACTOR_ID } from "../content-authoring-actor.const";
import type { GroundingNotes } from "../../interactive-lesson/unit-grounding/unit-grounding.types";

/**
 * The bilingual concept/hint ALIAS GENERATOR (2026-09-28) — a bounded,
 * per-Unit AI call that proposes an other-language restatement of each
 * existing concept/hint name, so that `identifySingleCandidate` (see
 * topic-grounding-validator-candidate.util.ts) can bridge a Topic title in
 * one language against an already-verified concept/hint authored in the
 * other language (e.g. English Topic title "Between Prophethood and
 * Messengership" against Arabic concepts "النبوة"/"الرسالة").
 *
 * ---------------------------------------------------------------------------
 * THE MODEL MAY ONLY RESTATE — NEVER ADD NEW EVIDENCE
 * ---------------------------------------------------------------------------
 * This is NOT a translation-for-display feature and NOT a new extraction
 * step: the model is shown items ALREADY extracted and verified from the
 * real textbook, and is asked only to restate their existing meaning in the
 * other language, exactly as a bilingual glossary entry would. It must never
 * add a fact, a nuance, a qualifier, or any detail not already present in
 * the item's own name. If it cannot confidently do so, it must omit that
 * item entirely — never guess.
 *
 * The generated aliases are NEVER treated as evidence themselves: aliases
 * are a pure LOOKUP BRIDGE. A Topic matched via an alias always resolves
 * back to the ORIGINAL concept/hint's own real sourcePages/content — see
 * `identifySingleCandidate`'s alias-bridge extension in
 * topic-grounding-validator-candidate.util.ts.
 *
 * ---------------------------------------------------------------------------
 * NEVER REACHABLE FROM A STUDENT-FACING RUNTIME REQUEST PATH
 * ---------------------------------------------------------------------------
 * Deliberately NOT registered in any module — mirrors
 * TopicGroundingMapperService/TopicGroundingValidatorService exactly. Only
 * ever constructed explicitly by a scoped backfill runner
 * (topic-grounding-scoped-backfill.ts) operating over an explicit, small,
 * pre-identified list of Unit ids — never over every Unit, and never
 * triggered by the broad `assignGroundingForTopic` path.
 */

/** This mechanism's OWN prompt version — independent of DETERMINISTIC_ASSIGNMENT_VERSION/MAPPER_PROMPT_VERSION/VALIDATOR_PROMPT_VERSION. */
export const ALIAS_GENERATION_VERSION = 1;

const ALIAS_SYSTEM_PROMPT_HEADER = `You are a bilingual curriculum glossary assistant. Below is a list of ALREADY-VERIFIED concept and hint names extracted from a real textbook Unit, each tagged with its own language.

Your ONLY job: for each item, if you can confidently restate its EXACT existing meaning in the OTHER language (Arabic if the item is English, English if the item is Arabic), do so. You are restating the meaning of this exact, already-verified item in the other language; you must NOT add any fact, detail, or nuance not already present in the item's own name/description; if you cannot confidently restate it, OMIT that item from your output rather than guess.

Reply with ONLY a JSON array of objects of exactly this shape:
[{"itemKind": "CONCEPT" | "HINT", "itemName": string, "canonicalLabel": string, "aliasEn": string | null, "aliasAr": string | null}]

- itemName: copy the item's name VERBATIM, character-for-character, exactly as shown below.
- canonicalLabel: a short, language-neutral slug/summary (a few words).
- aliasEn/aliasAr: whichever ONE differs from the item's own language should be filled in; the other may be null. Never invent content.
- Omit any item entirely from the array rather than guess at its meaning.`;

export interface AliasSourceItem {
  itemKind: "CONCEPT" | "HINT";
  itemName: string;
  description: string;
}

export function buildAliasSourceItems(notes: GroundingNotes): AliasSourceItem[] {
  return [
    ...notes.concepts.map((c) => ({ itemKind: "CONCEPT" as const, itemName: c.name, description: c.description })),
    ...(notes.topicHints ?? []).map((h) => ({ itemKind: "HINT" as const, itemName: h.topicTitle, description: h.relevantConcepts.join(" ; ") })),
  ];
}

export function buildAliasPrompt(unitTitle: string, subject: string, gradeLevel: string, items: AliasSourceItem[]): string {
  const list = items.map((it, i) => `${i + 1}. [${it.itemKind}] "${it.itemName}"${it.description ? ` — ${it.description}` : ""}`).join("\n");
  return [ALIAS_SYSTEM_PROMPT_HEADER, "", `UNIT: ${unitTitle} (${subject}, ${gradeLevel})`, "", "ITEMS:", list].join("\n");
}

export interface AliasCandidate {
  itemKind: "CONCEPT" | "HINT";
  itemName: string;
  canonicalLabel: string;
  aliasEn: string | null;
  aliasAr: string | null;
}

export type AliasValidationResult =
  | { ok: true; accepted: AliasCandidate[] }
  | { ok: false; code: "UNPARSEABLE_JSON" | "NOT_AN_ARRAY" | "HALLUCINATED_ITEM" | "MALFORMED_ITEM"; detail: string };

/**
 * Post-validation heuristic (documented limits below):
 *  1. Every itemName must match, VERBATIM, a real notes.concepts[].name /
 *     notes.topicHints[].topicTitle for that itemKind. One bad item rejects
 *     the WHOLE response — same "one bad item taints everything" philosophy
 *     as validateMapperResponse.
 *  2. Structural fabrication guard (crude but real, and honestly limited):
 *     an alias is rejected if it is empty/whitespace, or if its length
 *     exceeds a generous multiple of the source item's own name length —
 *     this can catch a model that appends unrelated invented elaboration
 *     onto a short item (e.g. turning a 2-word concept into a full sentence
 *     of new claims), but it CANNOT catch a short, plausible-length alias
 *     that quietly introduces a small wrong nuance, nor can it verify actual
 *     translation FIDELITY (that a Arabic/English pair genuinely mean the
 *     same thing) — this heuristic checks length/shape, not semantic
 *     correctness. It also cannot catch a model restating a different, but
 *     similarly-short, real concept's meaning under the wrong itemName
 *     (a "swap" hallucination) as long as the swapped name is itself real —
 *     that class of error is out of scope for an automated check here and
 *     is the reason aliases are NEVER trusted as evidence on their own: a
 *     match via alias always resolves back to the original item's real
 *     content, so even an inaccurate alias can only ever mislead the LOOKUP,
 *     never inject false content into a persisted grounding slice.
 */
const MAX_ALIAS_LENGTH_MULTIPLIER = 6;
const MAX_ALIAS_LENGTH_FLOOR = 40;
const ALIAS_MAX_OUTPUT_TOKENS = 600;
const ALIAS_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS = 1200;

/**
 * Strips a single leading/trailing Markdown code fence (```json ... ``` or
 * plain ``` ... ```) if present, otherwise returns the input unchanged. This
 * service's response is a JSON ARRAY, which OpenAI's `json_object` response
 * mode cannot represent (that mode requires a top-level object) — the mapper
 * and refinement services avoid this exact issue by using `json_object`
 * mode, which isn't available here. Stripping fences defensively at the
 * parse boundary is the general fix: it only ever removes wrapping
 * whitespace/backticks, never touches the JSON content itself, so a
 * genuinely malformed payload still fails JSON.parse and is still rejected.
 */
function stripMarkdownCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

export function validateAliasResponse(raw: string, notes: GroundingNotes): AliasValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripMarkdownCodeFence(raw));
  } catch {
    return { ok: false, code: "UNPARSEABLE_JSON", detail: `Could not parse JSON: ${raw.slice(0, 200)}` };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, code: "NOT_AN_ARRAY", detail: "Response was not a JSON array." };
  }

  const conceptNames = new Set(notes.concepts.map((c) => c.name));
  const hintTitles = new Set((notes.topicHints ?? []).map((h) => h.topicTitle));

  const accepted: AliasCandidate[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, code: "MALFORMED_ITEM", detail: `Non-object item: ${JSON.stringify(raw)}` };
    }
    const item = raw as Record<string, unknown>;
    const itemKind = item.itemKind;
    const itemName = item.itemName;
    const canonicalLabel = item.canonicalLabel;
    const aliasEn = item.aliasEn ?? null;
    const aliasAr = item.aliasAr ?? null;

    if ((itemKind !== "CONCEPT" && itemKind !== "HINT") || typeof itemName !== "string" || typeof canonicalLabel !== "string") {
      return { ok: false, code: "MALFORMED_ITEM", detail: `Missing/invalid required fields: ${JSON.stringify(item)}` };
    }
    if (aliasEn !== null && typeof aliasEn !== "string") return { ok: false, code: "MALFORMED_ITEM", detail: "aliasEn must be string or null." };
    if (aliasAr !== null && typeof aliasAr !== "string") return { ok: false, code: "MALFORMED_ITEM", detail: "aliasAr must be string or null." };

    const realPool = itemKind === "CONCEPT" ? conceptNames : hintTitles;
    if (!realPool.has(itemName)) {
      return { ok: false, code: "HALLUCINATED_ITEM", detail: `"${itemName}" (${itemKind}) is not verbatim present in the Unit's current grounding.` };
    }

    const en = typeof aliasEn === "string" ? aliasEn.trim() : null;
    const ar = typeof aliasAr === "string" ? aliasAr.trim() : null;
    if (!en && !ar) continue; // no usable alias offered for this item — silently skip, not an error
    const sourceLen = itemName.length;
    const maxLen = Math.max(MAX_ALIAS_LENGTH_FLOOR, sourceLen * MAX_ALIAS_LENGTH_MULTIPLIER);
    if ((en && (en.length === 0 || en.length > maxLen)) || (ar && (ar.length === 0 || ar.length > maxLen))) {
      return { ok: false, code: "MALFORMED_ITEM", detail: `Alias implausibly long relative to source item "${itemName}" — rejected as likely fabricated elaboration.` };
    }

    accepted.push({ itemKind, itemName, canonicalLabel, aliasEn: en, aliasAr: ar });
  }

  return { ok: true, accepted };
}

@Injectable()
export class GroundingConceptAliasService {
  private readonly logger = new Logger(GroundingConceptAliasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: AIProviderFactory,
    private readonly usageService: AIUsageService,
  ) {}

  /** True if this Unit already has alias rows for the CURRENT ALIAS_GENERATION_VERSION. */
  async hasCurrentAliases(unitId: string): Promise<boolean> {
    const count = await this.prisma.client.groundingConceptAlias.count({
      where: { unitId, generationVersion: ALIAS_GENERATION_VERSION },
    });
    return count > 0;
  }

  /**
   * One bounded AI call for the WHOLE Unit's concepts+hints, batched. Persists
   * accepted GroundingConceptAlias rows on success. Never invoked for a Unit
   * outside the explicit scoped-backfill target list (see
   * topic-grounding-scoped-backfill.ts) — this method itself takes a unitId
   * directly and does no broad enumeration of its own.
   */
  async generateAliasesForUnit(unitId: string): Promise<{ outcome: "GENERATED"; count: number } | { outcome: "NOT_GROUNDED" | "NO_ITEMS" | "REJECTED" | "BUDGET_UNAVAILABLE"; reason: string }> {
    const unit = await this.prisma.client.unit.findUnique({
      where: { id: unitId },
      select: { id: true, groundingNotesJson: true, groundingVersion: true, groundingSourceFingerprint: true },
    });
    if (!unit || unit.groundingVersion === null || unit.groundingSourceFingerprint === null || !unit.groundingNotesJson) {
      return { outcome: "NOT_GROUNDED", reason: `Unit ${unitId} has no completed grounding.` };
    }
    const notes = unit.groundingNotesJson as unknown as GroundingNotes;
    const items = buildAliasSourceItems(notes);
    if (items.length === 0) return { outcome: "NO_ITEMS", reason: "Unit has no concepts or hints to alias." };

    const systemPrompt = buildAliasPrompt(notes.unitTitle, notes.subject, notes.gradeLevel, items);
    const userMessage = "Produce the bilingual alias JSON array now.";

    const { provider, providerKey, model } = await this.providerFactory.getActiveProvider();
    const estimatedUsd = await this.usageService.estimateMaxChatCostUsd({ providerKey, inputText: systemPrompt + userMessage, maxOutputTokens: ALIAS_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS });
    const reserveResult = await this.usageService.reserveBudget(CONTENT_AUTHORING_ACTOR_ID, estimatedUsd);
    if (!reserveResult.ok) {
      return { outcome: "BUDGET_UNAVAILABLE", reason: `Budget unavailable (${reserveResult.reason}).` };
    }

    let result: Awaited<ReturnType<typeof provider.generate>>;
    try {
      result = await provider.generate({ systemPrompt, messages: [{ role: "user", content: userMessage }], maxOutputTokens: ALIAS_MAX_OUTPUT_TOKENS });
    } catch (err) {
      await this.usageService.releaseBudget(reserveResult.reservationId).catch(() => undefined);
      throw err;
    }

    let validated = validateAliasResponse(result.content, notes);
    if (!validated.ok && validated.code === "UNPARSEABLE_JSON" && result.outputTokens >= ALIAS_MAX_OUTPUT_TOKENS) {
      this.logger.warn(JSON.stringify({ event: "GROUNDING_CONCEPT_ALIAS_TRUNCATION_RETRY", unitId, firstOutputTokens: result.outputTokens, retryMaxOutputTokens: ALIAS_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS }));
      const retry = await provider.generate({ systemPrompt, messages: [{ role: "user", content: userMessage }], maxOutputTokens: ALIAS_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS });
      result = { ...retry, inputTokens: result.inputTokens + retry.inputTokens, outputTokens: result.outputTokens + retry.outputTokens };
      validated = validateAliasResponse(retry.content, notes);
    }

    const rates = await this.providerFactory.getCostRates(providerKey);
    const actualCostUsd = result.inputTokens * rates.costPerInputToken + result.outputTokens * rates.costPerOutputToken;
    await this.prisma.client.aIUsage
      .create({
        data: {
          userId: CONTENT_AUTHORING_ACTOR_ID,
          studentId: null,
          subjectId: null,
          feature: "grounding_concept_alias",
          provider: providerKey,
          model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          creditsUsed: 0,
          costUsd: actualCostUsd,
        },
      })
      .catch((err) => this.logger.warn(`Usage log failed (alias generation still completed): ${err instanceof Error ? err.message : String(err)}`));
    await this.usageService.reconcileBudget(reserveResult.reservationId, actualCostUsd).catch(() => undefined);

    if (!validated.ok) {
      this.logger.warn(JSON.stringify({ event: "GROUNDING_CONCEPT_ALIAS_REJECTED", unitId, code: validated.code, detail: validated.detail }));
      return { outcome: "REJECTED", reason: `${validated.code}: ${validated.detail}` };
    }

    for (const c of validated.accepted) {
      await this.prisma.client.groundingConceptAlias.upsert({
        where: { unitId_itemKind_itemName: { unitId, itemKind: c.itemKind, itemName: c.itemName } },
        create: {
          unitId,
          itemKind: c.itemKind,
          itemName: c.itemName,
          canonicalLabel: c.canonicalLabel,
          aliasEn: c.aliasEn,
          aliasAr: c.aliasAr,
          generationVersion: ALIAS_GENERATION_VERSION,
        },
        update: {
          canonicalLabel: c.canonicalLabel,
          aliasEn: c.aliasEn,
          aliasAr: c.aliasAr,
          generationVersion: ALIAS_GENERATION_VERSION,
        },
      });
    }

    this.logger.log(JSON.stringify({ event: "GROUNDING_CONCEPT_ALIAS_GENERATED", unitId, count: validated.accepted.length, model }));
    return { outcome: "GENERATED", count: validated.accepted.length };
  }
}

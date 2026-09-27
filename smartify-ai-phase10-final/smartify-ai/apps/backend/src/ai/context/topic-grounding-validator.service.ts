import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AIProviderFactory } from "../ai-provider.factory";
import { AIUsageService } from "../usage/ai-usage.service";
import { CONTENT_AUTHORING_ACTOR_ID } from "../content-authoring-actor.const";
import type { GroundingNotes } from "../../interactive-lesson/unit-grounding/unit-grounding.types";
import { TopicGroundingAssignmentService, computeDeterministicAssignment } from "./topic-grounding-assignment.service";
import { identifySingleCandidate, type SingleCandidate } from "./topic-grounding-validator-candidate.util";

/**
 * The bounded SECOND-STAGE validator (2026-09-27) — for the narrow set of
 * Topics where a purely deterministic function (identifySingleCandidate, in
 * topic-grounding-validator-candidate.util.ts) has already found exactly ONE
 * unambiguous unclaimed concept/hint whose name lexically matches the
 * Topic's title, but where the deterministic Steps 1-5 themselves could not
 * resolve it (e.g. the free-form AI mapper hallucinated a near-miss string
 * or returned malformed JSON on a prior run).
 *
 * ---------------------------------------------------------------------------
 * THE MODEL MAY ONLY CONFIRM OR REJECT — NEVER SELECT OR INVENT
 * ---------------------------------------------------------------------------
 * Unlike TopicGroundingMapperService (a closed-set SELECTOR shown the
 * Unit's whole concept/hint list), this service shows the model exactly ONE
 * named candidate and asks a yes/no question: does the evidence genuinely
 * support this Topic being about this candidate? The model has no mechanism
 * to name a different candidate — there is no list to choose from — so the
 * structural guarantee against inventing/picking a different item lives in
 * the PROMPT SHAPE, not just in post-validation. Any response that isn't
 * unambiguously "SUPPORTED" is treated as NOT_SUPPORTED (fail-safe).
 *
 * ---------------------------------------------------------------------------
 * NEVER REACHABLE FROM A STUDENT-FACING RUNTIME REQUEST PATH
 * ---------------------------------------------------------------------------
 * Deliberately NOT registered in AIModule (or any other module a
 * request-handling controller can reach) — mirrors TopicGroundingMapperService
 * exactly (see the comment in ai.module.ts and in topic-grounding-mapper.service.ts).
 * It will be constructed explicitly by a later preparation/backfill script.
 */

/** Bumped whenever this prompt or the validator's behavior changes. */
export const VALIDATOR_PROMPT_VERSION = 1;

const VALIDATOR_SYSTEM_PROMPT_HEADER = `You are a curriculum librarian CONFIRMING whether one already-proposed candidate is genuinely this Topic's content.

You are NOT selecting from a list — there is only ONE candidate below, already chosen by a separate deterministic process. Your only job is to judge whether the evidence shown genuinely supports this Topic being about that ONE candidate. You may NEVER propose a different candidate, invent a new one, or rewrite anything.

Reply with EXACTLY one line, starting with the literal word SUPPORTED or NOT_SUPPORTED (optionally followed by a short reason on the same line). Any other reply, or any ambiguity, will be treated as NOT_SUPPORTED.`;

export interface CandidatePromptInput {
  topicNameEn: string;
  topicOrder: number;
  siblingTopics: { nameEn: string; order: number; claimedNames: string[] }[];
  unitTitle: string;
  subject: string;
  gradeLevel: string;
  candidate: SingleCandidate;
}

/** Builds the narrow confirm/reject prompt for ONE Topic against ONE named candidate only. */
export function buildValidatorPrompt(input: CandidatePromptInput): string {
  const siblings = input.siblingTopics
    .filter((t) => !(t.order === input.topicOrder && t.nameEn === input.topicNameEn))
    .sort((a, b) => a.order - b.order)
    .map((t) => `  ${t.order}. ${t.nameEn}${t.claimedNames.length ? ` (already claims: ${t.claimedNames.join(" ; ")})` : ""}`)
    .join("\n");

  const c = input.candidate;
  const candidateBlock =
    c.kind === "CONCEPT" && c.concept
      ? [`CANDIDATE (concept): ${c.concept.name}`, `  description: ${c.concept.description}`, `  sourcePages: ${c.concept.sourcePages.join(",")}`].join("\n")
      : c.kind === "HINT" && c.hint
        ? [
            `CANDIDATE (topic hint): ${c.hint.topicTitle}`,
            `  relevantConcepts: ${c.hint.relevantConcepts.join(" ; ")}`,
            `  sourcePages: ${(c.hint.sourcePages ?? []).join(",")}`,
          ].join("\n")
        : `CANDIDATE: ${c.name}`;

  return [
    VALIDATOR_SYSTEM_PROMPT_HEADER,
    "",
    `UNIT: ${input.unitTitle} (${input.subject}, ${input.gradeLevel})`,
    "",
    `TOPIC TO CONFIRM: "${input.topicNameEn}" (order ${input.topicOrder})`,
    "",
    `THE UNIT'S OTHER TOPICS (for cross-checking only — never pick from this list):\n${siblings || "  (none)"}`,
    "",
    candidateBlock,
    "",
    "Does the evidence above genuinely support this Topic being about this ONE candidate?",
  ].join("\n");
}

/**
 * Strict response parsing: only a response that, after trimming, STARTS with
 * the literal token SUPPORTED is treated as supported. Everything else —
 * empty, malformed, a different word, an ambiguous qualifier trailing the
 * token — fails safe to NOT_SUPPORTED. This deliberately never fails open.
 */
export function parseValidatorResponse(raw: string): { supported: boolean; reason: string } {
  const trimmed = (raw ?? "").trim();
  if (/^NOT_SUPPORTED\b/.test(trimmed)) {
    return { supported: false, reason: trimmed.replace(/^NOT_SUPPORTED[:\-,]?\s*/, "") || "Model reported NOT_SUPPORTED." };
  }
  if (/^SUPPORTED\b/.test(trimmed)) {
    const rest = trimmed.replace(/^SUPPORTED[:\-,]?\s*/, "");
    // "SUPPORTED, but actually not sure" style trailing hedges are ambiguous —
    // only accept a clean SUPPORTED token with, at most, a short reason that
    // does not itself contradict the verdict.
    if (/\b(not sure|unsure|maybe|unclear|actually not|but not)\b/i.test(rest)) {
      return { supported: false, reason: `Ambiguous hedge following SUPPORTED token: "${trimmed}"` };
    }
    return { supported: true, reason: rest || "Model reported SUPPORTED." };
  }
  return { supported: false, reason: `Response did not start with SUPPORTED or NOT_SUPPORTED: "${trimmed.slice(0, 200)}"` };
}

export type ValidatorOutcome =
  | { outcome: "SKIPPED_DETERMINISTIC"; reason: string }
  | { outcome: "NOT_GROUNDED"; reason: string }
  | { outcome: "SKIPPED_ALREADY_READY"; reason: string }
  | { outcome: "SKIPPED_NO_SINGLE_CANDIDATE"; reason: string }
  | { outcome: "READY"; matchedConceptNames: string[]; matchedHintTitles: string[] | null; model: string }
  | { outcome: "BLOCKED"; reason: string };

@Injectable()
export class TopicGroundingValidatorService {
  private readonly logger = new Logger(TopicGroundingValidatorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: AIProviderFactory,
    private readonly usageService: AIUsageService,
    private readonly assignmentService: TopicGroundingAssignmentService,
  ) {}

  /**
   * One bounded AI call for ONE Topic, only ever reached after: the Unit is
   * grounded, no existing valid READY assignment already covers this Topic,
   * the deterministic Steps 1-5 decline it, AND the pure candidate-identification
   * function finds exactly one unambiguous candidate. Always persists an
   * outcome when a provider call is made: READY on SUPPORTED, BLOCKED
   * otherwise.
   */
  async validateCandidate(topicId: string): Promise<ValidatorOutcome> {
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
      return { outcome: "NOT_GROUNDED", reason: `Unit ${unit.id} has no completed grounding — nothing to validate against.` };
    }

    const existing = topic.groundingAssignment;
    if (
      existing &&
      existing.status === "READY" &&
      existing.unitGroundingVersion === unit.groundingVersion &&
      existing.unitSourceFingerprint === unit.groundingSourceFingerprint
    ) {
      return { outcome: "SKIPPED_ALREADY_READY", reason: `Topic ${topicId} already has a valid READY assignment.` };
    }

    const notes = unit.groundingNotesJson as unknown as GroundingNotes;
    const siblings = unit.topics.map((t) => ({ id: t.id, nameEn: t.nameEn, order: t.order }));
    const thisTopic = { id: topic.id, nameEn: topic.nameEn, order: topic.order };

    const deterministic = computeDeterministicAssignment(notes, thisTopic, siblings);
    if (deterministic) {
      return { outcome: "SKIPPED_DETERMINISTIC", reason: `Deterministic Step resolved this Topic as ${deterministic.method} — the validator must not override it.` };
    }

    const candidate = identifySingleCandidate(notes, thisTopic, siblings);
    if (!candidate) {
      return { outcome: "SKIPPED_NO_SINGLE_CANDIDATE", reason: "No single unambiguous unclaimed candidate — the validator never guesses among several." };
    }

    const siblingsForPrompt = siblings.map((s) => {
      if (s.id === topic.id) return { ...s, claimedNames: [] as string[] };
      const sibAssignment = computeDeterministicAssignment(notes, s, siblings);
      return { ...s, claimedNames: sibAssignment ? [...sibAssignment.matchedConceptNames, ...(sibAssignment.matchedHintTitles ?? [])] : [] };
    });

    const systemPrompt = buildValidatorPrompt({
      topicNameEn: topic.nameEn,
      topicOrder: topic.order,
      siblingTopics: siblingsForPrompt,
      unitTitle: notes.unitTitle,
      subject: notes.subject,
      gradeLevel: notes.gradeLevel,
      candidate,
    });
    const userMessage = "Confirm or reject this ONE candidate now.";

    const { provider, providerKey, model } = await this.providerFactory.getActiveProvider();
    const estimatedUsd = await this.usageService.estimateMaxChatCostUsd({ providerKey, inputText: systemPrompt + userMessage });
    const reserveResult = await this.usageService.reserveBudget(CONTENT_AUTHORING_ACTOR_ID, estimatedUsd);
    if (!reserveResult.ok) {
      return { outcome: "BLOCKED", reason: `Budget unavailable (${reserveResult.reason}) — nothing persisted, safe to retry later.` };
    }

    let result: Awaited<ReturnType<typeof provider.generate>>;
    try {
      result = await provider.generate({
        systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      });
    } catch (err) {
      await this.usageService.releaseBudget(reserveResult.reservationId).catch(() => undefined);
      throw err;
    }

    const actualCostUsd = await this.logUsage(providerKey, model, result.inputTokens, result.outputTokens);
    await this.usageService.reconcileBudget(reserveResult.reservationId, actualCostUsd).catch(() => undefined);

    const parsed = parseValidatorResponse(result.content);

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
        mapperPromptVersion: VALIDATOR_PROMPT_VERSION,
        reason: `[VALIDATOR] ${reason}`,
      });

    if (!parsed.supported) {
      this.logger.warn(JSON.stringify({ event: "TOPIC_GROUNDING_VALIDATOR_NOT_SUPPORTED", topicId, unitId: unit.id, candidate: candidate.name, model }));
      await persist("BLOCKED", [], null, parsed.reason);
      return { outcome: "BLOCKED", reason: parsed.reason };
    }

    const matchedConceptNames = candidate.kind === "CONCEPT" ? [candidate.name] : [];
    const matchedHintTitles = candidate.kind === "HINT" ? [candidate.name] : null;
    await persist("READY", matchedConceptNames, matchedHintTitles, parsed.reason);
    this.logger.log(
      JSON.stringify({ event: "TOPIC_GROUNDING_VALIDATOR_ASSIGNED", topicId, unitId: unit.id, candidate: candidate.name, model, validatorPromptVersion: VALIDATOR_PROMPT_VERSION }),
    );
    return { outcome: "READY", matchedConceptNames, matchedHintTitles, model };
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
          feature: "topic_grounding_validator",
          provider: providerKey,
          model,
          inputTokens,
          outputTokens,
          creditsUsed: 0,
          costUsd,
        },
      })
      .catch((err) => this.logger.warn(`Usage log failed (validation still completed): ${err instanceof Error ? err.message : String(err)}`));
    return costUsd;
  }
}

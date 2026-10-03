import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AIProviderFactory } from "../../ai/ai-provider.factory";
import { AIContextBuilderService } from "../../ai/context/ai-context-builder.service";
import { AIUsageService } from "../../ai/usage/ai-usage.service";
import { validateQuestionDraft } from "./question-draft-validator";
import { QuestionPublishService } from "./question-publish.service";
import { LessonDraftGeneratorService } from "../../interactive-lesson/lesson-draft-generator/lesson-draft-generator.service";
import type { QuestionGenerationInput, ResolvedTopicContext } from "./question-draft.types";
import type { GroundingNotes } from "../../interactive-lesson/unit-grounding/unit-grounding.types";
import { classifyContentProvenance, evaluateTopicGroundingGate, questionServabilityByTopic, QUESTION_PROVENANCE_SELECT, TOPIC_GATE_INCLUDE, UNIT_GATE_SELECT, type TopicGroundingGate } from "../../ai/context/topic-content-provenance.util";
import { checkGroundingConsistency } from "../../ai/context/grounding-consistency-validator";
import { CONTENT_AUTHORING_ACTOR_ID } from "../../ai/content-authoring-actor.const";

const AUTO_BATCH_MAX_ATTEMPTS = 2;

// The provider's default (600) is sized for a single question or lesson-
// step-plan response. A bilingual question batch needs more room than that
// no matter how small `count` is, so the FIRST attempt always uses this
// fixed budget — never scaled by `count` (that "proactively size every
// attempt" approach was tried and explicitly rejected: it grows unbounded
// with `count` and masks the real signal, which is whether a *specific*
// response was actually truncated). Only a detected truncation on attempt 1
// escalates to AUTO_BATCH_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS, exactly once.
const AUTO_BATCH_MAX_OUTPUT_TOKENS = 4000;

// Used for exactly one retry, only when attempt 1's failure looks like it
// was caused by hitting the output-token ceiling (invalid/truncated JSON) —
// never for a normal successful attempt and never for an unrelated
// validation failure (e.g. valid JSON that fails a business-rule check).
const AUTO_BATCH_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS = 6000;

// Practice serves 8 per session, Mock Exam up to 20 (see PracticeService/
// QuizzesService's own requestedCount constants) — 8 gives Practice a full
// pool immediately and Quiz/Mock Exam a real (if partial) one, without a
// single lazy trigger paying for 20 questions before anyone asks for that many.
const DEFAULT_POOL_TARGET = 8;

// One initial attempt + one corrective retry if validation fails — never an
// uncontrolled loop, matching LessonDraftGeneratorService's exact bound.
const MAX_ATTEMPTS = 2;

export class QuestionDraftGenerationError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
    readonly lastErrors: string[],
  ) {
    super(message);
    this.name = "QuestionDraftGenerationError";
  }
}

/**
 * Phase 10E: SCOPE NOTE — this service is architecture for the NEXT phase.
 * It is fully injectable/testable and reuses the exact same building
 * blocks the Interactive Lesson draft pipeline already uses
 * (AIProviderFactory, AIContextBuilderService, AIUsageService's budget
 * check) — but nothing in Phase 10E ever calls generateDraft() against a
 * real AI provider. Every test for this service uses a fully mocked
 * provider; zero network calls, zero real OpenAI usage, zero drafts
 * generated in this phase.
 *
 * Curriculum Topic + learning focus + Grade/Subject/Language context ->
 * AI Content Generator -> validated (structural only — see
 * validateQuestionDraft's requireReviewedContent: false) QuestionDraft row
 * -> (separately, later) human bilingual review -> approve -> publish.
 */
/** Exact-duplicate key for a Question prompt: case and whitespace only — never fuzzy. */
function normalizePrompt(prompt: string | undefined | null): string {
  return (prompt ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * True when `content` looks like it was cut off mid-response rather than
 * being deliberately malformed — the signature of hitting maxOutputTokens:
 * a non-empty string that JSON.parse already rejected, and which doesn't
 * even end with a closing `}` or `]`. Used ONLY to decide whether to spend
 * the single bounded retry with a higher maxOutputTokens; never used to
 * accept the JSON (validation stays exactly as strict as before).
 */
function looksLikeTruncatedJson(content: string | null | undefined): boolean {
  if (!content) return true;
  const trimmed = content.trim();
  if (!trimmed) return true;
  const lastChar = trimmed[trimmed.length - 1];
  return lastChar !== "}" && lastChar !== "]";
}

@Injectable()
export class QuestionDraftGeneratorService {
  private readonly logger = new Logger(QuestionDraftGeneratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: AIProviderFactory,
    private readonly contextBuilder: AIContextBuilderService,
    private readonly usageService: AIUsageService,
    private readonly publisher: QuestionPublishService,
    private readonly lessonGenerator: LessonDraftGeneratorService,
  ) {}

  /**
   * Resolves curriculum/grade/subject/unit/topic names LIVE from the
   * existing Topic -> Unit -> Subject -> Grade -> Curriculum relations —
   * never hand-typed. Mirrors LessonDraftGeneratorService.resolveUnitContext.
   */
  /**
   * The single authoritative grounding read for question authoring
   * (2026-09-27) — see LessonDraftGeneratorService.readAssignedGroundingOutcome.
   */
  // 2026-10-03: the shared READY_CURRENT_NON_EMPTY gate
  // (topic-content-provenance.util.ts) — also yields the provenance every
  // generated draft is stamped with.
  private async readGroundingGate(topicId: string): Promise<TopicGroundingGate> {
    const row = await this.prisma.client.topic.findUnique({
      where: { id: topicId },
      select: { ...TOPIC_GATE_INCLUDE, unit: { select: UNIT_GATE_SELECT } },
    });
    if (!row) return { state: "UNAVAILABLE", reason: "MISSING" };
    return evaluateTopicGroundingGate(row as any);
  }

  /** English prompts of this Topic's published, non-placeholder Questions that are CURRENT under `gate` — the accepted pool for a current-pool completion. */
  private async currentPoolPrompts(topicId: string, gate: Extract<TopicGroundingGate, { state: "READY" }>): Promise<string[]> {
    const rows = await this.prisma.client.question.findMany({
      where: { topicId, isPlaceholder: false },
      select: { topicId: true, isPlaceholder: true, promptEn: true, ...QUESTION_PROVENANCE_SELECT },
    });
    return rows
      .filter((q) => q.topicId === topicId && !q.isPlaceholder && classifyContentProvenance(q, gate.provenance) === "CURRENT")
      .map((q) => q.promptEn);
  }

  async resolveTopicContext(topicId: string): Promise<ResolvedTopicContext & { topicId: string; isPlaceholder: boolean }> {
    const topic = await this.prisma.client.topic.findUnique({
      where: { id: topicId },
      include: {
        unit: { include: { subject: { include: { grade: { include: { curriculum: true } } } }, _count: { select: { topics: true } } } },
        lessons: { select: { isPlaceholder: true, objectives: { select: { descriptionEn: true } } } },
      },
    });
    if (!topic) {
      throw new NotFoundException(`Topic ${topicId} not found — cannot resolve curriculum context.`);
    }
    return {
      topicId: topic.id,
      curriculumNameEn: topic.unit.subject.grade.curriculum.nameEn,
      gradeNameEn: topic.unit.subject.grade.nameEn,
      subjectNameEn: topic.unit.subject.nameEn,
      unitNameEn: topic.unit.nameEn,
      topicNameEn: topic.nameEn,
      isPlaceholder: !topic.lessons.some((l) => !l.isPlaceholder),
      groundingNotesJson: (topic.unit.groundingNotesJson as unknown as GroundingNotes | null) ?? null,
      groundingVersion: topic.unit.groundingVersion ?? null,
      unitTopicCount: topic.unit._count.topics,
      // §7/§9: the Topic's own already-generated lesson objectives —
      // second priority after grounding, ahead of unguided model knowledge,
      // for question generation (this Topic's real lesson always generates
      // before its question pool — see ensurePoolForTopic below).
      lessonObjectives: topic.lessons.flatMap((l) => l.objectives.map((o) => o.descriptionEn)),
    };
  }

  async generateDraft(input: QuestionGenerationInput, requestingUserId: string) {
    await this.usageService.assertWithinBudget(requestingUserId);

    const topicContext = await this.resolveTopicContext(input.targetTopicId);

    let lastErrors: string[] = [];
    let callsMade = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const systemPrompt = this.contextBuilder.buildQuestionDraftGenerationPrompt(
        {
          curriculumNameEn: topicContext.curriculumNameEn,
          gradeNameEn: topicContext.gradeNameEn,
          subjectNameEn: topicContext.subjectNameEn,
          unitNameEn: topicContext.unitNameEn,
          topicNameEn: topicContext.topicNameEn,
          learningFocus: input.learningFocus,
          difficulty: input.difficulty,
          studentAgeRange: input.studentAgeRange,
        },
        attempt > 1 ? lastErrors : undefined,
      );

      const { provider, providerKey, model } = await this.providerFactory.getActiveProvider();

      // Phase 9.4C: atomic USD reservation per attempt (this loop makes
      // one real, billable provider call per iteration — logUsage below
      // already writes a separate AIUsage row for EVERY attempt, so the
      // budget reservation must also be per-attempt, not just once for
      // the whole generateDraft call).
      const estimatedUsd = await this.usageService.estimateMaxChatCostUsd({
        providerKey,
        inputText: systemPrompt + "Generate the question draft now.",
      });
      const reserveResult = await this.usageService.reserveBudget(requestingUserId, estimatedUsd);
      if (!reserveResult.ok) {
        throw new ServiceUnavailableException(
          reserveResult.reason === "misconfigured"
            ? "AI content generation is temporarily unavailable. Please try again later."
            : "AI content generation is temporarily unavailable due to daily usage limits. Please try again later.",
        );
      }
      const budgetReservationId = reserveResult.reservationId;

      let result: Awaited<ReturnType<typeof provider.generate>>;
      try {
        result = await provider.generate({
          systemPrompt,
          messages: [{ role: "user", content: "Generate the question draft now." }],
          responseFormat: "json_object",
        });
      } catch (err) {
        await this.usageService.releaseBudget(budgetReservationId).catch(() => undefined);
        throw err;
      }
      callsMade++;

      const actualCostUsd = await this.logUsage(requestingUserId, providerKey, model, result.inputTokens, result.outputTokens);
      await this.usageService.reconcileBudget(budgetReservationId, actualCostUsd).catch(() => undefined);

      let parsed: unknown;
      try {
        parsed = JSON.parse(result.content);
      } catch {
        lastErrors = ["Response was not valid JSON."];
        this.logger.warn(`Question draft generation attempt ${attempt} produced invalid JSON.`);
        continue;
      }

      // Structural validation only — requireReviewedContent: false, since
      // no human has reviewed anything yet and the AI was never asked for
      // Arabic. topicIsPlaceholder was already resolved above so the same
      // rule applies here as at approve() time.
      const validation = validateQuestionDraft(
        { ...(parsed as Record<string, unknown>), topicId: input.targetTopicId },
        { topicExists: true, topicIsPlaceholder: topicContext.isPlaceholder, requireReviewedContent: false },
      );

      if (validation.valid) {
        const p = parsed as Record<string, unknown>;
        const draft = await this.prisma.client.questionDraft.create({
          data: {
            topicId: input.targetTopicId,
            type: p.type as any,
            difficulty: p.difficulty as any,
            promptEn: p.promptEn as string,
            promptAr: null, // never trust AI-proposed Arabic — human review only
            optionsJson: (p.optionsJson ?? null) as any,
            correctAnswerJson: p.correctAnswerJson as any,
            explanationEn: (p.explanationEn as string | undefined) ?? null,
            explanationAr: null,
            status: "pending_review",
            isAiGenerated: true,
            aiProvider: providerKey,
            aiModel: model,
          },
        });
        return { draft, attempts: attempt, callsMade };
      }

      lastErrors = validation.errors;
      this.logger.warn(`Question draft generation attempt ${attempt} failed validation: ${validation.errors.join("; ")}`);
    }

    // Deliberately never persists anything on failure — an invalid draft
    // must never exist as "pending_review" (or any other) row.
    throw new QuestionDraftGenerationError(
      `Question draft generation failed validation after ${MAX_ATTEMPTS} attempt(s).`,
      MAX_ATTEMPTS,
      lastErrors,
    );
  }

  /**
   * Launch-speed lazy-generation path (2026-09-19): generates a POOL of
   * bilingual QuestionDraft rows for a Topic in one AI call, for
   * InteractiveLessonService/PracticeService/QuizzesService to top up a
   * Topic's question pool on demand — no `learningFocus` input (the AI
   * picks a spread of sub-skills itself) and the AI supplies promptAr/
   * explanationAr directly, unlike generateDraft() above. Still persists
   * normal QuestionDraft rows (status "pending_review") for an audit
   * trail — the caller (via QuestionPublishService.autoPublish()) is
   * what actually skips the human-review gate, not this method. Requires
   * the Topic to already have a non-placeholder Lesson (same rule
   * validateQuestionDraft/approve() already enforce for the human
   * pipeline) — generate the lesson first.
   */
  async generateAutoQuestionBatch(
    topicId: string,
    count: number,
    requestingUserId: string,
    // ADMIN-ONLY staged generation (staged-assignment-repair.ts): an explicit
    // READY gate for a CANDIDATE assignment not yet live, plus the staged
    // lesson's objectives in place of the live Lesson's. Validation, budget
    // and accounting are unchanged. Never passed by any student or lazy path.
    //
    // `acceptedPoolPrompts` (staged completion only): the English prompts of
    // the Questions ALREADY accepted into this same staged replacement pool
    // (same Topic, same candidate provenance, already individually validated —
    // the caller guarantees this). The grounding-consistency rule then judges
    // the FINAL candidate pool (accepted + this batch), so a batch boundary
    // cannot change whether identical final content passes. Omitted, the rule
    // judges this batch alone exactly as before.
    staged?: { gate: Extract<TopicGroundingGate, { state: "READY" }>; lessonObjectives?: string[]; acceptedPoolPrompts?: string[] },
    // ADMIN-ONLY normal regeneration (regenerate-topic-content.ts, 2026-10-03):
    // the same accumulated final-pool semantics as a staged completion, where
    // the accepted pool is this Topic's LIVE published CURRENT Questions. The
    // pool is read HERE, under the very gate this batch is generated against —
    // never supplied by the caller — so only exact-provenance (same Topic,
    // source and assignment fingerprint), non-placeholder Question rows can
    // contribute; LEGACY, MISMATCH, foreign and unpublished rows never do.
    // Never passed by any student or lazy path.
    completion?: { againstCurrentPool: true },
  ) {
    if (staged && completion) throw new Error("generateAutoQuestionBatch: staged and current-pool completion are mutually exclusive");
    // 2026-10-03 Wave B runtime safety: READY_CURRENT_NON_EMPTY is REQUIRED —
    // checked before any budget check, provider call or write. There is no
    // title-only fallback: a missing/stale/BLOCKED/EMPTY assignment means zero
    // provider calls, zero QuestionDraft rows and zero Question rows.
    const gate: TopicGroundingGate = staged?.gate ?? (await this.readGroundingGate(topicId));
    if (gate.state !== "READY") {
      this.logger.warn(`TEXTBOOK_TOPIC_GENERATION_BLOCKED topicId=${topicId} kind=questions reason=assignment-${gate.reason.toLowerCase()}`);
      throw new ServiceUnavailableException("Questions are not available for this topic yet.");
    }
    const groundingSlice = gate.slice;
    const provenance = gate.provenance;
    const acceptedPoolPrompts = staged?.acceptedPoolPrompts ?? (completion?.againstCurrentPool ? await this.currentPoolPrompts(topicId, gate) : []);
    // Exact-duplicate guard, only when a pool context is supplied: a candidate
    // repeating an accepted Question (or an earlier candidate) adds nothing to
    // the pool and must not count toward it.
    const poolContext = !!(staged?.acceptedPoolPrompts || completion?.againstCurrentPool);
    await this.usageService.assertWithinBudget(requestingUserId);

    const topicContext = await this.resolveTopicContext(topicId);
    // A staged run's lesson is itself staged and installed in the same atomic
    // transaction as these Questions, so the live-Lesson requirement does not
    // apply to it (staged-assignment-repair.ts).
    if (topicContext.isPlaceholder && !staged) {
      throw new ServiceUnavailableException("This topic has no real lesson yet — generate the lesson before questions.");
    }

    // 2026-09-27: same authoritative source as generateAutoDraft — the Topic's
    // PERSISTED TopicGroundingAssignment, never a fresh title-based inference
    // and never a live mapper call (gated above).
    this.logger.log(`GROUNDED_TOPIC_GENERATION_STARTED topicId=${topicId} kind=questions`);

    let lastErrors: string[] = [];
    let callsMade = 0;
    // Fixed budget for every normal attempt. Only bumped, and only for the
    // single next attempt, when the previous attempt's failure was
    // specifically a truncation/invalid-JSON signature — see
    // looksLikeTruncatedJson(). Never scaled by `count` and never bumped
    // for a normal success or for an unrelated validation failure.
    let nextMaxOutputTokens = AUTO_BATCH_MAX_OUTPUT_TOKENS;
    let truncationRetryUsed = false;

    for (let attempt = 1; attempt <= AUTO_BATCH_MAX_ATTEMPTS; attempt++) {
      const maxOutputTokensForThisAttempt = nextMaxOutputTokens;
      // Reset back to the fixed default unless this attempt's own failure
      // re-arms the truncation retry below — prevents the bump from ever
      // silently carrying forward into an unrelated later attempt.
      nextMaxOutputTokens = AUTO_BATCH_MAX_OUTPUT_TOKENS;
      const systemPrompt = this.contextBuilder.buildAutoQuestionBatchGenerationPrompt(
        {
          curriculumNameEn: topicContext.curriculumNameEn,
          gradeNameEn: topicContext.gradeNameEn,
          subjectNameEn: topicContext.subjectNameEn,
          unitNameEn: topicContext.unitNameEn,
          topicNameEn: topicContext.topicNameEn,
          studentAgeRange: "6-12", // pool is shared across every student who reaches this topic, not generated per-student — a broad primary-school range, not one child's exact age
        },
        count,
        attempt > 1 ? lastErrors : undefined,
        groundingSlice,
        staged?.lessonObjectives ?? topicContext.lessonObjectives,
      );

      const { provider, providerKey, model } = await this.providerFactory.getActiveProvider();

      const estimatedUsd = await this.usageService.estimateMaxChatCostUsd({
        providerKey,
        inputText: systemPrompt + "Generate the question batch now.",
      });
      const reserveResult = await this.usageService.reserveBudget(requestingUserId, estimatedUsd);
      if (!reserveResult.ok) {
        throw new ServiceUnavailableException(
          reserveResult.reason === "misconfigured"
            ? "AI content generation is temporarily unavailable. Please try again later."
            : "AI content generation is temporarily unavailable due to daily usage limits. Please try again later.",
        );
      }
      const budgetReservationId = reserveResult.reservationId;

      let result: Awaited<ReturnType<typeof provider.generate>>;
      try {
        result = await provider.generate({
          systemPrompt,
          messages: [{ role: "user", content: "Generate the question batch now." }],
          responseFormat: "json_object",
          // The provider's default (600) is sized for a single question or
          // lesson-step-plan response — a bilingual N-question batch needs
          // much more room, or the JSON gets truncated mid-object and
          // every attempt fails as "invalid JSON" (found by hand: an
          // 8-question batch silently truncates at the 600-token default).
          // Fixed per attempt (never scaled by `count`) — only bumped for a
          // single retry when the previous attempt was actually truncated.
          maxOutputTokens: maxOutputTokensForThisAttempt,
        });
      } catch (err) {
        await this.usageService.releaseBudget(budgetReservationId).catch(() => undefined);
        throw err;
      }
      callsMade++;

      const actualCostUsd = await this.logUsage(requestingUserId, providerKey, model, result.inputTokens, result.outputTokens);
      await this.usageService.reconcileBudget(budgetReservationId, actualCostUsd).catch(() => undefined);

      let parsed: unknown;
      try {
        parsed = JSON.parse(result.content);
      } catch {
        lastErrors = ["Response was not valid JSON."];
        // Only escalate maxOutputTokens for the NEXT attempt when this
        // failure looks like a truncation (not just malformed JSON for some
        // other reason), and only once per call — never a third attempt,
        // never for an already-bumped attempt that truncates again.
        if (!truncationRetryUsed && looksLikeTruncatedJson(result.content)) {
          truncationRetryUsed = true;
          nextMaxOutputTokens = AUTO_BATCH_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS;
          this.logger.warn(
            `Auto question batch generation attempt ${attempt} produced truncated/invalid JSON — retrying once with a higher maxOutputTokens.`,
          );
        } else {
          this.logger.warn(`Auto question batch generation attempt ${attempt} produced invalid JSON.`);
        }
        continue;
      }

      const rawQuestions = (parsed as Record<string, unknown>)?.questions;
      if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
        lastErrors = ["Missing or empty questions array."];
        this.logger.warn(`Auto question batch generation attempt ${attempt}: ${lastErrors[0]}`);
        continue;
      }

      const perItemErrors: string[] = [];
      const validDrafts: Array<Record<string, unknown>> = [];
      const seenPrompts = new Set(acceptedPoolPrompts.map(normalizePrompt));
      rawQuestions.forEach((q, index) => {
        const validation = validateQuestionDraft(
          { ...(q as Record<string, unknown>), topicId },
          { topicExists: true, topicIsPlaceholder: false, requireReviewedContent: true },
        );
        if (!validation.valid) {
          perItemErrors.push(`questions[${index}]: ${validation.errors.join("; ")}`);
        } else if (poolContext && seenPrompts.has(normalizePrompt((q as Record<string, unknown>).promptEn as string))) {
          perItemErrors.push(`questions[${index}]: duplicates a Question already in the pool.`);
        } else {
          if (poolContext) seenPrompts.add(normalizePrompt((q as Record<string, unknown>).promptEn as string));
          validDrafts.push(q as Record<string, unknown>);
        }
      });

      // At least one usable question is enough to persist — a partially
      // invalid batch still adds real value to the pool, unlike a single
      // lesson draft where "mostly right" isn't a coherent thing to keep.
      // 2026-10-03: never persist MORE than requested — a model that returns
      // extra valid items cannot push a Topic's CURRENT pool past its target
      // (the extras' tokens are still logged and reconciled like any call).
      validDrafts.splice(count);
      if (validDrafts.length > 0) {
        // §10: grounding-consistency check on the accepted subset as a
        // whole — for a staged or current-pool completion batch, on the final
        // pool (already-accepted prompts + this batch). Feeds the SAME retry
        // loop as structural validation.
        const consistencyErrors = checkGroundingConsistency(
          [...acceptedPoolPrompts, ...validDrafts.map((q) => q.promptEn as string)],
          groundingSlice,
        );
        if (consistencyErrors.length > 0) {
          lastErrors = consistencyErrors;
          this.logger.warn(`CONTENT_VALIDATION_FAILED topicId=${topicId} kind=questions attempt=${attempt}: ${consistencyErrors.join("; ")}`);
          continue;
        }

        const drafts = [];
        for (const q of validDrafts) {
          drafts.push(
            await this.prisma.client.questionDraft.create({
              data: {
                topicId,
                type: q.type as any,
                difficulty: q.difficulty as any,
                promptEn: q.promptEn as string,
                promptAr: q.promptAr as string,
                optionsJson: (q.optionsJson ?? null) as any,
                correctAnswerJson: q.correctAnswerJson as any,
                explanationEn: (q.explanationEn as string | undefined) ?? null,
                explanationAr: (q.explanationAr as string | undefined) ?? null,
                status: "pending_review",
                isAiGenerated: true,
                aiProvider: providerKey,
                aiModel: model,
                groundingSourceFingerprint: provenance.groundingSourceFingerprint,
                groundingAssignmentFingerprint: provenance.groundingAssignmentFingerprint,
              },
            }),
          );
        }
        this.logger.log(`GROUNDED_TOPIC_GENERATION_COMPLETED topicId=${topicId} kind=questions`);
        return {
          drafts,
          attempts: attempt,
          callsMade,
          rejectedCount: perItemErrors.length,
          generationSource: "TEXTBOOK_GROUNDED" as const,
          provenance,
        };
      }

      lastErrors = perItemErrors.length > 0 ? perItemErrors : ["No valid questions in the batch."];
      this.logger.warn(`Auto question batch generation attempt ${attempt} failed validation: ${lastErrors.join("; ")}`);
    }

    throw new QuestionDraftGenerationError(
      `Auto question batch generation failed validation after ${AUTO_BATCH_MAX_ATTEMPTS} attempt(s).`,
      AUTO_BATCH_MAX_ATTEMPTS,
      lastErrors,
    );
  }

  /**
   * Launch-speed lazy-generation path (2026-09-19): the single entry
   * point InteractiveLessonService/PracticeService/QuizzesService all
   * call. Cheap no-op when the Topic already has enough questions (a
   * plain count query); otherwise generates+auto-publishes the shortfall
   * in one batch call. Never throws — a missing/short question pool
   * degrades to whatever already exists (exactly like Practice/Quiz
   * already tolerate today), it never blocks a student from seeing a
   * lesson or a smaller practice set.
   *
   * A Topic can only receive questions once it has a real (non-
   * placeholder) Lesson (see validateQuestionDraft) — most topics were
   * seeded title-only from a table of contents and reach Practice/Quiz
   * before their Lesson page is ever opened, so this calls
   * LessonDraftGeneratorService.ensureTopicHasLesson() FIRST (a cheap
   * no-op once a lesson exists) rather than assuming one is already
   * there. That single extra AI call, on this specific topic's first
   * request from ANY entry point, is an intentional one-time cost — this
   * IS the lazy-generation trigger for that topic's lesson too, not a
   * fallback for a broken assumption.
   *
   * Budget attribution (2026-09-20 fix): the generated QUESTION POOL is
   * shared, permanently-cached curriculum content — never per-student —
   * so generateAutoQuestionBatch() below is billed to the fixed
   * CONTENT_AUTHORING_ACTOR_ID, not `requestingUserId`. Before this fix,
   * whichever real student happened to be first to reach Practice/Quiz
   * for a topic with an empty pool paid, from their own per-student daily
   * budget, for a batch of questions every future student then reuses for
   * free. `requestingUserId` is still passed to ensureTopicHasLesson()
   * unchanged (it only affects that method's generation-lock ownership
   * bookkeeping — see its own 2026-09-20 fix comment — never AI spend).
   */
  async ensurePoolForTopic(topicId: string, requestingUserId: string, targetCount = DEFAULT_POOL_TARGET): Promise<void> {
    // 2026-10-03 Wave B runtime safety: a Topic that is not
    // READY_CURRENT_NON_EMPTY never triggers lazy lesson OR question
    // generation — zero provider calls, zero writes. Only SERVABLE Questions
    // (topic-content-provenance.util.ts) count toward the pool, so a pool made
    // entirely of MISMATCHED (or, once a Unit is STRICT, LEGACY) Questions is
    // topped up with current ones rather than leaving the student with none.
    const topic = await this.prisma.client.topic.findUnique({
      where: { id: topicId },
      select: { id: true, ...TOPIC_GATE_INCLUDE, unit: { select: UNIT_GATE_SELECT } },
    });
    if (!topic) return;
    if (evaluateTopicGroundingGate(topic as any).state !== "READY") {
      this.logger.log(`QUESTION_POOL_TOPUP_SKIPPED topicId=${topicId} reason=grounding-unavailable`);
      return;
    }
    const pool = await this.prisma.client.question.findMany({ where: { topicId, isPlaceholder: false }, select: { topicId: true, isPlaceholder: true, ...QUESTION_PROVENANCE_SELECT } });
    const existing = pool.filter(questionServabilityByTopic([topic as any], pool)).length;
    if (existing >= targetCount) return;

    try {
      await this.lessonGenerator.ensureTopicHasLesson(topicId, { preferredLang: "ar", studentAgeRange: "6-12" }, requestingUserId);
      const { drafts } = await this.generateAutoQuestionBatch(topicId, targetCount - existing, CONTENT_AUTHORING_ACTOR_ID);
      for (const draft of drafts) {
        await this.publisher.autoPublish(draft.id);
      }
    } catch (err) {
      this.logger.warn(`ensurePoolForTopic(${topicId}) could not top up the question pool: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Returns the computed costUsd so callers can reconcile the matching USD budget reservation to the exact same figure. */
  private async logUsage(userId: string, providerKey: string, model: string, inputTokens: number, outputTokens: number): Promise<number> {
    const rates = await this.providerFactory.getCostRates(providerKey);
    const costUsd = inputTokens * rates.costPerInputToken + outputTokens * rates.costPerOutputToken;
    await this.prisma.client.aIUsage
      .create({
        data: {
          userId,
          studentId: null,
          subjectId: null,
          feature: "question_draft_generation",
          provider: providerKey,
          model,
          inputTokens,
          outputTokens,
          creditsUsed: 0,
          costUsd,
        },
      })
      .catch((err) => this.logger.warn(`Usage log failed (content still generated): ${err instanceof Error ? err.message : String(err)}`));
    return costUsd;
  }
}

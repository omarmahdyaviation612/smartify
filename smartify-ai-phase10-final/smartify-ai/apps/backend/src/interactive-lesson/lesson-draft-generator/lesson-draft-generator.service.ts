import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AIProviderFactory } from "../../ai/ai-provider.factory";
import { AIContextBuilderService } from "../../ai/context/ai-context-builder.service";
import { AIUsageService } from "../../ai/usage/ai-usage.service";
import { validateAutoLessonDraft, validateLessonDraft } from "./lesson-draft-validator";
import { LessonPublishService } from "./lesson-publish.service";
import type { LessonGenerationInput, ResolvedUnitContext } from "./lesson-draft.types";
import { toUnreviewedBilingualObjectives } from "./lesson-objectives.util";
import type { GroundingNotes } from "../unit-grounding/unit-grounding.types";
import { UnitGroundingService } from "../unit-grounding/unit-grounding.service";
import { resolveEffectiveSourceFile } from "../unit-grounding/unit-effective-source.util";
import { evaluateTopicGroundingGate, TOPIC_GATE_INCLUDE, UNIT_GATE_SELECT, type TopicContentProvenance, type TopicGroundingGate } from "../../ai/context/topic-content-provenance.util";
import { checkGroundingConsistency } from "../../ai/context/grounding-consistency-validator";
import { CONTENT_AUTHORING_ACTOR_ID } from "../../ai/content-authoring-actor.const";
import { TopicGroundingAssignmentService } from "../../ai/context/topic-grounding-assignment.service";

// Bumped only when buildAutoLessonGenerationPrompt's grounded-generation
// instructions change in a way that would make previously-generated
// TEXTBOOK_GROUNDED content stale — never touched by ungrounded generation.
export const AUTO_LESSON_GENERATION_PROMPT_VERSION = "auto-lesson-v1";

// One initial attempt + one corrective retry if validation fails — never an
// uncontrolled loop. A retry re-sends the exact validation errors so the
// model fixes only what was wrong, and still costs a normal, budget-checked
// AI call like any other.
const MAX_ATTEMPTS = 2;

// Topic-generation single-flight lock (ensureTopicHasLesson, 2026-09-19) —
// same Postgres CAS pattern as UnitGroundingService.ensureUnitGrounded, one
// tier shorter: a single lesson-draft generation call is a single AI call
// (no multi-chunk vision extraction), so both the stale-lock window and the
// loser's wait budget are tighter.
const TOPIC_LOCK_STALE_AFTER_MS = 3 * 60 * 1000;
const TOPIC_GENERATION_WAIT_TIMEOUT_MS = 20 * 1000;
const TOPIC_GENERATION_WAIT_POLL_INTERVAL_MS = 1_500;

/** Polls `check()` until it returns true or `timeoutMs` elapses. Safe/non-blocking on Node's event loop — a plain setTimeout-based wait, not a library. */
async function pollUntil(check: () => Promise<boolean>, opts: { intervalMs: number; timeoutMs: number }): Promise<boolean> {
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, opts.intervalMs));
  }
  return await check(); // one last check right at the deadline
}

export class LessonDraftGenerationError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
    readonly lastErrors: string[],
  ) {
    super(message);
    this.name = "LessonDraftGenerationError";
  }
}

/**
 * Phase 5 content-generation pipeline: Curriculum Topic + Learning
 * Objectives + Grade/Subject/Language context -> AI Content Generator ->
 * Validated Structured Lesson Draft -> (separately, later) Human Review.
 *
 * Reuses the exact same building blocks the Interactive Lesson engine
 * already uses at runtime (AIProviderFactory, AIContextBuilderService,
 * AIUsageService's budget check) — this is deliberately NOT a parallel
 * content pipeline, just a different prompt/output shape on the same
 * infrastructure. The result is persisted as a LessonDraft row (status
 * "pending_review") — NEVER a real Topic row, so it can never reach a
 * student's dashboard or lesson engine until an explicit, separate publish
 * step (not built in this phase) promotes it.
 */
@Injectable()
export class LessonDraftGeneratorService {
  private readonly logger = new Logger(LessonDraftGeneratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: AIProviderFactory,
    private readonly contextBuilder: AIContextBuilderService,
    private readonly usageService: AIUsageService,
    private readonly publisher: LessonPublishService,
    private readonly unitGrounding: UnitGroundingService,
    private readonly topicGroundingAssignments: TopicGroundingAssignmentService,
  ) {}

  /**
   * Resolves curriculum/grade/subject/unit names LIVE from the existing
   * Unit -> Subject -> Grade -> Curriculum relations — never hand-typed.
   * Phase 5 disclosed this as a fragile manual dependency; this is the
   * Phase 6 fix. Mirrors the exact include chain interactive-lesson.service
   * already uses for `getTopicOrThrow`.
   */
  /**
   * The single authoritative grounding read for lesson authoring (2026-09-27):
   * the Topic's PERSISTED TopicGroundingAssignment, verified against the Unit's
   * current grounding identity, re-filtered against the Unit's CURRENT
   * groundingNotesJson. Never calls selectRelevantGrounding() live, and never
   * the AI mapper.
   */
  // 2026-10-03: now the shared READY_CURRENT_NON_EMPTY gate
  // (topic-content-provenance.util.ts), which also yields the provenance the
  // generated content is stamped with.
  async readGroundingGate(topicId: string): Promise<TopicGroundingGate> {
    const row = await this.prisma.client.topic.findUnique({
      where: { id: topicId },
      select: { ...TOPIC_GATE_INCLUDE, unit: { select: UNIT_GATE_SELECT } },
    });
    if (!row) return { state: "UNAVAILABLE", reason: "MISSING" };
    return evaluateTopicGroundingGate(row as any);
  }

  async resolveUnitContext(unitId: string): Promise<ResolvedUnitContext & { unitId: string; subjectId: string; sourceFile: string | null }> {
    const unit = await this.prisma.client.unit.findUnique({
      where: { id: unitId },
      include: { subject: { include: { grade: { include: { curriculum: true } } } }, _count: { select: { topics: true } } },
    });
    if (!unit) {
      throw new NotFoundException(`Unit ${unitId} not found — cannot resolve curriculum context.`);
    }
    return {
      unitId: unit.id,
      unitTopicCount: unit._count.topics,
      subjectId: unit.subjectId,
      sourceFile: resolveEffectiveSourceFile(unit, unit.subject),
      curriculumNameEn: unit.subject.grade.curriculum.nameEn,
      gradeNameEn: unit.subject.grade.nameEn,
      subjectNameEn: unit.subject.nameEn,
      unitNameEn: unit.nameEn,
      groundingNotesJson: (unit.groundingNotesJson as unknown as GroundingNotes | null) ?? null,
      groundingVersion: unit.groundingVersion ?? null,
    };
  }

  async generateDraft(input: LessonGenerationInput, requestingUserId: string) {
    // Budget is checked once up front, and the provider/usage plumbing
    // below logs every real call regardless of how many attempts it takes
    // (bounded to MAX_ATTEMPTS) — a rejected draft still costs exactly what
    // it actually cost, never hidden or double-counted.
    await this.usageService.assertWithinBudget(requestingUserId);

    // Curriculum/grade/subject/unit names are resolved live from the DB —
    // the caller only ever supplies the NEW topic identity/objectives,
    // which genuinely don't exist yet.
    const unitContext = await this.resolveUnitContext(input.targetUnitId);

    let lastErrors: string[] = [];
    let callsMade = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const systemPrompt = this.contextBuilder.buildLessonDraftGenerationPrompt(
        {
          curriculumNameEn: unitContext.curriculumNameEn,
          gradeNameEn: unitContext.gradeNameEn,
          subjectNameEn: unitContext.subjectNameEn,
          unitNameEn: unitContext.unitNameEn,
          topicNameEn: input.topicNameEn,
          topicNameAr: input.topicNameAr,
          learningObjectives: input.learningObjectives,
          preferredLang: input.preferredLang,
          studentAgeRange: input.studentAgeRange,
        },
        attempt > 1 ? lastErrors : undefined,
      );

      const { provider, providerKey, model } = await this.providerFactory.getActiveProvider();

      // Phase 9.4C: atomic USD reservation per attempt — see the matching
      // comment in QuestionDraftGeneratorService.generateDraft.
      const estimatedUsd = await this.usageService.estimateMaxChatCostUsd({
        providerKey,
        inputText: systemPrompt + "Generate the lesson draft now.",
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
          messages: [{ role: "user", content: "Generate the lesson draft now." }],
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
        this.logger.warn(`Lesson draft generation attempt ${attempt} produced invalid JSON.`);
        continue;
      }

      const validation = validateLessonDraft(parsed, { topicNameEn: input.topicNameEn });
      if (validation.valid && validation.steps) {
        const draft = await this.prisma.client.lessonDraft.create({
          data: {
            targetUnitId: input.targetUnitId,
            topicNameEn: input.topicNameEn,
            topicNameAr: input.topicNameAr,
            learningObjectivesJson: toUnreviewedBilingualObjectives(input.learningObjectives) as any,
            teachingStepsJson: validation.steps as any,
            status: "pending_review",
            aiProvider: providerKey,
            aiModel: model,
          },
        });
        return { draft, attempts: attempt, callsMade };
      }

      lastErrors = validation.errors;
      this.logger.warn(`Lesson draft generation attempt ${attempt} failed validation: ${validation.errors.join("; ")}`);
    }

    // Deliberately never persists anything on failure — an invalid draft
    // must never exist as "pending_review" (or any other) row.
    throw new LessonDraftGenerationError(
      `Lesson draft generation failed validation after ${MAX_ATTEMPTS} attempt(s).`,
      MAX_ATTEMPTS,
      lastErrors,
    );
  }

  /**
   * Launch-speed lazy-generation path (2026-09-18): generates a draft for
   * a topic that was seeded as a bare title (no pre-authored objectives —
   * see buildAutoLessonGenerationPrompt's doc comment). The AI proposes
   * its own bilingual objectives here instead of receiving them as input,
   * unlike generateDraft() above. Still persists a normal LessonDraft row
   * (status "pending_review") for an audit trail — the caller
   * (InteractiveLessonService, via LessonPublishService.autoPublishIntoTopic)
   * is what actually skips the human-review gate for this path, not this
   * method.
   */
  async generateAutoDraft(
    topic: { id: string; nameEn: string; nameAr: string; unitId: string },
    opts: { preferredLang: "ar" | "en"; studentAgeRange: string },
    requestingUserId: string,
    // ADMIN-ONLY staged generation (staged-assignment-repair.ts): generate
    // against an explicitly supplied READY gate — a CANDIDATE assignment not
    // yet live — instead of reading the live one. Never passed by any student
    // or lazy path; omitted, behavior is exactly as before.
    staged?: { gate: Extract<TopicGroundingGate, { state: "READY" }> },
  ) {
    const unitContext = await this.resolveUnitContext(topic.unitId);
    // 2026-09-27: the Topic's grounding slice is no longer re-inferred from its
    // title here. It is read from the PERSISTED TopicGroundingAssignment row
    // decided once by the preparation step, and reconstructed from the Unit's
    // CURRENT groundingNotesJson by the persisted NAMES (see
    // topic-grounding-assignment.util.ts). A missing, stale (identity
    // mismatch) or BLOCKED row yields null and takes exactly the same safe
    // failure path a "no relevant grounding" selection always took — there is
    // no live fallback to title inference and no path to the AI mapper here.
    const gate: TopicGroundingGate = staged?.gate ?? (await this.readGroundingGate(topic.id));
    const groundingSlice = gate.state === "READY" ? gate.slice : null;
    const provenance: TopicContentProvenance | null = gate.state === "READY" ? gate.provenance : null;
    const groundingNotes = unitContext.groundingNotesJson;
    const groundingConceptCount = groundingNotes?.concepts.length ?? 0;
    const selectedConceptCount = groundingSlice?.concepts.length ?? 0;
    const groundingSelectionFailureReason = !groundingNotes
      ? "no-grounding-notes"
      : gate.state === "UNAVAILABLE"
        ? `assignment-${gate.reason.toLowerCase()}`
        : null;
    this.logger.log(JSON.stringify({
      event: "TEXTBOOK_TOPIC_GROUNDING_SELECTION",
      topicId: topic.id,
      topicTitle: topic.nameEn,
      unitId: topic.unitId,
      subjectId: unitContext.subjectId,
      hasGroundingNotes: !!groundingNotes,
      groundingVersion: unitContext.groundingVersion,
      groundingConceptCount,
      selectorMatched: !!groundingSlice,
      selectedConceptCount,
      failureReason: groundingSelectionFailureReason,
    }));
    // READY_CURRENT_NON_EMPTY is required for every Unit with a mapped
    // textbook — checked BEFORE any budget call or provider call, so a
    // blocked Topic costs nothing. Only a Unit with no source file at all keeps
    // the original title-only fallback (0 such Units in production, 2026-10-03).
    if (unitContext.sourceFile && !groundingSlice) {
      this.logger.warn(`TEXTBOOK_TOPIC_GENERATION_BLOCKED topicId=${topic.id} unitId=${topic.unitId} reason=no-relevant-grounding`);
      throw new ServiceUnavailableException("Textbook grounding is unavailable for this topic. Lesson generation is blocked until the textbook can be grounded. Please try again later or contact support.");
    }
    await this.usageService.assertWithinBudget(requestingUserId);
    if (groundingSlice) {
      this.logger.log(`GROUNDED_TOPIC_GENERATION_STARTED topicId=${topic.id} unitId=${topic.unitId}`);
    } else {
      this.logger.log(`UNGROUNDED_TOPIC_GENERATION_FALLBACK topicId=${topic.id} unitId=${topic.unitId}`);
    }

    let lastErrors: string[] = [];
    let callsMade = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const systemPrompt = this.contextBuilder.buildAutoLessonGenerationPrompt(
        {
          curriculumNameEn: unitContext.curriculumNameEn,
          gradeNameEn: unitContext.gradeNameEn,
          subjectNameEn: unitContext.subjectNameEn,
          unitNameEn: unitContext.unitNameEn,
          topicNameEn: topic.nameEn,
          topicNameAr: topic.nameAr,
          preferredLang: opts.preferredLang,
          studentAgeRange: opts.studentAgeRange,
        },
        attempt > 1 ? lastErrors : undefined,
        groundingSlice,
      );

      const { provider, providerKey, model } = await this.providerFactory.getActiveProvider();

      const estimatedUsd = await this.usageService.estimateMaxChatCostUsd({
        providerKey,
        inputText: systemPrompt + "Generate the lesson draft now.",
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
          messages: [{ role: "user", content: "Generate the lesson draft now." }],
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
        this.logger.warn(`Auto lesson draft generation attempt ${attempt} produced invalid JSON.`);
        continue;
      }

      const validation = validateAutoLessonDraft(parsed, { topicNameEn: topic.nameEn });
      if (validation.valid && validation.steps && validation.objectives) {
        // §10: grounding-consistency check — only when grounding was
        // actually supplied; feeds the SAME retry loop as structural
        // validation, never a separate retry budget.
        const consistencyErrors = groundingSlice ? checkGroundingConsistency(validation.steps.map((s) => s.objective), groundingSlice) : [];
        if (consistencyErrors.length > 0) {
          lastErrors = consistencyErrors;
          this.logger.warn(`CONTENT_VALIDATION_FAILED topicId=${topic.id} attempt=${attempt}: ${consistencyErrors.join("; ")}`);
          continue;
        }

        const draft = await this.prisma.client.lessonDraft.create({
          data: {
            targetUnitId: topic.unitId,
            topicNameEn: topic.nameEn,
            topicNameAr: topic.nameAr,
            learningObjectivesJson: validation.objectives as any,
            teachingStepsJson: validation.steps as any,
            status: "pending_review",
            aiProvider: providerKey,
            aiModel: model,
          },
        });
        if (groundingSlice) {
          this.logger.log(`GROUNDED_TOPIC_GENERATION_COMPLETED topicId=${topic.id} unitId=${topic.unitId}`);
        }
        return {
          draft,
          attempts: attempt,
          callsMade,
          generationSource: groundingSlice ? ("TEXTBOOK_GROUNDED" as const) : ("LEGACY_TITLE_ONLY" as const),
          groundingVersionUsed: groundingSlice ? unitContext.groundingVersion ?? null : null,
          generationPromptVersion: AUTO_LESSON_GENERATION_PROMPT_VERSION,
          provenance,
        };
      }

      lastErrors = validation.errors;
      this.logger.warn(`Auto lesson draft generation attempt ${attempt} failed validation: ${validation.errors.join("; ")}`);
    }

    throw new LessonDraftGenerationError(
      `Auto lesson draft generation failed validation after ${MAX_ATTEMPTS} attempt(s).`,
      MAX_ATTEMPTS,
      lastErrors,
    );
  }

  /**
   * Launch-speed lazy-generation path (2026-09-19): the single shared
   * entry point for "this Topic needs real content, whoever's asking" —
   * called both by InteractiveLessonService (when a student opens the
   * Lesson page) AND by QuestionDraftGeneratorService.ensurePoolForTopic
   * (when a student reaches Practice/Quiz for a topic whose Lesson page
   * was never opened first — the common case, since most topics were
   * seeded title-only from a table of contents and Practice/Quiz are
   * independent entry points). Cheap no-op once teachingStepsJson exists.
   *
   * Since 2026-09-19: also the ONLY trigger point for lazy Unit grounding
   * (UnitGroundingService.ensureUnitGrounded) — checked strictly AFTER the
   * Topic-cache hit above (§15's ordering: TOPIC CACHE -> UNIT GROUNDING ->
   * SOURCE PDF), so an already-generated Topic never touches grounding at
   * all, and every subsequent Topic under the same Unit reuses the same
   * groundingNotesJson at zero added cost. generateAutoDraft() blocks
   * mapped textbooks without relevant grounding, including extraction
   * failures and timeouts. Only unmapped Units retain title-only fallback.
   *
   * Budget attribution (2026-09-20 fix): this entire method only ever
   * produces SHARED, permanently-cached curriculum content — never a
   * personalized draft for `requestingUserId`. Both the grounding call
   * above AND the generateAutoDraft() call below are therefore billed to
   * the fixed CONTENT_AUTHORING_ACTOR_ID, never the real student, exactly
   * like the grounding call always was. Before this fix, generateAutoDraft
   * was billed to `requestingUserId` — meaning whichever real student
   * happened to be first to open a cold Topic paid, from their own
   * per-student daily budget, for a one-time authoring cost that every
   * future student then gets for free. `requestingUserId` itself is still
   * threaded through unchanged for the generation LOCK's ownership
   * bookkeeping below (`generationLockedBy`) — only the AI-spend actor
   * changed, never who "owns" the in-flight generation lock.
   *
   * Topic generation itself is protected by its own Postgres CAS lock
   * (Topic.generationLockedAt/generationLockedBy) so concurrent requests
   * for the SAME never-generated Topic trigger exactly one AI call, not
   * one per request — same single-flight pattern as the Unit-grounding
   * lock, tuned tighter since a lesson draft is one AI call, not a
   * multi-chunk vision extraction.
   */
  async ensureTopicHasLesson(
    topicId: string,
    opts: { preferredLang: "ar" | "en"; studentAgeRange: string },
    requestingUserId: string,
  ) {
    const topic = await this.prisma.client.topic.findUnique({ where: { id: topicId } });
    if (!topic) throw new NotFoundException(`Topic ${topicId} not found.`);
    if (topic.teachingStepsJson) return topic;

    if (typeof (this.unitGrounding as any).prepareNextGroundingChunk !== "function") {
      await this.unitGrounding.ensureUnitGrounded(topic.unitId, CONTENT_AUTHORING_ACTOR_ID);
    }

    // Repair the common publish-before-assignment case before grounded lesson
    // authoring. This is deterministic and makes no provider/API call. Do not
    // rewrite persisted BLOCKED/STALE/EMPTY decisions here: those still need
    // the reviewed remediation path and must remain unavailable to students.
    await this.prepareMissingTopicGroundingAssignment(topicId);

    // Legacy direct callers/tests may provide the pre-Phase-3 grounding stub;
    // the production service is prepared by InteractiveLessonService first.
    if (typeof (this.unitGrounding as any).prepareNextGroundingChunk !== "function") {
      await this.unitGrounding.ensureUnitGrounded(topic.unitId, CONTENT_AUTHORING_ACTOR_ID);
    }

    // Deliberately NOT filtering on teachingStepsJson here — Prisma's
    // JSON-column null filters need the Prisma.JsonNull sentinel, not a
    // plain `null` (same footgun documented in dashboard.service.ts and in
    // UnitGroundingService.ensureUnitGrounded). The `if (topic.
    // teachingStepsJson) return topic;` check above already established
    // it's null for THIS request; a second concurrent winner racing
    // between that check and this UPDATE just regenerates once more,
    // which is wasteful but never corrupts anything.
    const staleThreshold = new Date(Date.now() - TOPIC_LOCK_STALE_AFTER_MS);
    const claimed = await this.prisma.client.topic.updateMany({
      where: { id: topicId, OR: [{ generationLockedAt: null }, { generationLockedAt: { lt: staleThreshold } }] },
      data: { generationLockedAt: new Date(), generationLockedBy: requestingUserId },
    });

    if (claimed.count === 0) {
      this.logger.log(`TOPIC_GENERATION_WAITING_EXISTING_JOB topicId=${topicId}`);
      await pollUntil(
        async () => {
          const fresh = await this.prisma.client.topic.findUnique({ where: { id: topicId }, select: { teachingStepsJson: true } });
          return !!fresh?.teachingStepsJson;
        },
        { intervalMs: TOPIC_GENERATION_WAIT_POLL_INTERVAL_MS, timeoutMs: TOPIC_GENERATION_WAIT_TIMEOUT_MS },
      );
      // Whichever way this resolved (generated in time or not), return the
      // Topic's current real state — never throws just because this
      // particular request lost the race and had to wait.
      return this.prisma.client.topic.findUniqueOrThrow({ where: { id: topicId } });
    }

    try {
      const { draft, generationSource, groundingVersionUsed, generationPromptVersion, provenance } = await this.generateAutoDraft(
        { id: topic.id, nameEn: topic.nameEn, nameAr: topic.nameAr, unitId: topic.unitId },
        opts,
        CONTENT_AUTHORING_ACTOR_ID,
      );
      await this.publisher.autoPublishIntoTopic(draft.id, topicId, { generationSource, groundingVersionUsed, generationPromptVersion, provenance });
    } finally {
      await this.prisma.client.topic.updateMany({ where: { id: topicId }, data: { generationLockedAt: null, generationLockedBy: null } });
    }

    return this.prisma.client.topic.findUniqueOrThrow({ where: { id: topicId } });
  }

  async prepareTopicGrounding(topicId: string, requestingActorId: string) {
    const topic = await this.prisma.client.topic.findUnique({ where: { id: topicId }, select: { unitId: true } });
    if (!topic) throw new NotFoundException(`Topic ${topicId} not found.`);
    return this.unitGrounding.prepareNextGroundingChunk(topic.unitId, requestingActorId);
  }

  private async prepareMissingTopicGroundingAssignment(topicId: string) {
    const topic = await this.prisma.client.topic.findUnique({
      where: { id: topicId },
      include: { ...TOPIC_GATE_INCLUDE, unit: { select: UNIT_GATE_SELECT } },
    });
    if (!topic?.unit?.groundingNotesJson || topic.groundingAssignment) return;

    const result = await this.topicGroundingAssignments.assignGroundingForTopic(topicId);
    if (result.outcome === "UNRESOLVED") {
      this.logger.warn(`TOPIC_GROUNDING_LAZY_ASSIGNMENT_UNRESOLVED topicId=${topicId}`);
    }
  }

  async getTopicGroundingPreparationStatus(topicId: string) {
    const topic = await this.prisma.client.topic.findUnique({ where: { id: topicId }, select: { unitId: true } });
    if (!topic) return { status: "CONFIGURATION_ERROR" as const };
    return this.unitGrounding.getPreparationStatus(topic.unitId);
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
          feature: "lesson_draft_generation",
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

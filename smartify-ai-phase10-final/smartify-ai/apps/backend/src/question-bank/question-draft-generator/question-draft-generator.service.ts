import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AIProviderFactory } from "../../ai/ai-provider.factory";
import { AIContextBuilderService } from "../../ai/context/ai-context-builder.service";
import { AIUsageService } from "../../ai/usage/ai-usage.service";
import { validateQuestionDraft } from "./question-draft-validator";
import type { QuestionGenerationInput, ResolvedTopicContext } from "./question-draft.types";

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
@Injectable()
export class QuestionDraftGeneratorService {
  private readonly logger = new Logger(QuestionDraftGeneratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: AIProviderFactory,
    private readonly contextBuilder: AIContextBuilderService,
    private readonly usageService: AIUsageService,
  ) {}

  /**
   * Resolves curriculum/grade/subject/unit/topic names LIVE from the
   * existing Topic -> Unit -> Subject -> Grade -> Curriculum relations —
   * never hand-typed. Mirrors LessonDraftGeneratorService.resolveUnitContext.
   */
  async resolveTopicContext(topicId: string): Promise<ResolvedTopicContext & { topicId: string; isPlaceholder: boolean }> {
    const topic = await this.prisma.client.topic.findUnique({
      where: { id: topicId },
      include: {
        unit: { include: { subject: { include: { grade: { include: { curriculum: true } } } } } },
        lessons: { select: { isPlaceholder: true } },
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

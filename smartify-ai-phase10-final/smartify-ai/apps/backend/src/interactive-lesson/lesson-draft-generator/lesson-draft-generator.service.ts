import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AIProviderFactory } from "../../ai/ai-provider.factory";
import { AIContextBuilderService } from "../../ai/context/ai-context-builder.service";
import { AIUsageService } from "../../ai/usage/ai-usage.service";
import { validateLessonDraft } from "./lesson-draft-validator";
import type { LessonGenerationInput, ResolvedUnitContext } from "./lesson-draft.types";
import { toUnreviewedBilingualObjectives } from "./lesson-objectives.util";

// One initial attempt + one corrective retry if validation fails — never an
// uncontrolled loop. A retry re-sends the exact validation errors so the
// model fixes only what was wrong, and still costs a normal, budget-checked
// AI call like any other.
const MAX_ATTEMPTS = 2;

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
  ) {}

  /**
   * Resolves curriculum/grade/subject/unit names LIVE from the existing
   * Unit -> Subject -> Grade -> Curriculum relations — never hand-typed.
   * Phase 5 disclosed this as a fragile manual dependency; this is the
   * Phase 6 fix. Mirrors the exact include chain interactive-lesson.service
   * already uses for `getTopicOrThrow`.
   */
  async resolveUnitContext(unitId: string): Promise<ResolvedUnitContext & { unitId: string }> {
    const unit = await this.prisma.client.unit.findUnique({
      where: { id: unitId },
      include: { subject: { include: { grade: { include: { curriculum: true } } } } },
    });
    if (!unit) {
      throw new NotFoundException(`Unit ${unitId} not found — cannot resolve curriculum context.`);
    }
    return {
      unitId: unit.id,
      curriculumNameEn: unit.subject.grade.curriculum.nameEn,
      gradeNameEn: unit.subject.grade.nameEn,
      subjectNameEn: unit.subject.nameEn,
      unitNameEn: unit.nameEn,
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
      const result = await provider.generate({
        systemPrompt,
        messages: [{ role: "user", content: "Generate the lesson draft now." }],
        responseFormat: "json_object",
      });
      callsMade++;

      await this.logUsage(requestingUserId, providerKey, model, result.inputTokens, result.outputTokens);

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

  private async logUsage(userId: string, providerKey: string, model: string, inputTokens: number, outputTokens: number) {
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
  }
}

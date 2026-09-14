import { Injectable, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { validateLessonDraft } from "./lesson-draft-validator";
import { allObjectivesReviewed, applyReviewedTranslations, parseBilingualObjectives } from "./lesson-objectives.util";

export interface LessonPublishResult {
  topicId: string;
  lessonId: string;
  learningObjectiveIds: string[];
  alreadyPublished: boolean;
}

/**
 * Phase 6: Approve -> Publish for a LessonDraft. Two distinct, sequential
 * transitions (pending_review -> approved -> published) — never
 * collapsed, even though both live on this one service. `publish()` is
 * idempotent via the durable `publishedTopicId` link (never by matching
 * names), and the actual content creation is one atomic transaction: all
 * of Topic/Lesson/LearningObjective + the draft's publish-link update
 * succeed together, or none of them do.
 */
@Injectable()
export class LessonPublishService {
  private readonly logger = new Logger(LessonPublishService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The one place a human reviewer supplies the reviewed Arabic half of a
   * draft's learning objectives. Matched to the draft's existing (AI-
   * proposed-nothing, human-authored-English) objectives by exact text —
   * this can only fill in translations for objectives the draft already
   * has, never add new ones. Callable any number of times while still
   * pending_review (e.g. to fix a typo before approving); approve() is
   * what actually locks the draft forward.
   */
  async reviewObjectives(draftId: string, translations: Array<{ objectiveEn: string; objectiveAr: string }>) {
    const draft = await this.prisma.client.lessonDraft.findUnique({ where: { id: draftId } });
    if (!draft) throw new NotFoundException(`LessonDraft ${draftId} not found.`);
    if (draft.status !== "pending_review") {
      throw new BadRequestException(`Cannot review objectives for a draft in status "${draft.status}" — must be "pending_review".`);
    }

    const current = parseBilingualObjectives(draft.learningObjectivesJson);
    const updated = applyReviewedTranslations(current, translations);

    return this.prisma.client.lessonDraft.update({
      where: { id: draftId },
      data: { learningObjectivesJson: updated as any },
    });
  }

  async approve(draftId: string, reviewedByUserId?: string) {
    const draft = await this.prisma.client.lessonDraft.findUnique({ where: { id: draftId } });
    if (!draft) throw new NotFoundException(`LessonDraft ${draftId} not found.`);
    if (draft.status !== "pending_review") {
      throw new BadRequestException(`Cannot approve draft in status "${draft.status}" — must be "pending_review".`);
    }

    const validation = validateLessonDraft(
      { topicNameEn: draft.topicNameEn, steps: draft.teachingStepsJson },
      { topicNameEn: draft.topicNameEn },
    );
    if (!validation.valid) {
      throw new BadRequestException(`Draft failed validation: ${validation.errors.join("; ")}`);
    }

    // Phase 10B: replaces the old hardcoded REVIEWED_OBJECTIVE_TRANSLATIONS
    // allow-list. The AI never supplies objectiveAr (see BilingualObjective's
    // doc comment) — a human must have explicitly called reviewObjectives()
    // for every single objective before this draft can move forward at all.
    const objectives = parseBilingualObjectives(draft.learningObjectivesJson);
    if (!allObjectivesReviewed(objectives)) {
      throw new BadRequestException(
        "All learning objectives must have a human-reviewed Arabic translation (see reviewObjectives()) before this draft can be approved.",
      );
    }

    if (!draft.targetUnitId) {
      throw new BadRequestException("Draft has no targetUnitId — cannot resolve curriculum hierarchy.");
    }
    const unit = await this.prisma.client.unit.findUnique({ where: { id: draft.targetUnitId } });
    if (!unit) {
      throw new BadRequestException(`Target unit ${draft.targetUnitId} no longer exists — cannot approve.`);
    }

    return this.prisma.client.lessonDraft.update({
      where: { id: draftId },
      data: { status: "approved", reviewedAt: new Date(), reviewedByUserId: reviewedByUserId ?? null },
    });
  }

  async publish(draftId: string): Promise<LessonPublishResult> {
    const draft = await this.prisma.client.lessonDraft.findUnique({ where: { id: draftId } });
    if (!draft) throw new NotFoundException(`LessonDraft ${draftId} not found.`);

    // Idempotency: the durable draft -> Topic link is the single source
    // of truth, never name-matching. A second publish call for an
    // already-published draft is a safe no-op that returns the existing
    // result — it never creates anything, never re-validates, never
    // touches AI.
    if (draft.publishedTopicId) {
      this.logger.log(`Draft ${draftId} is already published as Topic ${draft.publishedTopicId} — returning existing result.`);
      const lesson = await this.prisma.client.lesson.findFirst({ where: { topicId: draft.publishedTopicId } });
      const learningObjectives = lesson
        ? await this.prisma.client.learningObjective.findMany({ where: { lessonId: lesson.id } })
        : [];
      return {
        topicId: draft.publishedTopicId,
        lessonId: lesson?.id ?? "",
        learningObjectiveIds: learningObjectives.map((o) => o.id),
        alreadyPublished: true,
      };
    }

    if (draft.status !== "approved") {
      throw new BadRequestException(`Cannot publish draft in status "${draft.status}" — must be "approved".`);
    }
    if (!draft.targetUnitId) {
      throw new BadRequestException("Draft has no targetUnitId — cannot publish.");
    }

    // Phase 10B: approve() already guaranteed every objective has a
    // human-reviewed objectiveAr — publish() trusts that gate and never
    // re-derives or invents a translation itself.
    const objectives = parseBilingualObjectives(draft.learningObjectivesJson);

    const result = await this.prisma.client.$transaction(async (tx) => {
      const unit = await tx.unit.findUnique({ where: { id: draft.targetUnitId! } });
      if (!unit) throw new BadRequestException(`Target unit ${draft.targetUnitId} no longer exists.`);

      const maxOrder = await tx.topic.aggregate({ where: { unitId: unit.id }, _max: { order: true } });
      const nextOrder = (maxOrder._max.order ?? 0) + 1;

      const topic = await tx.topic.create({
        data: {
          unitId: unit.id,
          nameEn: draft.topicNameEn,
          nameAr: draft.topicNameAr,
          order: nextOrder,
          teachingStepsJson: draft.teachingStepsJson as any,
        },
      });

      const lesson = await tx.lesson.create({
        data: {
          topicId: topic.id,
          nameEn: draft.topicNameEn,
          nameAr: draft.topicNameAr,
          order: 1,
          isAiGenerated: true, // distinguishes this from hand-authored pilot lessons
          isPlaceholder: false,
        },
      });

      const createdObjectives = [];
      for (const objective of objectives) {
        // objectiveAr is non-null here by construction — approve() already
        // rejected any draft where this wasn't true, and status must be
        // "approved" to have reached this point.
        createdObjectives.push(
          await tx.learningObjective.create({
            data: { lessonId: lesson.id, descriptionEn: objective.objectiveEn, descriptionAr: objective.objectiveAr! },
          }),
        );
      }

      await tx.lessonDraft.update({
        where: { id: draft.id },
        data: { status: "published", publishedTopicId: topic.id, publishedAt: new Date() },
      });

      return { topic, lesson, createdObjectives };
    });

    return {
      topicId: result.topic.id,
      lessonId: result.lesson.id,
      learningObjectiveIds: result.createdObjectives.map((o) => o.id),
      alreadyPublished: false,
    };
  }
}

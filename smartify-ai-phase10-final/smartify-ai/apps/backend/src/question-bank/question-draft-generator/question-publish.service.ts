import { Injectable, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { validateQuestionDraft } from "./question-draft-validator";

export interface QuestionPublishResult {
  questionId: string;
  alreadyPublished: boolean;
}

export interface QuestionDraftReviewEdits {
  promptEn?: string;
  promptAr?: string;
  optionsJson?: string[];
  correctAnswerJson?: unknown;
  explanationEn?: string;
  explanationAr?: string;
  difficulty?: string;
  type?: string;
}

/**
 * Phase 10E: Draft -> (human review) -> Approve -> Publish for a
 * QuestionDraft. Mirrors LessonPublishService's proven shape exactly:
 * pending_review -> approved -> published, never collapsed; publish() is
 * idempotent via the durable `publishedQuestionId` link (never name-
 * matching); the actual Question creation is one atomic transaction with
 * the draft's publish-link update.
 */
@Injectable()
export class QuestionPublishService {
  private readonly logger = new Logger(QuestionPublishService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The one place a human reviewer supplies/edits reviewable content —
   * English prompt, Arabic prompt, options, correct answer, explanations,
   * difficulty, type. Callable any number of times while still
   * pending_review (e.g. to fix a typo before approving); approve() is
   * what actually locks the draft forward. Mirrors
   * LessonPublishService.reviewObjectives()'s "review is separate from
   * approve" shape, generalized to a plain field-edit since QuestionDraft
   * has no per-item array to match by text.
   */
  async reviewDraft(draftId: string, edits: QuestionDraftReviewEdits) {
    const draft = await this.prisma.client.questionDraft.findUnique({ where: { id: draftId } });
    if (!draft) throw new NotFoundException(`QuestionDraft ${draftId} not found.`);
    if (draft.status !== "pending_review") {
      throw new BadRequestException(`Cannot review a draft in status "${draft.status}" — must be "pending_review".`);
    }
    if (Object.keys(edits).length === 0) {
      throw new BadRequestException("At least one reviewed field is required.");
    }

    return this.prisma.client.questionDraft.update({
      where: { id: draftId },
      data: { ...edits } as any,
    });
  }

  async approve(draftId: string, reviewedByUserId?: string) {
    const draft = await this.prisma.client.questionDraft.findUnique({ where: { id: draftId } });
    if (!draft) throw new NotFoundException(`QuestionDraft ${draftId} not found.`);
    if (draft.status !== "pending_review") {
      throw new BadRequestException(`Cannot approve draft in status "${draft.status}" — must be "pending_review".`);
    }

    const topic = await this.prisma.client.topic.findUnique({
      where: { id: draft.topicId },
      include: { lessons: { select: { isPlaceholder: true } } },
    });
    const topicExists = !!topic;
    const topicIsPlaceholder = !topic || !topic.lessons.some((l) => !l.isPlaceholder);

    const validation = validateQuestionDraft(draft, { topicExists, topicIsPlaceholder, requireReviewedContent: true });
    if (!validation.valid) {
      throw new BadRequestException(`Draft failed validation: ${validation.errors.join("; ")}`);
    }

    return this.prisma.client.questionDraft.update({
      where: { id: draftId },
      data: { status: "approved", reviewedAt: new Date(), reviewedByUserId: reviewedByUserId ?? null },
    });
  }

  /** Human reviewer declines a draft — never publishable again from this state. */
  async reject(draftId: string, reviewedByUserId?: string, reason?: string) {
    const draft = await this.prisma.client.questionDraft.findUnique({ where: { id: draftId } });
    if (!draft) throw new NotFoundException(`QuestionDraft ${draftId} not found.`);
    if (draft.status !== "pending_review") {
      throw new BadRequestException(`Cannot reject a draft in status "${draft.status}" — must be "pending_review".`);
    }

    return this.prisma.client.questionDraft.update({
      where: { id: draftId },
      data: { status: "rejected", reviewedAt: new Date(), reviewedByUserId: reviewedByUserId ?? null, rejectionReason: reason ?? null },
    });
  }

  async publish(draftId: string): Promise<QuestionPublishResult> {
    const draft = await this.prisma.client.questionDraft.findUnique({ where: { id: draftId } });
    if (!draft) throw new NotFoundException(`QuestionDraft ${draftId} not found.`);

    // Idempotency: the durable draft -> Question link is the single source
    // of truth. A second publish call for an already-published draft is a
    // safe no-op that returns the existing result — never re-validates,
    // never creates a duplicate row.
    if (draft.publishedQuestionId) {
      this.logger.log(`Draft ${draftId} is already published as Question ${draft.publishedQuestionId} — returning existing result.`);
      return { questionId: draft.publishedQuestionId, alreadyPublished: true };
    }

    if (draft.status !== "approved") {
      throw new BadRequestException(`Cannot publish draft in status "${draft.status}" — must be "approved".`);
    }

    const result = await this.prisma.client.$transaction(async (tx) => {
      const topic = await tx.topic.findUnique({ where: { id: draft.topicId } });
      if (!topic) throw new BadRequestException(`Target topic ${draft.topicId} no longer exists.`);

      const question = await tx.question.create({
        data: {
          topicId: draft.topicId,
          type: draft.type,
          difficulty: draft.difficulty,
          promptEn: draft.promptEn,
          promptAr: draft.promptAr,
          optionsJson: draft.optionsJson as any,
          correctAnswerJson: draft.correctAnswerJson as any,
          explanationEn: draft.explanationEn,
          explanationAr: draft.explanationAr,
          isAiGenerated: draft.isAiGenerated,
          isPlaceholder: false,
        },
      });

      await tx.questionDraft.update({
        where: { id: draft.id },
        data: { status: "published", publishedQuestionId: question.id, publishedAt: new Date() },
      });

      return question;
    });

    return { questionId: result.id, alreadyPublished: false };
  }

  /**
   * Launch-speed lazy-generation path (2026-09-19): publishes a draft
   * produced by QuestionDraftGeneratorService.generateAutoQuestionBatch()
   * with no reviewDraft()/approve() step in between — the draft's
   * promptAr/explanationAr are already AI-supplied by construction. The
   * resulting Question is flagged `needsReview: true` for a later audit
   * pass. Deliberately a separate method from publish() above, so the
   * original human-reviewed pipeline's guarantees (status must be
   * "approved") can never be weakened by this addition.
   */
  async autoPublish(draftId: string): Promise<QuestionPublishResult> {
    const draft = await this.prisma.client.questionDraft.findUnique({ where: { id: draftId } });
    if (!draft) throw new NotFoundException(`QuestionDraft ${draftId} not found.`);

    if (draft.publishedQuestionId) {
      this.logger.log(`Draft ${draftId} is already published as Question ${draft.publishedQuestionId} — returning existing result.`);
      return { questionId: draft.publishedQuestionId, alreadyPublished: true };
    }

    const topic = await this.prisma.client.topic.findUnique({
      where: { id: draft.topicId },
      include: { lessons: { select: { isPlaceholder: true } } },
    });
    const topicExists = !!topic;
    const topicIsPlaceholder = !topic || !topic.lessons.some((l) => !l.isPlaceholder);

    const validation = validateQuestionDraft(draft, { topicExists, topicIsPlaceholder, requireReviewedContent: true });
    if (!validation.valid) {
      throw new BadRequestException(`Draft failed validation: ${validation.errors.join("; ")}`);
    }

    const result = await this.prisma.client.$transaction(async (tx) => {
      const question = await tx.question.create({
        data: {
          topicId: draft.topicId,
          type: draft.type,
          difficulty: draft.difficulty,
          promptEn: draft.promptEn,
          promptAr: draft.promptAr,
          optionsJson: draft.optionsJson as any,
          correctAnswerJson: draft.correctAnswerJson as any,
          explanationEn: draft.explanationEn,
          explanationAr: draft.explanationAr,
          isAiGenerated: true,
          needsReview: true, // AI-authored bilingual content, never human-reviewed — see this method's doc comment
          isPlaceholder: false,
        },
      });

      await tx.questionDraft.update({
        where: { id: draft.id },
        data: { status: "published", publishedQuestionId: question.id, publishedAt: new Date() },
      });

      return question;
    });

    return { questionId: result.id, alreadyPublished: false };
  }
}

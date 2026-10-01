import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AIProviderFactory } from "../ai/ai-provider.factory";
import { AIContextBuilderService } from "../ai/context/ai-context-builder.service";
import { AIUsageService } from "../ai/usage/ai-usage.service";
import { TutorQuestionPacksService } from "../tutor-question-packs/tutor-question-packs.service";
import { TutorAnswerCacheService } from "./tutor-answer-cache.service";
import { assignedGroundingSliceOrNull } from "../ai/context/topic-grounding-assignment.util";
import type { GroundingNotes } from "../interactive-lesson/unit-grounding/unit-grounding.types";
import { buildAdaptiveMathTeachingPlan } from "./adaptive-math-teaching.util";
import { deriveMathVisualWithContext, parseTutorVisual } from "./visual-instruction.util";

// Hard cap on a single message's length, checked BEFORE any daily-limit
// slot is reserved or any provider call is made — an oversized prompt
// should be rejected cheaply, not consume real cost or a rate-limit slot.
// This is separate from the OUTPUT cap already enforced by
// AIGenerateRequest.maxOutputTokens on the provider side (Phase 6).
const MAX_MESSAGE_CHARS = 4000;

@Injectable()
export class TutorService {
  private readonly logger = new Logger(TutorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: AIProviderFactory,
    private readonly contextBuilder: AIContextBuilderService,
    private readonly usageService: AIUsageService,
    private readonly questionPacks: TutorQuestionPacksService,
    private readonly answerCache: TutorAnswerCacheService,
  ) {}

  private async getProfileOrThrow(userId: string) {
    const profile = await this.prisma.client.studentProfile.findUnique({
      where: { userId },
      include: { curriculum: true, grade: true, subjects: { include: { subject: true } } },
    });
    if (!profile) throw new NotFoundException("Complete onboarding before using the AI Tutor.");
    return profile;
  }

  /**
   * The single authoritative quota-state endpoint for the tutor UI, for
   * BOTH free-trial and subscribed students. Previously the frontend
   * called TutorQuestionPacksService's endpoint instead, which has no
   * concept of the free trial at all (it reads the daily-usage counter,
   * which free-trial students never touch — reserveFreeTrial/
   * releaseFreeTrial operate on FreeTutorTrial.questionsUsed, a separate
   * counter). That mismatch is what produced the misleading "10 daily
   * questions left" display for an exhausted free-trial account: the
   * counter the old endpoint read was simply never decremented for them.
   * Delegating to TutorQuestionPacksService.getRemaining() for the
   * subscribed branch (rather than returning AIUsageService's bare
   * {used,limit,remaining} shape as before) keeps this the ONE place that
   * computes remaining-quota shape, so the frontend never has to guess
   * which fields exist for which account state.
   */
  async getRemainingToday(userId: string, subjectId: string) {
    const profile = await this.getProfileOrThrow(userId);
    const subscription = await this.prisma.client.subscription.findUnique({ where: { studentId: profile.id } });
    if (!subscription || subscription.status !== "active") {
      const trial = await this.prisma.client.freeTutorTrial.findUnique({ where: { studentId: profile.id } });
      const trialRemaining = trial && trial.subjectId === subjectId ? Math.max(0, 2 - trial.questionsUsed) : trial ? 0 : 2;
      return {
        dailyRemaining: 0,
        extraRemaining: 0,
        totalRemaining: trialRemaining,
        packPriceEGP: 50,
        packSize: 10,
        isFreeTrial: true,
        freeTrialExhausted: trialRemaining === 0,
        trialSubjectId: trial?.subjectId ?? null,
      };
    }
    const packState = await this.questionPacks.getRemaining(userId, subjectId);
    return { ...packState, isFreeTrial: false, freeTrialExhausted: false, trialSubjectId: null };
  }

  // Public: reused by the Interactive Lesson engine (LessonSessionService),
  // which reserves exactly one free-trial unit per lesson SESSION start
  // (not per teaching turn) using this exact same entitlement path — never
  // a separate/parallel trial mechanism.
  async reserveFreeTrial(studentId: string, subjectId: string) {
    const trial = await this.prisma.client.freeTutorTrial.upsert({
      where: { studentId },
      create: { studentId, subjectId, questionsUsed: 0 },
      update: {},
    });
    if (trial.subjectId !== subjectId || trial.questionsUsed >= 2 || trial.completedAt) {
      throw new ForbiddenException("Your free trial is complete. Subscribe to continue.");
    }
    const updated = await this.prisma.client.freeTutorTrial.updateMany({
      where: { id: trial.id, subjectId, questionsUsed: { lt: 2 }, completedAt: null },
      data: { questionsUsed: { increment: 1 } },
    });
    if (updated.count !== 1) {
      throw new ForbiddenException("Your free trial is complete. Subscribe to continue.");
    }
    return { source: "free-trial" as const };
  }

  async releaseFreeTrial(studentId: string, subjectId: string) {
    await this.prisma.client.freeTutorTrial.updateMany({
      where: { studentId, subjectId, questionsUsed: { gt: 0 }, completedAt: null },
      data: { questionsUsed: { decrement: 1 }, completedAt: null },
    });
  }

  private async persistCachedReply(
    studentId: string,
    input: { subjectId: string; topicId?: string; conversationId?: string },
    prompt: string,
    answer: string,
  ) {
    let conversation = input.conversationId
      ? await this.prisma.client.aIConversation.findUnique({ where: { id: input.conversationId } })
      : null;
    if (conversation && conversation.studentId !== studentId) {
      throw new ForbiddenException("This conversation does not belong to you.");
    }
    if (!conversation) {
      conversation = await this.prisma.client.aIConversation.create({
        data: { studentId, subjectId: input.subjectId, topicId: input.topicId, title: prompt.slice(0, 60) },
      });
    }
    await this.prisma.client.$transaction([
      this.prisma.client.aIMessage.createMany({
        data: [
          { conversationId: conversation.id, role: "user", content: prompt },
          { conversationId: conversation.id, role: "assistant", content: answer },
        ],
      }),
      this.prisma.client.aIConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } }),
    ]);
    return { conversationId: conversation.id, reply: answer, isAiGenerated: true, fromCache: true };
  }

  async listConversations(userId: string) {
    const profile = await this.getProfileOrThrow(userId);
    return this.prisma.client.aIConversation.findMany({
      where: { studentId: profile.id },
      orderBy: { updatedAt: "desc" },
    });
  }

  /**
   * Ownership check: a conversation belongs to exactly one StudentProfile,
   * and this is the only place a conversation is ever read back out — a
   * user cannot view another student's tutor conversation by guessing or
   * enumerating conversation IDs, since the ID alone is never sufficient
   * without also matching the caller's own profile.
   */
  async getConversation(userId: string, conversationId: string) {
    const profile = await this.getProfileOrThrow(userId);
    const conversation = await this.prisma.client.aIConversation.findUnique({
      where: { id: conversationId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!conversation || conversation.studentId !== profile.id) {
      throw new NotFoundException("Conversation not found.");
    }
    return conversation;
  }

  async sendMessage(userId: string, input: { subjectId: string; topicId?: string; conversationId?: string; message: string }) {
    const profile = await this.getProfileOrThrow(userId);

    const studentSubject = profile.subjects.find((s) => s.subjectId === input.subjectId);
    if (!studentSubject) {
      throw new ForbiddenException("This subject is not part of your selected subjects.");
    }

    // --- Input validation (cheap, no cost/slot consumed yet) ---
    const trimmed = input.message?.trim();
    if (!trimmed) {
      throw new BadRequestException("Message cannot be empty.");
    }
    if (trimmed.length > MAX_MESSAGE_CHARS) {
      throw new BadRequestException(`Message is too long (max ${MAX_MESSAGE_CHARS} characters).`);
    }
    const currentTurnMathPlan = buildAdaptiveMathTeachingPlan(studentSubject.subject.nameEn, [{ role: "user", content: trimmed }]);
    const canUseAnswerCache = !input.conversationId && (!currentTurnMathPlan || currentTurnMathPlan.stage === "CURRICULUM_FIRST");

    // --- Global/per-user spend circuit breaker (cheap, no cost/slot
    // consumed yet — see AIUsageService.assertWithinBudget) ---
    await this.usageService.assertWithinBudget(userId);

    // --- Subscription/trial gate (cheap, no cost/slot consumed yet) ---
    // Active subscribers use the normal daily/extra-question allowance.
    // Other signed-in students receive one account-bound, two-question trial.
    const subscription = await this.prisma.client.subscription.findUnique({ where: { studentId: profile.id } });
    const hasActiveSubscription = subscription?.status === "active";

    // --- Atomic rate-limit reservation (concurrency-safe — see AIUsageService.reserveDailySlot) ---
    const reservation = hasActiveSubscription
      ? await this.questionPacks.consumeForTutor(profile.id, input.subjectId)
      : await this.reserveFreeTrial(profile.id, input.subjectId);

    // Phase 9.4C: set once the atomic USD reservation below actually
    // succeeds — the catch block releases it (alongside the trial/slot
    // reservation) for every failure path after that point, and it stays
    // null if we never get that far (so the catch never tries to release
    // a reservation that was never taken).
    let budgetReservationId: string | null = null;

    try {
      // A cached answer is scoped only by prompt/curriculum/topic, not by
      // conversation history. It is therefore safe for a new standalone
      // question, but must never bypass a follow-up whose teaching approach
      // depends on prior attempts, hints, or methods.
      const cached = canUseAnswerCache ? await this.answerCache.find({
        curriculumId: profile.curriculum.id,
        gradeId: profile.grade.id,
        subjectId: input.subjectId,
        topicId: input.topicId,
        language: profile.preferredLang,
        prompt: trimmed,
      }) : null;
      if (cached) {
        return this.persistCachedReply(profile.id, input, trimmed, cached.answer);
      }

      let conversation = input.conversationId
        ? await this.prisma.client.aIConversation.findUnique({ where: { id: input.conversationId } })
        : null;

      if (conversation && conversation.studentId !== profile.id) {
        throw new ForbiddenException("This conversation does not belong to you.");
      }

      if (!conversation) {
        conversation = await this.prisma.client.aIConversation.create({
          data: {
            studentId: profile.id,
            subjectId: input.subjectId,
            topicId: input.topicId,
            title: trimmed.slice(0, 60),
          },
        });
      }

      const priorMessages = await this.prisma.client.aIMessage.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: "asc" },
        take: 20, // simple recent-history window; summarization can be added later if conversations grow long
      });

      const subject = studentSubject.subject;
      let topicNameEn: string | undefined;
      let groundingSlice = null;
      if (input.topicId) {
        const topic = await this.prisma.client.topic.findUnique({
          where: { id: input.topicId },
          include: {
            // 2026-09-27: the Topic's PERSISTED grounding assignment, read in
            // the same query — the Tutor no longer re-infers relevance from the
            // Topic title on every turn.
            groundingAssignment: true,
            topicSourceEvidence: true,
            unit: { select: { subjectId: true, groundingNotesJson: true, groundingVersion: true, groundingSourceFingerprint: true } },
          },
        });
        // A client-supplied Topic must belong to the selected Subject before
        // it can influence this tutor turn. Its Unit grounding is then
        // narrowed to this Topic rather than exposing a whole Unit.
        if (topic?.unit?.subjectId === input.subjectId) {
          topicNameEn = topic.nameEn;
          groundingSlice = assignedGroundingSliceOrNull(topic.groundingAssignment, {
            groundingVersion: topic.unit.groundingVersion,
            groundingSourceFingerprint: topic.unit.groundingSourceFingerprint,
            groundingNotesJson: topic.unit.groundingNotesJson as GroundingNotes | null,
          }, topic.topicSourceEvidence);
        }
      }

      const adaptiveMathPlan = buildAdaptiveMathTeachingPlan(subject.nameEn, [
        ...priorMessages,
        { role: "user", content: trimmed },
      ]);

      const systemPrompt = this.contextBuilder.buildTutorSystemPrompt({
        studentFullName: profile.fullName,
        age: profile.age,
        curriculumNameEn: profile.curriculum.nameEn,
        gradeNameEn: profile.grade.nameEn,
        subjectNameEn: subject.nameEn,
        topicNameEn,
        preferredLang: profile.preferredLang as "ar" | "en",
        groundingSlice,
        adaptiveMathPlan,
      });

      const { provider, providerKey, model } = await this.providerFactory.getActiveProvider();

      const conversationMessages = [
        ...priorMessages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        { role: "user" as const, content: trimmed },
      ];

      // --- Phase 9.4C: atomic USD reservation, immediately before the
      // costly provider call — this is the real, cross-process-safe
      // circuit breaker (assertWithinBudget above stays as a cheap early
      // check; this is what actually prevents two concurrent requests
      // from both spending past the budget). Estimated from the REAL
      // prompt text about to be sent, using the provider's real cost
      // rates and the real output-token ceiling — a true worst case, not
      // a guess. ---
      const estimatedUsd = await this.usageService.estimateMaxChatCostUsd({
        providerKey,
        inputText: systemPrompt + conversationMessages.map((m) => m.content).join(""),
      });
      const reserveResult = await this.usageService.reserveBudget(userId, estimatedUsd);
      if (!reserveResult.ok) {
        throw new ServiceUnavailableException(
          reserveResult.reason === "misconfigured"
            ? "The AI Tutor is temporarily unavailable. Please try again later."
            : "The AI Tutor is temporarily unavailable due to daily usage limits. Please try again later.",
        );
      }
      budgetReservationId = reserveResult.reservationId;

      // --- The actual (costly) AI provider call. If this throws, no cost
      // was incurred, and the outer catch below releases the reserved
      // slot AND the budget reservation (single release point — see its
      // comment for why). ---
      const result = await provider.generate({
        systemPrompt,
        messages: conversationMessages,
      });
      // Trimmed once, here — the model routinely emits a trailing space
      // before its closing quote, and /tutor/speech trims its own input
      // before matching against the persisted AIMessage.content, so an
      // untrimmed reply here would persist/cache/return one string but be
      // compared against a different (trimmed) one, breaking voice
      // playback for that turn (found 2026-09-19 in the Interactive
      // Lesson engine's identical pattern — same shared TTS endpoint, so
      // the same bug applies here unchanged).
      result.content = result.content.trim();
      const rawTutorContent = result.content;
      const parsedVisual = parseTutorVisual(rawTutorContent);
      result.content = parsedVisual.text;
      const deterministic = deriveMathVisualWithContext(trimmed, subject.nameEn, priorMessages);
      const deterministicVisual = deterministic.visual;
      const returnedVisual = deterministicVisual ?? parsedVisual.visual;
      this.logger.log(JSON.stringify({
        event: "TUTOR_VISUAL_INTENT_RESULT",
        conversationId: conversation.id,
        subjectIsMath: /\b(math|mathematics|maths)\b|رياضيات/iu.test(subject.nameEn),
        adaptiveStage: adaptiveMathPlan?.stage ?? null,
        visualRequestedByStudent: /\b(show|draw|visuali[sz]e|picture|diagram)\b|\b visually\b|وريني|ارسم|بصري/iu.test(trimmed),
        markerDetected: /<!--SMARTIFY_VISUAL\s+/i.test(rawTutorContent),
        markerCount: (rawTutorContent.match(/<!--SMARTIFY_VISUAL\s+/gi) ?? []).length,
        parseSucceeded: parsedVisual.visual !== null,
        validationSucceeded: parsedVisual.visual !== null,
        visualKind: returnedVisual?.kind ?? null,
        visualReturned: returnedVisual !== null,
        visualExpressionSource: deterministic.source === "none" ? (parsedVisual.visual ? "model_intent" : "none") : deterministic.source,
        resolvedOperation: deterministicVisual?.kind ?? null,
        failureReason: deterministicVisual || parsedVisual.visual ? null : "no-safe-visual-intent",
      }));

      // --- Persist messages + cost ledger atomically ---
      // Both writes happen in one transaction so it's never possible to
      // end up with "the student's reply is saved but the cost was never
      // logged" (or the reverse) — the exact partial-failure state that
      // would produce untracked billable usage.
      const usageRow = await this.usageService.buildUsageRow({
        userId,
        studentId: profile.id,
        subjectId: input.subjectId,
        providerKey,
        model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });

      // Reconcile the USD reservation to the real cost regardless of
      // whether the AIUsage/AIMessage transaction below succeeds — the
      // real provider call already happened and real money was already
      // spent either way, so the budget accounting must reflect reality
      // even if the display-facing DB write fails (same philosophy as
      // logUntrackedUsage below: real incurred cost must never silently
      // vanish from the ledger that actually gates future spend).
      await this.usageService.reconcileBudget(budgetReservationId, usageRow.costUsd).catch(() => undefined);

      try {
        await this.prisma.client.$transaction([
          this.prisma.client.aIMessage.createMany({
            data: [
              { conversationId: conversation.id, role: "user", content: trimmed },
              { conversationId: conversation.id, role: "assistant", content: result.content },
            ],
          }),
          this.prisma.client.aIConversation.update({
            where: { id: conversation.id },
            data: { updatedAt: new Date() },
          }),
          this.prisma.client.aIUsage.create({ data: usageRow }),
        ]);
      } catch (txError) {
        // The AI call already succeeded and real cost was already
        // incurred at the provider — that cost must never simply vanish.
        // The rate-limit slot was already correctly reserved above (so
        // the student's daily count is accurate either way); this
        // fallback only protects the cost/analytics ledger from being
        // silently lost if the DB write itself fails.
        this.usageService.logUntrackedUsage(
          { conversationId: conversation.id, ...usageRow },
          txError,
        );
        this.logger.warn(
          `Tutor reply for conversation ${conversation.id} was generated but the DB transaction failed; reply is still returned to the student. See CRITICAL log above for reconciliation.`,
        );
      }

      const remainingAfter = hasActiveSubscription
        ? await this.usageService.getRemainingToday(profile.id, input.subjectId)
        : { remaining: Math.max(0, 2 - ((await this.prisma.client.freeTutorTrial.findUnique({ where: { studentId: profile.id } }))?.questionsUsed ?? 2)), limit: 2 };

      if (canUseAnswerCache) {
        await this.answerCache.save({
          curriculumId: profile.curriculum.id,
          gradeId: profile.grade.id,
          subjectId: input.subjectId,
          topicId: input.topicId,
          language: profile.preferredLang,
          prompt: trimmed,
          answer: result.content,
          provider: providerKey,
          model,
        });
      }
      return {
        conversationId: conversation.id,
        reply: result.content,
        isAiGenerated: true, // surfaced to the frontend so it can badge the message, per the AI-vs-verified-content separation rule
        remainingToday: remainingAfter.remaining,
        dailyLimit: remainingAfter.limit,
        ...(returnedVisual ? { visual: returnedVisual, visualReason: "adaptive_math" as const } : {}),
      };
    } catch (err) {
      // Single release point for everything that can go wrong AFTER a
      // slot was reserved but BEFORE real AI cost was actually incurred:
      // conversation-ownership violations (ForbiddenException, thrown
      // before the provider call) and provider-call failures both land
      // here. Once the provider call succeeds, this codepath is never
      // reached for the subsequent DB-transaction-failure case — that
      // branch deliberately catches its own error and does NOT rethrow
      // (see above), because by then the question WAS legitimately used
      // and the slot should stay consumed; only the cost-ledger write
      // failed, which is handled by logUntrackedUsage() instead.
      if (reservation.source === "daily") {
        await this.usageService.releaseDailySlot(profile.id, input.subjectId, reservation.usageDate).catch(() => undefined);
      } else if (reservation.source === "extra") {
        await this.questionPacks.refundExtraCredit(profile.id, input.subjectId, reservation.usageDate).catch(() => undefined);
      } else {
        await this.releaseFreeTrial(profile.id, input.subjectId);
      }
      if (budgetReservationId) {
        await this.usageService.releaseBudget(budgetReservationId).catch(() => undefined);
      }
      throw err;
    }
  }
}

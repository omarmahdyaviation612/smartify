import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AIProviderFactory } from "../ai/ai-provider.factory";
import { AIContextBuilderService } from "../ai/context/ai-context-builder.service";
import { AIUsageService } from "../ai/usage/ai-usage.service";
import { TutorQuestionPacksService } from "../tutor-question-packs/tutor-question-packs.service";
import { TutorAnswerCacheService } from "./tutor-answer-cache.service";

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

  async getRemainingToday(userId: string, subjectId: string) {
    const profile = await this.getProfileOrThrow(userId);
    return this.usageService.getRemainingToday(profile.id, subjectId);
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

    // --- Subscription gate (cheap, no cost/slot consumed yet) ---
    // Phase 10 hardening: the AI Tutor previously had NO subscription
    // check at all — any signed-in student with selected subjects could
    // use their free daily allowance regardless of billing status. This
    // closes that gap with a coarse-grained check (any active
    // subscription, since per-subject entitlement isn't modeled beyond
    // "included subjects count" — see 10-phase10-decisions.md for the
    // documented limitation). A finer-grained "is THIS subject covered
    // by the subscription" check is a reasonable follow-up once
    // per-subject entitlement is tracked explicitly.
    const subscription = await this.prisma.client.subscription.findUnique({ where: { studentId: profile.id } });
    if (!subscription || subscription.status !== "active") {
      throw new ForbiddenException("An active subscription is required to use the AI Tutor.");
    }

    // --- Atomic rate-limit reservation (concurrency-safe — see AIUsageService.reserveDailySlot) ---
    const cached = await this.answerCache.find({
      curriculumId: profile.curriculum.id,
      gradeId: profile.grade.id,
      subjectId: input.subjectId,
      topicId: input.topicId,
      language: profile.preferredLang,
      prompt: trimmed,
    });
    if (cached) {
      return this.persistCachedReply(profile.id, input, trimmed, cached.answer);
    }

    const reservation = await this.questionPacks.consumeForTutor(profile.id, input.subjectId);

    try {
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
      if (input.topicId) {
        const topic = await this.prisma.client.topic.findUnique({ where: { id: input.topicId } });
        topicNameEn = topic?.nameEn;
      }

      const systemPrompt = this.contextBuilder.buildTutorSystemPrompt({
        studentFullName: profile.fullName,
        age: profile.age,
        curriculumNameEn: profile.curriculum.nameEn,
        gradeNameEn: profile.grade.nameEn,
        subjectNameEn: subject.nameEn,
        topicNameEn,
        preferredLang: profile.preferredLang as "ar" | "en",
      });

      const { provider, providerKey, model } = await this.providerFactory.getActiveProvider();

      // --- The actual (costly) AI provider call. If this throws, no cost
      // was incurred, and the outer catch below releases the reserved
      // slot (single release point — see its comment for why). ---
      const result = await provider.generate({
        systemPrompt,
        messages: [
          ...priorMessages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
          { role: "user", content: trimmed },
        ],
      });

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

      const remainingAfter = await this.usageService.getRemainingToday(profile.id, input.subjectId);

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
      return {
        conversationId: conversation.id,
        reply: result.content,
        isAiGenerated: true, // surfaced to the frontend so it can badge the message, per the AI-vs-verified-content separation rule
        remainingToday: remainingAfter.remaining,
        dailyLimit: remainingAfter.limit,
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
        await this.usageService.releaseDailySlot(profile.id, input.subjectId).catch(() => undefined);
      } else {
        await this.questionPacks.refundExtraCredit(profile.id, input.subjectId).catch(() => undefined);
      }
      throw err;
    }
  }
}

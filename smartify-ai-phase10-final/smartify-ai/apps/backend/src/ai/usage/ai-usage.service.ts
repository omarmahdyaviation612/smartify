import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AIProviderFactory } from "../ai-provider.factory";

@Injectable()
export class AIUsageService {
  private readonly logger = new Logger(AIUsageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: AIProviderFactory,
  ) {}

  private startOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /**
   * Included daily allowance per subject, per student — the real business
   * rule from pricing (10 AI questions/subject/day by default), read from
   * SystemConfig rather than hardcoded so it's tunable from the Admin Panel.
   */
  private async getDailyLimit(): Promise<number> {
    const config = await this.prisma.client.systemConfig.findUnique({
      where: { key: "default_daily_ai_questions_per_subject" },
    });
    return typeof config?.value === "number" ? config.value : 10;
  }

  /** Read-only view for display (e.g. "N of 10 left today"). NOT the enforcement path — see reserveDailySlot(). */
  async getRemainingToday(studentId: string, subjectId: string): Promise<{ used: number; limit: number; remaining: number }> {
    const limit = await this.getDailyLimit();
    const counter = await this.prisma.client.aIDailyUsageCounter.findUnique({
      where: { studentId_subjectId_usageDate: { studentId, subjectId, usageDate: this.startOfToday() } },
    });
    const used = counter?.count ?? 0;
    return { used, limit, remaining: Math.max(0, limit - used) };
  }

  /**
   * Phase 10 concurrency fix: atomically reserves one slot against the
   * daily per-subject limit BEFORE the AI provider is ever called.
   *
   * This is a single INSERT ... ON CONFLICT ... WHERE ... RETURNING
   * statement — Postgres executes it as one atomic operation, so two
   * concurrent requests racing for the last remaining slot cannot both
   * succeed (whichever transaction commits second sees the already-
   * incremented count and its WHERE clause fails to match, so its
   * RETURNING produces no row). This replaces the previous
   * count-then-compare-then-insert sequence, which had a real TOCTOU
   * race window between the read and the write.
   *
   * Returns { reserved: false } if the limit was already reached — by
   * this request or a concurrent one — with no side effect in that case.
   */
  async reserveDailySlot(studentId: string, subjectId: string): Promise<{ reserved: boolean; limit: number }> {
    const limit = await this.getDailyLimit();
    const usageDate = this.startOfToday();

    const rows = await this.prisma.client.$queryRaw<Array<{ count: number }>>`
      INSERT INTO "AIDailyUsageCounter" ("id", "studentId", "subjectId", "usageDate", "count", "updatedAt")
      VALUES (gen_random_uuid()::text, ${studentId}, ${subjectId}, ${usageDate}, 1, now())
      ON CONFLICT ("studentId", "subjectId", "usageDate")
      DO UPDATE SET "count" = "AIDailyUsageCounter"."count" + 1, "updatedAt" = now()
      WHERE "AIDailyUsageCounter"."count" < ${limit}
      RETURNING "count";
    `;

    return { reserved: rows.length > 0, limit };
  }

  /**
   * Gives back a reserved slot when the reservation turns out to be
   * unusable — e.g. the AI provider call itself failed after the slot
   * was reserved. Without this, a failed request would still cost the
   * student one of their daily questions for nothing.
   */
  async releaseDailySlot(studentId: string, subjectId: string): Promise<void> {
    const usageDate = this.startOfToday();
    await this.prisma.client.$executeRaw`
      UPDATE "AIDailyUsageCounter"
      SET "count" = GREATEST("count" - 1, 0), "updatedAt" = now()
      WHERE "studentId" = ${studentId} AND "subjectId" = ${subjectId} AND "usageDate" = ${usageDate};
    `;
  }

  /**
   * Builds the AIUsage ledger row's data (cost computed from the
   * provider's real token counts, not an estimate) without writing it —
   * callers compose this into their own transaction alongside whatever
   * else must succeed atomically (e.g. persisting the tutor's chat
   * messages), so a partial-write state (messages saved, cost not
   * logged, or vice versa) can't happen.
   */
  async buildUsageRow(params: {
    userId: string;
    studentId: string;
    subjectId: string;
    providerKey: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    /** Defaults to "tutor_chat". The Interactive Lesson engine logs "lesson_chat" instead, so lesson vs. free-form Tutor spend is visible separately in the ledger. */
    feature?: string;
    /**
     * Defaults to 1 (one Tutor question consumed), matching the free-form
     * Tutor's per-message accounting. The Interactive Lesson engine passes
     * 0 here for every individual teaching turn — entitlement for a lesson
     * is reserved ONCE at session start (see LessonSessionService), not
     * per AI turn, so per-turn rows must not double-count quota.
     */
    creditsUsed?: number;
  }): Promise<{
    userId: string;
    studentId: string;
    subjectId: string;
    feature: string;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    creditsUsed: number;
    costUsd: number;
  }> {
    const rates = await this.providerFactory.getCostRates(params.providerKey);
    const costUsd = params.inputTokens * rates.costPerInputToken + params.outputTokens * rates.costPerOutputToken;

    return {
      userId: params.userId,
      studentId: params.studentId,
      subjectId: params.subjectId,
      feature: params.feature ?? "tutor_chat",
      provider: params.providerKey,
      model: params.model,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      creditsUsed: params.creditsUsed ?? 1,
      costUsd,
    };
  }

  /**
   * Both budget caps are optional SystemConfig keys, following the exact
   * same "generic key-value store, admin-tunable, absent = disabled"
   * pattern already used for default_daily_ai_questions_per_subject. When
   * neither key is set (the default), this is a no-op and behavior is
   * unchanged from before this pass.
   */
  private async getGlobalDailyBudgetUsd(): Promise<number | null> {
    const config = await this.prisma.client.systemConfig.findUnique({ where: { key: "global_daily_ai_budget_usd" } });
    return typeof config?.value === "number" ? config.value : null;
  }

  private async getPerUserDailyBudgetUsd(): Promise<number | null> {
    const config = await this.prisma.client.systemConfig.findUnique({ where: { key: "per_user_daily_ai_budget_usd" } });
    return typeof config?.value === "number" ? config.value : null;
  }

  async getGlobalSpendToday(): Promise<number> {
    const result = await this.prisma.client.aIUsage.aggregate({
      where: { createdAt: { gte: this.startOfToday() } },
      _sum: { costUsd: true },
    });
    return Number(result._sum.costUsd ?? 0);
  }

  async getUserSpendToday(userId: string): Promise<number> {
    const result = await this.prisma.client.aIUsage.aggregate({
      where: { userId, createdAt: { gte: this.startOfToday() } },
      _sum: { costUsd: true },
    });
    return Number(result._sum.costUsd ?? 0);
  }

  /**
   * Circuit breaker for real OpenAI spend (chat + TTS both log to AIUsage,
   * so a single aggregate covers both). Checked BEFORE any quota slot is
   * reserved and before any provider call is made — the same "cheap check
   * first" placement as the message-length cap in TutorService — so a
   * tripped budget never consumes a student's question or TTS generation;
   * there is nothing to release because nothing was ever reserved.
   */
  async assertWithinBudget(userId: string): Promise<void> {
    const [globalLimit, userLimit] = await Promise.all([
      this.getGlobalDailyBudgetUsd(),
      this.getPerUserDailyBudgetUsd(),
    ]);
    if (globalLimit !== null) {
      const spent = await this.getGlobalSpendToday();
      if (spent >= globalLimit) {
        this.logger.warn(
          `Global daily AI budget reached: $${spent.toFixed(4)} spent >= $${globalLimit} limit. Rejecting further AI requests until the daily window resets.`,
        );
        throw new ServiceUnavailableException(
          "The AI Tutor is temporarily unavailable due to daily usage limits. Please try again later.",
        );
      }
    }
    if (userLimit !== null) {
      const spent = await this.getUserSpendToday(userId);
      if (spent >= userLimit) {
        this.logger.warn(`Per-user daily AI budget reached for user ${userId}: $${spent.toFixed(4)} spent >= $${userLimit} limit.`);
        throw new ServiceUnavailableException("You've reached today's AI usage limit. Please try again tomorrow.");
      }
    }
  }

  /**
   * Failure-safe fallback: if the transaction that should have recorded
   * real, already-incurred AI cost fails for some reason (DB hiccup),
   * the cost must not simply vanish — it's logged at error level with
   * every detail needed for manual reconciliation, since silently losing
   * track of billable usage is exactly the failure mode this phase was
   * asked to close.
   */
  logUntrackedUsage(params: Record<string, unknown>, error: unknown) {
    this.logger.error(
      `CRITICAL: AI usage occurred but could not be recorded to the database. Manual reconciliation required. Details: ${JSON.stringify(params)}`,
      error instanceof Error ? error.stack : String(error),
    );
  }
}

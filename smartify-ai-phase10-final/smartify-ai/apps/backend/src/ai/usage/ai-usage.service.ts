import { Injectable, Logger } from "@nestjs/common";
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
      feature: "tutor_chat",
      provider: params.providerKey,
      model: params.model,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      creditsUsed: 1,
      costUsd,
    };
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

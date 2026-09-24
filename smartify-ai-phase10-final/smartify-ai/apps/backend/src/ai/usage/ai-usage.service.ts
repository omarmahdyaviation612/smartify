import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AIProviderFactory } from "../ai-provider.factory";
import { GLOBAL_DAILY_AI_BUDGET_USD_KEY, PER_USER_DAILY_AI_BUDGET_USD_KEY, parseBudgetUsd } from "./budget-config.util";

// Phase 9.4C: conservative chars-per-token divisor for estimating input
// cost BEFORE a chat call — real English averages ~4 chars/token, so
// dividing by 3 deliberately over-estimates token count (errs safely
// high, never low). DEFAULT_MAX_OUTPUT_TOKENS mirrors the provider-side
// ceiling every chat call site already relies on (openai.provider.ts:
// `max_tokens: request.maxOutputTokens ?? 600`) — output can never
// exceed this, so it's a true worst-case bound, not a guess.
const CHARS_PER_TOKEN_CONSERVATIVE = 3;
const DEFAULT_MAX_OUTPUT_TOKENS = 600;

export type ReserveBudgetResult =
  | { ok: true; reservationId: string }
  | { ok: false; reason: "misconfigured" | "global_exceeded" | "user_exceeded" };

@Injectable()
export class AIUsageService {
  private readonly logger = new Logger(AIUsageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: AIProviderFactory,
  ) {}

  private startOfToday(): Date {
    const d = new Date();
    // Daily AI allowances and budgets reset at 00:00 UTC on every host.
    d.setUTCHours(0, 0, 0, 0);
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
  async getRemainingToday(studentId: string, subjectId: string, usageDate = this.startOfToday()): Promise<{ used: number; limit: number; remaining: number }> {
    const limit = await this.getDailyLimit();
    const counter = await this.prisma.client.aIDailyUsageCounter.findUnique({
      where: { studentId_subjectId_usageDate: { studentId, subjectId, usageDate } },
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
  async reserveDailySlot(studentId: string, subjectId: string, usageDate = this.startOfToday()): Promise<{ reserved: boolean; limit: number }> {
    const limit = await this.getDailyLimit();

    // Prisma ORM stores DateTime as UTC in timestamp WITHOUT time zone.
    // A raw Date binds as timestamptz and PostgreSQL otherwise converts it
    // through the session timezone. ISO text ::timestamp preserves UTC fields.
    const rows = await this.prisma.client.$queryRaw<Array<{ count: number }>>`
      INSERT INTO "AIDailyUsageCounter" ("id", "studentId", "subjectId", "usageDate", "count", "updatedAt")
      VALUES (gen_random_uuid()::text, ${studentId}, ${subjectId}, ${usageDate.toISOString()}::timestamp, 1, now())
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
  async releaseDailySlot(studentId: string, subjectId: string, usageDate = this.startOfToday()): Promise<void> {
    await this.prisma.client.$executeRaw`
      UPDATE "AIDailyUsageCounter"
      SET "count" = GREATEST("count" - 1, 0), "updatedAt" = now()
      WHERE "studentId" = ${studentId} AND "subjectId" = ${subjectId} AND "usageDate" = ${usageDate.toISOString()}::timestamp;
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
   * Phase 9.4: unlike getDailyLimit() (which safely defaults to 10 when
   * unset), a USD budget has no safe application-level default — it must
   * come from a real, validated SystemConfig row, or the caller fails
   * closed (see assertWithinBudget). "Not configured" covers a missing
   * row AND a present-but-invalid value (non-number, NaN, Infinity, zero,
   * negative) identically — parseBudgetUsd is the single source of truth
   * for what counts as valid, shared with AdminAIConfigService so the
   * admin screen and the breaker can never disagree.
   */
  private async getGlobalDailyBudgetUsd(): Promise<number | null> {
    const config = await this.prisma.client.systemConfig.findUnique({ where: { key: GLOBAL_DAILY_AI_BUDGET_USD_KEY } });
    return parseBudgetUsd(config?.value);
  }

  private async getPerUserDailyBudgetUsd(): Promise<number | null> {
    const config = await this.prisma.client.systemConfig.findUnique({ where: { key: PER_USER_DAILY_AI_BUDGET_USD_KEY } });
    return parseBudgetUsd(config?.value);
  }

  async getGlobalSpendToday(usageDate = this.startOfToday()): Promise<number> {
    const result = await this.prisma.client.aIUsage.aggregate({
      where: { createdAt: { gte: usageDate } },
      _sum: { costUsd: true },
    });
    return Number(result._sum.costUsd ?? 0);
  }

  /**
   * Phase 9.4D, Objective 3: read-only admin visibility into the LIVE
   * enforcement-relevant total — what reserveBudget() itself checks
   * against the global cap, including money currently reserved for an
   * in-flight request that hasn't reconciled yet. Deliberately distinct
   * from getGlobalSpendToday() (which sums only real, ALREADY-COMPLETED
   * AIUsage rows) — the two numbers can legitimately differ while
   * requests are in flight, and both are useful: this one for "what
   * would the very next request be checked against", that one for
   * "what has actually been billed so far".
   */
  async getGlobalCommittedUsdToday(): Promise<number> {
    const rows = await this.prisma.client.$queryRaw<Array<{ committedUsd: unknown }>>`
      SELECT "committedUsd" FROM "AIDailyBudgetCounter"
      WHERE "scope" = 'global' AND "scopeKey" = 'global' AND "usageDate" = ${this.startOfToday().toISOString()}::timestamp;
    `;
    return rows.length > 0 ? Number(rows[0].committedUsd) : 0;
  }

  async getUserSpendToday(userId: string, usageDate = this.startOfToday()): Promise<number> {
    const result = await this.prisma.client.aIUsage.aggregate({
      where: { userId, createdAt: { gte: usageDate } },
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
   *
   * Phase 9.4: both caps are now MANDATORY, not optional. Earlier, a
   * missing SystemConfig row meant "no check" (silently unlimited spend)
   * — the exact dormant-breaker problem this phase closes. Now a missing
   * or invalid row fails closed (blocks the request) with a distinct
   * error-level log, so a misconfigured budget is loud (an ops problem to
   * fix) rather than a silent hole that only shows up as a surprise bill.
   * This is a deliberate behavior change from the previous "absent =
   * disabled" pattern — see budget-config.util.ts.
   */
  async assertWithinBudget(userId: string): Promise<void> {
    const usageDate = this.startOfToday();
    const globalLimit = await this.getGlobalDailyBudgetUsd();
    if (globalLimit === null) {
      this.logger.error(
        `AI budget misconfiguration: "${GLOBAL_DAILY_AI_BUDGET_USD_KEY}" is missing or invalid in SystemConfig. Blocking all AI requests until a SUPER_ADMIN sets a valid value via PATCH /admin/ai-config/spending-controls.`,
      );
      throw new ServiceUnavailableException(
        "The AI Tutor is temporarily unavailable. Please try again later.",
      );
    }
    const globalSpent = await this.getGlobalSpendToday(usageDate);
    if (globalSpent >= globalLimit) {
      this.logger.warn(
        `Global daily AI budget reached: $${globalSpent.toFixed(4)} spent >= $${globalLimit} limit. Rejecting further AI requests until the daily window resets.`,
      );
      throw new ServiceUnavailableException(
        "The AI Tutor is temporarily unavailable due to daily usage limits. Please try again later.",
      );
    }

    const userLimit = await this.getPerUserDailyBudgetUsd();
    if (userLimit === null) {
      this.logger.error(
        `AI budget misconfiguration: "${PER_USER_DAILY_AI_BUDGET_USD_KEY}" is missing or invalid in SystemConfig. Blocking all AI requests until a SUPER_ADMIN sets a valid value via PATCH /admin/ai-config/spending-controls.`,
      );
      throw new ServiceUnavailableException(
        "The AI Tutor is temporarily unavailable. Please try again later.",
      );
    }
    const userSpent = await this.getUserSpendToday(userId, usageDate);
    if (userSpent >= userLimit) {
      this.logger.warn(`Per-user daily AI budget reached for user ${userId}: $${userSpent.toFixed(4)} spent >= $${userLimit} limit.`);
      throw new ServiceUnavailableException("You've reached today's AI usage limit. Please try again tomorrow.");
    }
  }

  /**
   * Phase 9.4C: conservative worst-case USD cost of a chat call, computable
   * entirely BEFORE the provider is invoked — real input length is known
   * (the system prompt + conversation history are already built by the
   * time this is called) and real output is capped by DEFAULT_MAX_OUTPUT_TOKENS
   * (or an explicit override), so this is a true ceiling, not a guess that
   * could come in low.
   */
  async estimateMaxChatCostUsd(params: { providerKey: string; inputText: string; maxOutputTokens?: number; estimatedInputTokens?: number }): Promise<number> {
    const rates = await this.providerFactory.getCostRates(params.providerKey);
    const estimatedInputTokens = params.estimatedInputTokens ?? Math.ceil(params.inputText.length / CHARS_PER_TOKEN_CONSERVATIVE);
    if (!Number.isSafeInteger(estimatedInputTokens) || estimatedInputTokens < 0) throw new Error("Invalid input token estimate");
    const maxOutputTokens = params.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    return estimatedInputTokens * rates.costPerInputToken + maxOutputTokens * rates.costPerOutputToken;
  }

  /**
   * Phase 9.4D: the one atomic primitive reserveBudget() composes twice
   * (once for the global row, once for the per-user row) — extracted so
   * it can be exercised directly, against fully test-isolated
   * scope/scopeKey values, by a real-PostgreSQL integration test (see
   * ai-budget-reservation.postgres.spec.ts) without ever touching the
   * real 'global'/'global' row or any real user's row. reserveBudget()
   * itself always calls this with the real literal scope values below;
   * `scope`/`scopeKey` are parameters purely for that test-isolation
   * purpose, not a runtime configuration point.
   *
   * Two statements, not one — a real PostgreSQL bug found via that same
   * integration test: a single `INSERT ... ON CONFLICT ... WHERE`
   * applies its WHERE clause ONLY to the DO UPDATE (conflict) branch, so
   * a brand-new row's very first reservation attempt was previously
   * inserted UNCONDITIONALLY — bypassing the limit entirely whenever
   * that lone attempt's estimatedUsd alone already exceeded it. Step 1
   * (INSERT ... ON CONFLICT DO NOTHING) idempotently guarantees the row
   * exists — safe under concurrency, since Postgres resolves a race on
   * this exact statement to exactly one real insert and any number of
   * silent no-ops, never an error. Step 2 is then ALWAYS an UPDATE
   * against an existing row, so its WHERE clause is never skipped, and
   * Postgres's row-level lock on UPDATE serializes concurrent attempts
   * exactly as the original single-statement version did — the
   * atomicity guarantee is unchanged, only the "first ever attempt"
   * bypass is closed.
   */
  private async attemptReservation(scope: string, scopeKey: string, usageDate: Date, estimatedUsd: number, limit: number): Promise<boolean> {
    await this.prisma.client.$executeRaw`
      INSERT INTO "AIDailyBudgetCounter" ("id", "scope", "scopeKey", "usageDate", "committedUsd", "updatedAt")
      VALUES (gen_random_uuid()::text, ${scope}, ${scopeKey}, ${usageDate.toISOString()}::timestamp, 0, now())
      ON CONFLICT ("scope", "scopeKey", "usageDate") DO NOTHING;
    `;
    const rows = await this.prisma.client.$queryRaw<Array<{ committedUsd: unknown }>>`
      UPDATE "AIDailyBudgetCounter"
      SET "committedUsd" = "committedUsd" + ${estimatedUsd}, "updatedAt" = now()
      WHERE "scope" = ${scope} AND "scopeKey" = ${scopeKey} AND "usageDate" = ${usageDate.toISOString()}::timestamp
        AND "committedUsd" + ${estimatedUsd} <= ${limit}
      RETURNING "committedUsd";
    `;
    return rows.length > 0;
  }

  /** Same test-isolation rationale as attemptReservation — the sibling primitive for rolling back/adjusting one row. */
  private async adjustCounterRow(scope: string, scopeKey: string, usageDate: Date, deltaUsd: number): Promise<void> {
    if (deltaUsd === 0) return;
    await this.prisma.client.$executeRaw`
      UPDATE "AIDailyBudgetCounter"
      SET "committedUsd" = GREATEST("committedUsd" + ${deltaUsd}, 0), "updatedAt" = now()
      WHERE "scope" = ${scope} AND "scopeKey" = ${scopeKey} AND "usageDate" = ${usageDate.toISOString()}::timestamp;
    `;
  }

  private async adjustBudgetCounters(userId: string, usageDate: Date, deltaUsd: number): Promise<void> {
    await this.adjustCounterRow("global", "global", usageDate, deltaUsd);
    await this.adjustCounterRow("user", userId, usageDate, deltaUsd);
  }

  /**
   * Phase 9.4C: the REAL, atomic, cross-process-safe circuit breaker —
   * closes the race assertWithinBudget cannot (see its own docstring and
   * the Phase 9.4B concurrency tests): two concurrent requests can no
   * longer both pass, because this atomically commits `estimatedUsd`
   * against BOTH a global and a per-user daily accumulator row using the
   * exact same "INSERT ... ON CONFLICT ... WHERE ... RETURNING" trick
   * reserveDailySlot() already uses for the daily question count — the
   * UNIQUE constraint on (scope, scopeKey, usageDate) forces Postgres to
   * serialize concurrent attempts on the same row, so the WHERE clause is
   * always evaluated against a fresh, post-lock value, never a stale read.
   *
   * Call this immediately before the provider call (assertWithinBudget
   * stays where it is, unchanged, as a cheap early fail-fast check before
   * quota/trial resources are consumed — this is the authoritative gate).
   * On success, the caller MUST eventually call exactly one of
   * reconcileBudget()/releaseBudget() with the returned reservationId.
   */
  async reserveBudget(userId: string, estimatedUsd: number): Promise<ReserveBudgetResult> {
    if (!Number.isFinite(estimatedUsd) || estimatedUsd <= 0) {
      throw new Error(`reserveBudget called with an invalid estimatedUsd: ${estimatedUsd}`);
    }

    const usageDate = this.startOfToday();
    const [globalLimit, userLimit] = await Promise.all([this.getGlobalDailyBudgetUsd(), this.getPerUserDailyBudgetUsd()]);
    if (globalLimit === null || userLimit === null) {
      this.logger.error(
        `AI budget misconfiguration: cannot reserve — "${GLOBAL_DAILY_AI_BUDGET_USD_KEY}" or "${PER_USER_DAILY_AI_BUDGET_USD_KEY}" is missing or invalid in SystemConfig.`,
      );
      return { ok: false, reason: "misconfigured" };
    }

    const globalOk = await this.attemptReservation("global", "global", usageDate, estimatedUsd, globalLimit);
    if (!globalOk) {
      this.logger.warn(
        `Global AI budget reservation blocked before provider call: an estimated $${estimatedUsd.toFixed(6)} would exceed the $${globalLimit} daily cap.`,
      );
      return { ok: false, reason: "global_exceeded" };
    }

    const userOk = await this.attemptReservation("user", userId, usageDate, estimatedUsd, userLimit);
    if (!userOk) {
      // The global slice was already committed above, but the per-user
      // slice never was (this attempt's WHERE clause is what just failed)
      // — roll back ONLY the global row. adjustBudgetCounters() would
      // incorrectly also decrement the user's row by estimatedUsd,
      // wrongly cancelling out that user's OTHER, unrelated committed
      // reservations for today.
      await this.adjustCounterRow("global", "global", usageDate, -estimatedUsd);
      this.logger.warn(
        `Per-user AI budget reservation blocked before provider call for user ${userId}: an estimated $${estimatedUsd.toFixed(6)} would exceed the $${userLimit} daily cap. Global reservation released.`,
      );
      return { ok: false, reason: "user_exceeded" };
    }

    const reservation = await this.prisma.client.aIBudgetReservation.create({
      data: { userId, usageDate, estimatedUsd, status: "RESERVED" },
    });

    // Phase 9.4D, Objective 3: distinguishes "estimated reserved" from
    // "actual reconciled" from "released" in the logs — never message
    // content, never secrets, only ids and dollar amounts.
    this.logger.log(`AI budget RESERVED: reservation ${reservation.id} for user ${userId}, estimated $${estimatedUsd.toFixed(6)}.`);

    return { ok: true, reservationId: reservation.id };
  }

  /**
   * Reconciles a RESERVED reservation to the real, now-known cost — moves
   * both accumulator rows by (actualUsd - estimatedUsd), which is usually
   * negative (the real call finished well under the worst-case ceiling)
   * and releases the difference automatically. GREATEST(...,0) in
   * adjustBudgetCounters means this can never drive an accumulator
   * negative even under a large downward correction. The status
   * transition is the idempotency guard (Objective 4): a reservation not
   * currently RESERVED (already reconciled, already released, or an
   * unknown id) matches zero rows and this is a safe, logged no-op — it
   * never double-adjusts the accumulators and never throws for a caller
   * that retries.
   */
  async reconcileBudget(reservationId: string, actualUsd: number): Promise<void> {
    const safeActualUsd = Number.isFinite(actualUsd) && actualUsd >= 0 ? actualUsd : 0;

    const rows = await this.prisma.client.$queryRaw<Array<{ userId: string; usageDate: Date; estimatedUsd: unknown }>>`
      UPDATE "AIBudgetReservation"
      SET "status" = 'RECONCILED', "reconciledUsd" = ${safeActualUsd}, "updatedAt" = now()
      WHERE "id" = ${reservationId} AND "status" = 'RESERVED'
      RETURNING "userId", "usageDate", "estimatedUsd";
    `;
    if (rows.length === 0) {
      this.logger.debug(`reconcileBudget: reservation ${reservationId} was not RESERVED (already handled, or unknown) — no-op.`);
      return;
    }

    const [{ userId, usageDate, estimatedUsd }] = rows;
    const delta = safeActualUsd - Number(estimatedUsd);
    try {
      await this.adjustBudgetCounters(userId, usageDate, delta);
      // Phase 9.4D, Objective 3: the reservation row's status transition
      // (above) already succeeded by this point — this log marks the
      // accumulator delta as ALSO applied, so "reconciled" in the logs
      // always means both halves completed, not just the status flip.
      this.logger.log(
        `AI budget RECONCILED: reservation ${reservationId} for user ${userId}, estimated $${Number(estimatedUsd).toFixed(6)} -> actual $${safeActualUsd.toFixed(6)}.`,
      );
    } catch (err) {
      // The reservation is now permanently RECONCILED (a terminal status —
      // it can never be reconciled or released again), but the accumulator
      // delta failed to apply: the daily total may now over-count by
      // (estimatedUsd - actualUsd) until the day rolls over. This must
      // never be silent — logged at error level with everything needed
      // for manual correction, same philosophy as logUntrackedUsage.
      this.logger.error(
        `CRITICAL: AI budget reconciliation failure — reservation ${reservationId} (user ${userId}) was marked RECONCILED but its accumulator adjustment (delta $${delta.toFixed(6)}) failed to apply. Manual correction to AIDailyBudgetCounter may be required.`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /**
   * Releases a RESERVED reservation in full — used when the provider call
   * itself fails, so a failed request never permanently consumes budget
   * (Objective 2, requirement: "A failed provider request [must not]
   * consume permanent budget"). Same idempotent status-transition guard
   * as reconcileBudget: releasing twice, or releasing an already-
   * reconciled reservation, is a safe no-op.
   */
  async releaseBudget(reservationId: string): Promise<void> {
    const rows = await this.prisma.client.$queryRaw<Array<{ userId: string; usageDate: Date; estimatedUsd: unknown }>>`
      UPDATE "AIBudgetReservation"
      SET "status" = 'RELEASED', "updatedAt" = now()
      WHERE "id" = ${reservationId} AND "status" = 'RESERVED'
      RETURNING "userId", "usageDate", "estimatedUsd";
    `;
    if (rows.length === 0) {
      this.logger.debug(`releaseBudget: reservation ${reservationId} was not RESERVED (already handled, or unknown) — no-op.`);
      return;
    }

    const [{ userId, usageDate, estimatedUsd }] = rows;
    try {
      await this.adjustBudgetCounters(userId, usageDate, -Number(estimatedUsd));
      // Phase 9.4D, Objective 3: distinguishes "released" (provider
      // failure, budget given back) from "reconciled" (provider
      // succeeded, budget corrected to actual) in the logs.
      this.logger.log(`AI budget RELEASED: reservation ${reservationId} for user ${userId}, $${Number(estimatedUsd).toFixed(6)} returned (provider call did not complete).`);
    } catch (err) {
      // Same rationale as reconcileBudget's catch: the reservation is now
      // terminally RELEASED, but if the accumulator decrement itself
      // failed, the daily total may over-count until the day rolls over.
      this.logger.error(
        `CRITICAL: AI budget release failure — reservation ${reservationId} (user ${userId}) was marked RELEASED but its accumulator adjustment (-$${Number(estimatedUsd).toFixed(6)}) failed to apply. Manual correction to AIDailyBudgetCounter may be required.`,
        err instanceof Error ? err.stack : String(err),
      );
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

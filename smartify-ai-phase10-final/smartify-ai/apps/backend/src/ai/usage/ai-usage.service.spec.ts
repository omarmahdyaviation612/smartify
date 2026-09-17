import { ServiceUnavailableException } from "@nestjs/common";
import { AIUsageService } from "./ai-usage.service";

/**
 * Covers the daily per-subject question limit — the real business rule
 * from Phase 3/6 pricing ("10 AI questions per subject per day") — with
 * a mocked Prisma client, so this runs without a real database.
 *
 * Phase 10 addition: reserveDailySlot/releaseDailySlot tests cover the
 * concurrency-safe atomic reservation path added to close the
 * read-then-write race identified in the Phase 10 acceptance review.
 * These tests verify the DECISION LOGIC (what happens when the raw SQL
 * returns 0 vs 1 rows) since Jest against a mocked Prisma client cannot
 * exercise real Postgres-level atomicity — that guarantee comes from
 * Postgres itself executing a single INSERT...ON CONFLICT...WHERE
 * statement, which is exactly why the implementation uses raw SQL for
 * this specific operation rather than separate read+write calls.
 */
describe("AIUsageService", () => {
  function makeService(opts: {
    usedToday?: number;
    configuredLimit?: number;
    queryRawRows?: Array<{ count: number }>;
    globalBudget?: number;
    perUserBudget?: number;
    globalSpend?: number;
    userSpend?: number;
  }) {
    const systemConfigValues: Record<string, number> = {};
    if (opts.configuredLimit !== undefined) systemConfigValues.default_daily_ai_questions_per_subject = opts.configuredLimit;
    if (opts.globalBudget !== undefined) systemConfigValues.global_daily_ai_budget_usd = opts.globalBudget;
    if (opts.perUserBudget !== undefined) systemConfigValues.per_user_daily_ai_budget_usd = opts.perUserBudget;

    const prisma = {
      client: {
        systemConfig: {
          findUnique: jest.fn().mockImplementation(({ where: { key } }: any) =>
            Promise.resolve(key in systemConfigValues ? { value: systemConfigValues[key] } : null),
          ),
        },
        aIDailyUsageCounter: {
          findUnique: jest.fn().mockResolvedValue(
            opts.usedToday === undefined ? null : { count: opts.usedToday },
          ),
        },
        $queryRaw: jest.fn().mockResolvedValue(opts.queryRawRows ?? [{ count: 1 }]),
        $executeRaw: jest.fn().mockResolvedValue(1),
        aIUsage: {
          aggregate: jest.fn().mockImplementation(({ where }: any) =>
            Promise.resolve({ _sum: { costUsd: where?.userId ? opts.userSpend ?? 0 : opts.globalSpend ?? 0 } }),
          ),
        },
      },
    } as any;
    const providerFactory = {
      getCostRates: jest.fn().mockResolvedValue({ costPerInputToken: 0.00000015, costPerOutputToken: 0.0000006 }),
    } as any;
    return { service: new AIUsageService(prisma, providerFactory), prisma };
  }

  describe("getRemainingToday (display path)", () => {
    it("falls back to a default of 10 when SystemConfig has no configured limit", async () => {
      const { service } = makeService({ usedToday: 0 });
      const result = await service.getRemainingToday("student-1", "subject-1");
      expect(result.limit).toBe(10);
      expect(result.remaining).toBe(10);
    });

    it("uses the admin-configured limit when SystemConfig has one", async () => {
      const { service } = makeService({ usedToday: 0, configuredLimit: 25 });
      const result = await service.getRemainingToday("student-1", "subject-1");
      expect(result.limit).toBe(25);
    });

    it("computes remaining as limit minus today's counter value", async () => {
      const { service } = makeService({ usedToday: 7, configuredLimit: 10 });
      const result = await service.getRemainingToday("student-1", "subject-1");
      expect(result.used).toBe(7);
      expect(result.remaining).toBe(3);
    });

    it("never returns a negative remaining count, even if usage somehow exceeds the limit", async () => {
      const { service } = makeService({ usedToday: 15, configuredLimit: 10 });
      const result = await service.getRemainingToday("student-1", "subject-1");
      expect(result.remaining).toBe(0);
    });
  });

  describe("reserveDailySlot (enforcement path — concurrency-critical)", () => {
    it("reports reserved=true when the atomic upsert returns a row (slot available)", async () => {
      const { service } = makeService({ configuredLimit: 10, queryRawRows: [{ count: 4 }] });
      const result = await service.reserveDailySlot("student-1", "subject-1");
      expect(result.reserved).toBe(true);
      expect(result.limit).toBe(10);
    });

    it("reports reserved=false when the atomic upsert's WHERE clause excludes the row (limit already hit)", async () => {
      // Simulates Postgres: the WHERE count < limit clause matched no row,
      // so the INSERT...ON CONFLICT...DO UPDATE...RETURNING produced
      // zero rows — this is exactly what happens when a concurrent
      // request already consumed the last slot.
      const { service } = makeService({ configuredLimit: 10, queryRawRows: [] });
      const result = await service.reserveDailySlot("student-1", "subject-1");
      expect(result.reserved).toBe(false);
    });

    it("passes the admin-configured limit into the atomic query, not a hardcoded value", async () => {
      const { service, prisma } = makeService({ configuredLimit: 3, queryRawRows: [{ count: 1 }] });
      await service.reserveDailySlot("student-1", "subject-1");
      // The mocked $queryRaw doesn't let us easily inspect bound params
      // from a tagged template, but we can confirm systemConfig was
      // consulted (i.e. the limit wasn't hardcoded to 10 regardless).
      expect(prisma.client.systemConfig.findUnique).toHaveBeenCalled();
    });
  });

  describe("releaseDailySlot", () => {
    it("issues a decrement against the counter table", async () => {
      const { service, prisma } = makeService({});
      await service.releaseDailySlot("student-1", "subject-1");
      expect(prisma.client.$executeRaw).toHaveBeenCalled();
    });
  });

  describe("assertWithinBudget (circuit breaker — Phase 10 cost control, activated Phase 9.4)", () => {
    it("Phase 9.4 (test 3): throws ServiceUnavailableException when the global budget is not configured at all — never silently unlimited", async () => {
      const { service } = makeService({ perUserBudget: 5, userSpend: 0 });
      await expect(service.assertWithinBudget("user-1")).rejects.toThrow(ServiceUnavailableException);
    });

    it("Phase 9.4 (test 4): throws ServiceUnavailableException when the per-user budget is not configured at all, even though the global budget is valid", async () => {
      const { service } = makeService({ globalBudget: 100, globalSpend: 0 });
      await expect(service.assertWithinBudget("user-1")).rejects.toThrow(ServiceUnavailableException);
    });

    it("Phase 9.4 (test 3+4): both missing is blocked, not a no-op — the pre-9.4 'unlimited when absent' behavior is gone", async () => {
      const { service } = makeService({});
      await expect(service.assertWithinBudget("user-1")).rejects.toThrow(ServiceUnavailableException);
    });

    it.each([
      ["a string", "20" as any],
      ["NaN", NaN],
      ["Infinity", Infinity],
      ["-Infinity", -Infinity],
      ["zero", 0],
      ["a negative number", -5],
      ["null", null as any],
    ])("Phase 9.4 (test 5/6): a malformed global budget (%s) fails safely, identically to a missing one", async (_label, malformed) => {
      const { service } = makeService({ globalBudget: malformed, perUserBudget: 5, userSpend: 0 });
      await expect(service.assertWithinBudget("user-1")).rejects.toThrow(ServiceUnavailableException);
    });

    it.each([
      ["a string", "5" as any],
      ["NaN", NaN],
      ["Infinity", Infinity],
      ["zero", 0],
      ["a negative number", -1],
    ])("Phase 9.4 (test 5/6): a malformed per-user budget (%s) fails safely, identically to a missing one", async (_label, malformed) => {
      const { service } = makeService({ globalBudget: 100, globalSpend: 0, perUserBudget: malformed });
      await expect(service.assertWithinBudget("user-1")).rejects.toThrow(ServiceUnavailableException);
    });

    it("Phase 9.4 (test 9): does not throw when both budgets are validly configured and spend is below both", async () => {
      const { service } = makeService({ globalBudget: 10, perUserBudget: 2, globalSpend: 5, userSpend: 0.5 });
      await expect(service.assertWithinBudget("user-1")).resolves.toBeUndefined();
    });

    it("Phase 9.4 (test 7): throws ServiceUnavailableException when today's global spend has reached the configured global daily budget", async () => {
      const { service } = makeService({ globalBudget: 10, perUserBudget: 5, globalSpend: 10 });
      await expect(service.assertWithinBudget("user-1")).rejects.toThrow(ServiceUnavailableException);
    });

    it("throws ServiceUnavailableException when today's global spend has exceeded the configured global daily budget", async () => {
      const { service } = makeService({ globalBudget: 10, perUserBudget: 5, globalSpend: 15 });
      await expect(service.assertWithinBudget("user-1")).rejects.toThrow(ServiceUnavailableException);
    });

    it("Phase 9.4 (test 8): throws ServiceUnavailableException when this user's own spend has reached the configured per-user daily budget, even though the global budget is fine", async () => {
      const { service } = makeService({ globalBudget: 100, globalSpend: 1, perUserBudget: 1, userSpend: 1 });
      await expect(service.assertWithinBudget("user-1")).rejects.toThrow(ServiceUnavailableException);
    });

    it("checks the per-user spend for the exact user passed in, not a global aggregate", async () => {
      const { service, prisma } = makeService({ globalBudget: 100, perUserBudget: 5, userSpend: 1 });
      await service.assertWithinBudget("user-42");
      expect(prisma.client.aIUsage.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: "user-42" }) }),
      );
    });

    it("does not query per-user spend when the global check already fails (cheap check first, no wasted work)", async () => {
      const { service, prisma } = makeService({ globalBudget: 10, perUserBudget: 5, globalSpend: 10 });
      await expect(service.assertWithinBudget("user-1")).rejects.toThrow(ServiceUnavailableException);
      expect(prisma.client.aIUsage.aggregate).toHaveBeenCalledTimes(1);
      expect(prisma.client.aIUsage.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.not.objectContaining({ userId: expect.anything() }) }));
    });

    it("Phase 9.4B (B7): a budget change made through admin configuration is honored by the very next check — no caching of the old limit", async () => {
      const { service, prisma } = makeService({ globalBudget: 5, perUserBudget: 5, globalSpend: 4.99 });
      await expect(service.assertWithinBudget("user-1")).resolves.toBeUndefined(); // below the $5 cap

      // Simulate the admin lowering the global budget via updateSpendingControls.
      prisma.client.systemConfig.findUnique.mockImplementation(({ where: { key } }: any) =>
        Promise.resolve(
          key === "global_daily_ai_budget_usd" ? { value: 1 } : key === "per_user_daily_ai_budget_usd" ? { value: 5 } : null,
        ),
      );
      await expect(service.assertWithinBudget("user-1")).rejects.toThrow(ServiceUnavailableException); // $4.99 spent >= new $1 cap
    });
  });

  /**
   * Phase 9.4B, Objective 2: assertWithinBudget is a read-then-later-write
   * check, NOT an atomic reservation like reserveDailySlot. Real USD cost
   * is only known and written to AIUsage AFTER a successful provider call
   * — a network round trip lasting from hundreds of milliseconds to
   * several seconds. Any request that starts its check before another
   * concurrent request's cost has been committed sees the SAME
   * pre-request spend total, so both can pass even when, combined, they
   * would exceed the configured budget. This is confirmed here at the
   * unit level (two "concurrent" assertWithinBudget calls against a
   * mocked aggregate that hasn't moved between them — exactly what real
   * concurrent requests would observe against a real, not-yet-updated
   * AIUsage table) rather than fixed — see the Phase 9.4B final report
   * for why a real fix needs a schema change this phase does not make.
   */
  describe("assertWithinBudget — concurrent-request race (Phase 9.4B Objective 2, documented not fixed)", () => {
    it("two simultaneous requests from the SAME user can both pass the per-user check against the same stale spend total, together exceeding the budget", async () => {
      // Both requests observe $0.20 spent against a $0.25 cap — individually
      // fine, but this user is about to make two $0.10 calls concurrently,
      // which would total $0.40 > $0.25. Neither request's check can see
      // the other's not-yet-committed cost, so both are allowed through.
      const { service } = makeService({ globalBudget: 100, globalSpend: 0, perUserBudget: 0.25, userSpend: 0.2 });
      const [first, second] = await Promise.allSettled([
        service.assertWithinBudget("user-1"),
        service.assertWithinBudget("user-1"),
      ]);
      expect(first.status).toBe("fulfilled");
      expect(second.status).toBe("fulfilled"); // <- the race: a truly atomic check would have blocked this one
    });

    it("two simultaneous requests from DIFFERENT users can both pass the global check against the same stale spend total, together exceeding the global budget", async () => {
      // Both observe $4.90 spent globally against a $5 cap — each is
      // individually within budget, but concurrently they can jointly
      // exceed it, and neither user's own per-user cap catches this
      // because the overspend is on the GLOBAL total, not either
      // individual user's total.
      const { service } = makeService({ globalBudget: 5, globalSpend: 4.9, perUserBudget: 100, userSpend: 0 });
      const [first, second] = await Promise.allSettled([
        service.assertWithinBudget("user-1"),
        service.assertWithinBudget("user-2"),
      ]);
      expect(first.status).toBe("fulfilled");
      expect(second.status).toBe("fulfilled"); // <- same race, on the global total
    });

    it("by contrast, the COUNT-based reservation (reserveDailySlot) is genuinely race-safe under the same concurrent shape — this is what a real USD fix would need to match", async () => {
      // Simulates Postgres: only the FIRST of two concurrent
      // INSERT...ON CONFLICT...WHERE statements can win when the limit is
      // 1 — the second's WHERE clause excludes it. This is real atomicity
      // (enforced by Postgres, not JS), unlike assertWithinBudget above.
      let called = false;
      const { service, prisma } = makeService({ configuredLimit: 1 });
      prisma.client.$queryRaw.mockImplementation(() => {
        if (called) return Promise.resolve([]); // second caller: WHERE count < limit excludes the row
        called = true;
        return Promise.resolve([{ count: 1 }]); // first caller: wins the atomic slot
      });
      const [first, second] = await Promise.all([
        service.reserveDailySlot("student-1", "subject-1"),
        service.reserveDailySlot("student-1", "subject-1"),
      ]);
      const reservedCount = [first, second].filter((r) => r.reserved).length;
      expect(reservedCount).toBe(1); // exactly one winner, unlike the USD race above
    });
  });

  describe("buildUsageRow (cost ledger)", () => {
    it("computes real cost from actual token counts and the provider's per-token rates", async () => {
      const { service } = makeService({});
      const row = await service.buildUsageRow({
        userId: "user-1",
        studentId: "student-1",
        subjectId: "subject-1",
        providerKey: "openai",
        model: "gpt-4o-mini",
        inputTokens: 1000,
        outputTokens: 500,
      });

      const expectedCost = 1000 * 0.00000015 + 500 * 0.0000006;
      expect(row.costUsd).toBeCloseTo(expectedCost, 10);
      expect(row.creditsUsed).toBe(1);
      expect(row.feature).toBe("tutor_chat");
    });
  });
});

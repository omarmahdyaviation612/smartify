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
  }) {
    const prisma = {
      client: {
        systemConfig: {
          findUnique: jest.fn().mockResolvedValue(
            opts.configuredLimit === undefined ? null : { value: opts.configuredLimit },
          ),
        },
        aIDailyUsageCounter: {
          findUnique: jest.fn().mockResolvedValue(
            opts.usedToday === undefined ? null : { count: opts.usedToday },
          ),
        },
        $queryRaw: jest.fn().mockResolvedValue(opts.queryRawRows ?? [{ count: 1 }]),
        $executeRaw: jest.fn().mockResolvedValue(1),
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

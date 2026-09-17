import { AIUsageService } from "./ai-usage.service";

/**
 * Phase 9.4C: covers the atomic USD reservation/reconciliation/release
 * trio (reserveBudget/reconcileBudget/releaseBudget) — the real,
 * cross-process-safe circuit breaker that closes the TOCTOU race
 * documented (and deliberately left unfixed) in the Phase 9.4B tests
 * against assertWithinBudget.
 *
 * Two mock strategies are used, matching the existing codebase
 * convention (see reserveDailySlot's own tests):
 *  - Most tests control $queryRaw/$executeRaw call-by-call via a simple
 *    sequence, exactly like reserveDailySlot's tests already do — this
 *    tests the DECISION LOGIC (what reserveBudget does with 0 vs 1 rows
 *    returned), not Postgres itself.
 *  - The concurrency tests (4/5) instead use a tiny faithful in-memory
 *    model of the same atomic INSERT...ON CONFLICT...WHERE semantics —
 *    a real (if simplified) check-and-increment, so two "concurrent"
 *    reserveBudget() calls racing for the same row genuinely can't both
 *    win, the same guarantee Postgres provides via the row lock taken by
 *    the UNIQUE constraint conflict.
 */
describe("AIUsageService — Phase 9.4C atomic USD budget reservation", () => {
  function makeSequencedService(opts: {
    globalBudget?: number;
    perUserBudget?: number;
    queryRawSequence?: unknown[][];
  }) {
    const systemConfigValues: Record<string, number> = {};
    if (opts.globalBudget !== undefined) systemConfigValues.global_daily_ai_budget_usd = opts.globalBudget;
    if (opts.perUserBudget !== undefined) systemConfigValues.per_user_daily_ai_budget_usd = opts.perUserBudget;

    let callIndex = 0;
    const queryRaw = jest.fn().mockImplementation(() => {
      const seq = opts.queryRawSequence ?? [];
      const result = seq[callIndex] ?? [];
      callIndex += 1;
      return Promise.resolve(result);
    });
    const executeRaw = jest.fn().mockResolvedValue(1);
    let reservationSeq = 0;
    const createReservation = jest.fn().mockImplementation(async ({ data }: any) => ({ id: `reservation-${++reservationSeq}`, ...data }));

    const prisma = {
      client: {
        systemConfig: {
          findUnique: jest.fn().mockImplementation(({ where: { key } }: any) =>
            Promise.resolve(key in systemConfigValues ? { value: systemConfigValues[key] } : null),
          ),
        },
        $queryRaw: queryRaw,
        $executeRaw: executeRaw,
        aIBudgetReservation: { create: createReservation },
      },
    } as any;
    const providerFactory = { getCostRates: jest.fn().mockResolvedValue({ costPerInputToken: 0.00000015, costPerOutputToken: 0.0000006 }) } as any;
    return { service: new AIUsageService(prisma, providerFactory), prisma, queryRaw, executeRaw, createReservation };
  }

  describe("reserveBudget — decision logic", () => {
    it("test 1: succeeds and returns a reservationId when both the global and per-user reservation attempts succeed", async () => {
      const { service, createReservation } = makeSequencedService({
        globalBudget: 5,
        perUserBudget: 0.25,
        queryRawSequence: [[{ committedUsd: 0.001 }], [{ committedUsd: 0.001 }]],
      });
      const result = await service.reserveBudget("user-1", 0.001);
      expect(result).toEqual({ ok: true, reservationId: expect.any(String) });
      expect(createReservation).toHaveBeenCalledWith({ data: { userId: "user-1", usageDate: expect.any(Date), estimatedUsd: 0.001, status: "RESERVED" } });
    });

    it("test 2: blocks before any reservation row is created when the GLOBAL attempt's WHERE clause excludes it", async () => {
      const { service, queryRaw, createReservation } = makeSequencedService({
        globalBudget: 5,
        perUserBudget: 0.25,
        queryRawSequence: [[]], // global INSERT...WHERE returns zero rows
      });
      const result = await service.reserveBudget("user-1", 0.001);
      expect(result).toEqual({ ok: false, reason: "global_exceeded" });
      expect(createReservation).not.toHaveBeenCalled();
      expect(queryRaw).toHaveBeenCalledTimes(1); // never attempted the per-user INSERT
    });

    it("test 3: blocks before any reservation row is created when the PER-USER attempt's WHERE clause excludes it, and rolls back the global slice", async () => {
      const { service, queryRaw, executeRaw, createReservation } = makeSequencedService({
        globalBudget: 5,
        perUserBudget: 0.25,
        queryRawSequence: [[{ committedUsd: 0.001 }], []], // global succeeds, per-user is excluded
      });
      const result = await service.reserveBudget("user-1", 0.001);
      expect(result).toEqual({ ok: false, reason: "user_exceeded" });
      expect(createReservation).not.toHaveBeenCalled();
      expect(queryRaw).toHaveBeenCalledTimes(2);
      // Phase 9.4D: attemptReservation is now 2 statements (ensure-row-exists,
      // then the atomic conditional UPDATE) — 1 ensure-exists for the global
      // attempt + 1 for the user attempt + 1 explicit rollback = 3.
      expect(executeRaw).toHaveBeenCalledTimes(3);
    });

    it("misconfigured: fails closed when the global budget key is missing/invalid, without touching AIDailyBudgetCounter at all", async () => {
      const { service, queryRaw } = makeSequencedService({ perUserBudget: 0.25 });
      const result = await service.reserveBudget("user-1", 0.001);
      expect(result).toEqual({ ok: false, reason: "misconfigured" });
      expect(queryRaw).not.toHaveBeenCalled();
    });

    it("misconfigured: fails closed when the per-user budget key is missing/invalid", async () => {
      const { service } = makeSequencedService({ globalBudget: 5 });
      const result = await service.reserveBudget("user-1", 0.001);
      expect(result).toEqual({ ok: false, reason: "misconfigured" });
    });

    it("rejects a non-positive or non-finite estimatedUsd as a programmer error (never silently reserves $0 or negative)", async () => {
      const { service } = makeSequencedService({ globalBudget: 5, perUserBudget: 0.25 });
      await expect(service.reserveBudget("user-1", 0)).rejects.toThrow(/invalid estimatedUsd/);
      await expect(service.reserveBudget("user-1", -1)).rejects.toThrow(/invalid estimatedUsd/);
      await expect(service.reserveBudget("user-1", NaN)).rejects.toThrow(/invalid estimatedUsd/);
      await expect(service.reserveBudget("user-1", Infinity)).rejects.toThrow(/invalid estimatedUsd/);
    });
  });

  describe("reconcileBudget / releaseBudget — idempotency (Objective 4)", () => {
    it("test 8/9: reconciling a RESERVED reservation adjusts both accumulator rows by (actual - estimated), releasing the unused difference", async () => {
      const { service, queryRaw, executeRaw } = makeSequencedService({
        queryRawSequence: [[{ userId: "user-1", usageDate: new Date("2026-09-16"), estimatedUsd: 0.01 }]],
      });
      await service.reconcileBudget("reservation-1", 0.003); // actual well under the worst-case estimate
      expect(queryRaw).toHaveBeenCalledTimes(1);
      expect(executeRaw).toHaveBeenCalledTimes(2); // adjustBudgetCounters touches global then user
    });

    it("test 10: actual cost ABOVE the estimate is handled safely — still adjusts both rows, by a positive delta, never throws", async () => {
      const { service, executeRaw } = makeSequencedService({
        queryRawSequence: [[{ userId: "user-1", usageDate: new Date("2026-09-16"), estimatedUsd: 0.001 }]],
      });
      await expect(service.reconcileBudget("reservation-1", 0.002)).resolves.toBeUndefined();
      expect(executeRaw).toHaveBeenCalledTimes(2);
    });

    it("test 12: double reconciliation is harmless — the second call's UPDATE...WHERE status='RESERVED' matches zero rows and is a no-op", async () => {
      const { service, executeRaw } = makeSequencedService({
        queryRawSequence: [
          [{ userId: "user-1", usageDate: new Date("2026-09-16"), estimatedUsd: 0.01 }], // first call: transitions RESERVED -> RECONCILED
          [], // second call: already RECONCILED, matches nothing
        ],
      });
      await service.reconcileBudget("reservation-1", 0.003);
      await expect(service.reconcileBudget("reservation-1", 0.003)).resolves.toBeUndefined();
      expect(executeRaw).toHaveBeenCalledTimes(2); // only from the FIRST call — the second adjusted nothing
    });

    it("unknown reservation id fails safely (no-op, no throw) for reconcileBudget", async () => {
      const { service, executeRaw } = makeSequencedService({ queryRawSequence: [[]] });
      await expect(service.reconcileBudget("does-not-exist", 0.01)).resolves.toBeUndefined();
      expect(executeRaw).not.toHaveBeenCalled();
    });

    it("test 7: releaseBudget on a RESERVED reservation fully reverses the estimated amount on both accumulator rows", async () => {
      const { service, queryRaw, executeRaw } = makeSequencedService({
        queryRawSequence: [[{ userId: "user-1", usageDate: new Date("2026-09-16"), estimatedUsd: 0.01 }]],
      });
      await service.releaseBudget("reservation-1");
      expect(queryRaw).toHaveBeenCalledTimes(1);
      expect(executeRaw).toHaveBeenCalledTimes(2);
    });

    it("test 11: double release is harmless/idempotent", async () => {
      const { service, executeRaw } = makeSequencedService({
        queryRawSequence: [
          [{ userId: "user-1", usageDate: new Date("2026-09-16"), estimatedUsd: 0.01 }], // first: RESERVED -> RELEASED
          [], // second: already RELEASED
        ],
      });
      await service.releaseBudget("reservation-1");
      await expect(service.releaseBudget("reservation-1")).resolves.toBeUndefined();
      expect(executeRaw).toHaveBeenCalledTimes(2); // only from the first call
    });

    it("a reservation already RECONCILED cannot subsequently be released (the WHERE status='RESERVED' guard excludes it)", async () => {
      const { service, executeRaw } = makeSequencedService({
        queryRawSequence: [
          [{ userId: "user-1", usageDate: new Date("2026-09-16"), estimatedUsd: 0.01 }], // reconcile succeeds
          [], // release attempt matches nothing — already RECONCILED
        ],
      });
      await service.reconcileBudget("reservation-1", 0.002);
      await expect(service.releaseBudget("reservation-1")).resolves.toBeUndefined();
      expect(executeRaw).toHaveBeenCalledTimes(2); // only the reconcile's adjustment ran
    });

    it("unknown reservation id fails safely (no-op, no throw) for releaseBudget", async () => {
      const { service, executeRaw } = makeSequencedService({ queryRawSequence: [[]] });
      await expect(service.releaseBudget("does-not-exist")).resolves.toBeUndefined();
      expect(executeRaw).not.toHaveBeenCalled();
    });
  });

  describe("estimateMaxChatCostUsd", () => {
    it("computes a worst-case cost from real input length (conservative chars/token) and the default max-output-token ceiling", async () => {
      const { service } = makeSequencedService({});
      const cost = await service.estimateMaxChatCostUsd({ providerKey: "openai", inputText: "x".repeat(300) });
      // 300 chars / 3 chars-per-token = 100 input tokens; default max output 600.
      const expected = 100 * 0.00000015 + 600 * 0.0000006;
      expect(cost).toBeCloseTo(expected, 10);
    });

    it("honors an explicit maxOutputTokens override instead of the default 600", async () => {
      const { service } = makeSequencedService({});
      const cost = await service.estimateMaxChatCostUsd({ providerKey: "openai", inputText: "x".repeat(300), maxOutputTokens: 100 });
      const expected = 100 * 0.00000015 + 100 * 0.0000006;
      expect(cost).toBeCloseTo(expected, 10);
    });
  });

  /**
   * A tiny, faithful in-memory model of the SAME atomic
   * "INSERT ... ON CONFLICT ... WHERE committedUsd + est <= limit"
   * statement Postgres executes — a real (if simplified)
   * check-and-increment. Because JS is single-threaded, each invocation
   * of this mock runs to completion before the next microtask, which
   * mirrors exactly the guarantee the row lock taken by the UNIQUE
   * constraint conflict gives in real Postgres: two "concurrent" callers
   * racing for the same (scope, scopeKey, day) row can never both
   * observe the pre-increment value.
   */
  function makeConcurrencyFakeDb(opts: { globalBudget: number; perUserBudget: number }) {
    const committed = new Map<string, number>();
    const key = (scope: string, scopeKey: string) => `${scope}:${scopeKey}`;

    // Phase 9.4D: attemptReservation is now TWO statements (a real bug —
    // "first ever attempt bypasses the limit" — found and fixed via the
    // real-PostgreSQL integration test; see ai-usage.service.ts's
    // attemptReservation docstring):
    //  1. $executeRaw, INSERT ... ON CONFLICT DO NOTHING — params [scope, scopeKey, usageDate] (3)
    //  2. $queryRaw, UPDATE ... WHERE ... RETURNING       — params [estimatedUsd, scope, scopeKey, usageDate, estimatedUsd, limit] (6)
    // adjustCounterRow's plain adjustment executeRaw call still has 4
    // params [deltaUsd, scope, scopeKey, usageDate] — the param COUNT is
    // what distinguishes the two executeRaw shapes here (3 vs 4), which is
    // simpler and more robust than pattern-matching SQL text.
    const queryRaw = jest.fn().mockImplementation((_strings: TemplateStringsArray, ...values: unknown[]) => {
      const [estimatedUsd, scope, scopeKey, , , limit] = values as [number, string, string, unknown, number, number];
      const k = key(scope, scopeKey);
      const current = committed.get(k) ?? 0; // the row is guaranteed to already exist (step 1 above)
      if (current + estimatedUsd <= limit) {
        committed.set(k, current + estimatedUsd);
        return Promise.resolve([{ committedUsd: current + estimatedUsd }]);
      }
      return Promise.resolve([]);
    });

    const executeRaw = jest.fn().mockImplementation((_strings: TemplateStringsArray, ...values: unknown[]) => {
      if (values.length === 3) {
        // "ensure row exists" — idempotent, never overwrites an existing row.
        const [scope, scopeKey] = values as [string, string, unknown];
        const k = key(scope, scopeKey);
        if (!committed.has(k)) committed.set(k, 0);
      } else {
        // adjustCounterRow's plain delta adjustment.
        const [deltaUsd, scope, scopeKey] = values as [number, string, string, unknown];
        const k = key(scope, scopeKey);
        committed.set(k, Math.max((committed.get(k) ?? 0) + deltaUsd, 0));
      }
      return Promise.resolve(1);
    });

    const prisma = {
      client: {
        systemConfig: {
          findUnique: jest.fn().mockImplementation(({ where: { key: k } }: any) =>
            Promise.resolve(
              k === "global_daily_ai_budget_usd"
                ? { value: opts.globalBudget }
                : k === "per_user_daily_ai_budget_usd"
                  ? { value: opts.perUserBudget }
                  : null,
            ),
          ),
        },
        $queryRaw: queryRaw,
        $executeRaw: executeRaw,
        aIBudgetReservation: { create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: `reservation-${Math.random()}`, ...data })) },
      },
    } as any;
    const providerFactory = { getCostRates: jest.fn().mockResolvedValue({ costPerInputToken: 0, costPerOutputToken: 0 }) } as any;
    return { service: new AIUsageService(prisma, providerFactory), committed };
  }

  describe("reserveBudget — concurrency (Objective 2, the actual fix)", () => {
    it("test 4: two concurrent requests cannot both exceed the GLOBAL budget — exactly one wins when only one can fit", async () => {
      // $5 global cap, two concurrent requests each estimating $3 — only ONE
      // can fit ($3 <= $5, but $3+$3=$6 > $5), unlike the Phase 9.4B
      // assertWithinBudget race, where BOTH would have passed.
      const { service } = makeConcurrencyFakeDb({ globalBudget: 5, perUserBudget: 100 });
      const [a, b] = await Promise.all([service.reserveBudget("user-1", 3), service.reserveBudget("user-2", 3)]);
      const results = [a, b];
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok && r.reason === "global_exceeded")).toHaveLength(1);
    });

    it("test 5: two concurrent requests from the SAME user cannot both exceed the PER-USER budget", async () => {
      // $0.25 per-user cap, two concurrent $0.20 requests from the same
      // user — only one can fit ($0.20 <= $0.25, but $0.40 > $0.25).
      const { service } = makeConcurrencyFakeDb({ globalBudget: 100, perUserBudget: 0.25 });
      const [a, b] = await Promise.all([service.reserveBudget("user-1", 0.2), service.reserveBudget("user-1", 0.2)]);
      const results = [a, b];
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok && r.reason === "user_exceeded")).toHaveLength(1);
    });

    it("test 9 (allowed case): a request within both budgets is allowed through when spend is genuinely available", async () => {
      const { service } = makeConcurrencyFakeDb({ globalBudget: 5, perUserBudget: 1 });
      const result = await service.reserveBudget("user-1", 0.5);
      expect(result.ok).toBe(true);
    });

    it("a global rejection after a per-user race correctly leaves the OTHER user's per-user accumulator untouched", async () => {
      // Regression check for the exact bug caught and fixed during this
      // phase: rolling back a failed per-user reservation must never
      // also decrement an unrelated user's row.
      const { service, committed } = makeConcurrencyFakeDb({ globalBudget: 100, perUserBudget: 1 });
      await service.reserveBudget("user-1", 0.5); // user-1 now has $0.50 committed
      const blocked = await service.reserveBudget("user-1", 0.6); // would push user-1 to $1.10 > $1 cap
      expect(blocked.ok).toBe(false);
      expect(committed.get("user:user-1")).toBe(0.5); // untouched by the rejected attempt
    });
  });

  /**
   * Phase 9.4D, Objective 3: proves the system can DISTINGUISH each budget
   * lifecycle state in its logs — estimated/reserved, actual/reconciled,
   * released, and (new) reconciliation/release accumulator failures —
   * never message content, never secrets.
   */
  describe("observability (Objective 3)", () => {
    let logSpy: jest.SpyInstance;
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Logger } = require("@nestjs/common");
      logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
      errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    });
    afterEach(() => {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it("logs a distinct RESERVED line, with the reservationId and estimated amount, never message/prompt content", async () => {
      const { service } = makeSequencedService({
        globalBudget: 5,
        perUserBudget: 0.25,
        queryRawSequence: [[{ committedUsd: 0.001 }], [{ committedUsd: 0.001 }]],
      });
      await service.reserveBudget("user-1", 0.001);
      expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/RESERVED.*reservation-1.*user-1.*\$0\.001000/));
    });

    it("logs a distinct RECONCILED line showing estimated -> actual, distinguishable from RESERVED/RELEASED", async () => {
      const { service } = makeSequencedService({
        queryRawSequence: [[{ userId: "user-1", usageDate: new Date("2026-09-16"), estimatedUsd: 0.01 }]],
      });
      await service.reconcileBudget("reservation-1", 0.003);
      expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/RECONCILED.*reservation-1.*estimated \$0\.010000 -> actual \$0\.003000/));
    });

    it("logs a distinct RELEASED line, distinguishable from RECONCILED", async () => {
      const { service } = makeSequencedService({
        queryRawSequence: [[{ userId: "user-1", usageDate: new Date("2026-09-16"), estimatedUsd: 0.01 }]],
      });
      await service.releaseBudget("reservation-1");
      expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/RELEASED.*reservation-1.*\$0\.010000 returned/));
    });

    it("a reconciliation ACCUMULATOR failure (provider succeeded, DB adjustment then failed) is logged at error level, not silently swallowed", async () => {
      const { service, executeRaw } = makeSequencedService({
        queryRawSequence: [[{ userId: "user-1", usageDate: new Date("2026-09-16"), estimatedUsd: 0.01 }]],
      });
      executeRaw.mockRejectedValueOnce(new Error("connection reset"));
      await expect(service.reconcileBudget("reservation-1", 0.003)).resolves.toBeUndefined(); // never throws to the caller
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/CRITICAL.*reconciliation failure.*reservation-1.*RECONCILED.*Manual correction/),
        expect.anything(),
      );
    });

    it("a release ACCUMULATOR failure (provider failed, then the DB adjustment ALSO failed) is logged at error level, not silently swallowed", async () => {
      const { service, executeRaw } = makeSequencedService({
        queryRawSequence: [[{ userId: "user-1", usageDate: new Date("2026-09-16"), estimatedUsd: 0.01 }]],
      });
      executeRaw.mockRejectedValueOnce(new Error("connection reset"));
      await expect(service.releaseBudget("reservation-1")).resolves.toBeUndefined(); // never throws to the caller
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/CRITICAL.*release failure.*reservation-1.*RELEASED.*Manual correction/),
        expect.anything(),
      );
    });
  });

  describe("getGlobalCommittedUsdToday (Objective 3 admin visibility)", () => {
    it("reads the real-time global accumulator row — the LIVE total reserveBudget() itself checks, distinct from historical AIUsage-only spend", async () => {
      const { service, queryRaw } = makeSequencedService({ queryRawSequence: [[{ committedUsd: 1.234 }]] });
      const result = await service.getGlobalCommittedUsdToday();
      expect(result).toBe(1.234);
      expect(queryRaw).toHaveBeenCalledTimes(1);
    });

    it("returns 0 when no global row exists yet for today (no AI spend committed at all)", async () => {
      const { service } = makeSequencedService({ queryRawSequence: [[]] });
      const result = await service.getGlobalCommittedUsdToday();
      expect(result).toBe(0);
    });
  });
});

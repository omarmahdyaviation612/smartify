import { BadRequestException } from "@nestjs/common";
import { AdminAIConfigService } from "./admin-ai-config.service";

/**
 * Covers the Phase 10 concurrency fix for provider activation: a single
 * atomic SQL UPDATE statement (not a read-then-write pair) is used so
 * two concurrent activations of different providers can't both end up
 * active. These tests confirm the raw-SQL path is used, not that real
 * Postgres concurrency was exercised (that guarantee comes from a single
 * UPDATE statement being inherently atomic in Postgres, which cannot be
 * demonstrated against a mocked client — see 10-phase10-decisions.md).
 */
describe("AdminAIConfigService.updateProvider — atomic activation", () => {
  function makePrismaMock() {
    return {
      client: {
        $executeRaw: jest.fn().mockResolvedValue(1),
        aIProviderConfig: {
          update: jest.fn().mockResolvedValue({ providerKey: "openai" }),
          findUnique: jest.fn().mockResolvedValue({ providerKey: "openai" }),
        },
      },
    } as any;
  }

  it("issues a single atomic UPDATE statement when activating a provider, rather than two separate calls", async () => {
    const prisma = makePrismaMock();
    const service = new AdminAIConfigService(prisma, {} as any);

    await service.updateProvider("openai", { isActive: true });

    expect(prisma.client.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("does not touch the isActive column via a separate updateMany/update call", async () => {
    const prisma = makePrismaMock();
    const service = new AdminAIConfigService(prisma, {} as any);

    await service.updateProvider("openai", { isActive: true });

    // The typed update() call, if made at all here, should only be for
    // non-isActive fields — isActive itself is handled exclusively by
    // the atomic raw statement above.
    if (prisma.client.aIProviderConfig.update.mock.calls.length > 0) {
      const updateData = prisma.client.aIProviderConfig.update.mock.calls[0][0].data;
      expect(updateData.isActive).toBeUndefined();
    }
  });

  it("skips the atomic UPDATE entirely when the change doesn't touch isActive (e.g. only updating cost rates)", async () => {
    const prisma = makePrismaMock();
    const service = new AdminAIConfigService(prisma, {} as any);

    await service.updateProvider("openai", { costPerInputToken: 0.0000002 });

    expect(prisma.client.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.client.aIProviderConfig.update).toHaveBeenCalledWith({
      where: { providerKey: "openai" },
      data: { costPerInputToken: 0.0000002 },
    });
  });
});

/**
 * Phase 9.4B — AI Spending Controls (B4-B7): the Admin Dashboard's budget
 * display and the SUPER_ADMIN editing endpoint, including the cross-field
 * "per-user <= global" rule that only this service (not the generic
 * system-config/:key PATCH, and not the zod schema alone) can enforce,
 * since it depends on the CURRENT value of the other field.
 */
describe("AdminAIConfigService — AI spending controls", () => {
  function makeService(systemConfigValues: Record<string, unknown> = {}, globalSpentTodayUsd = 0) {
    const store = { ...systemConfigValues };
    const prisma = {
      client: {
        systemConfig: {
          findUnique: jest.fn().mockImplementation(({ where: { key } }: any) =>
            Promise.resolve(key in store ? { key, value: store[key] } : null),
          ),
          upsert: jest.fn().mockImplementation(({ where: { key }, create }: any) => {
            store[key] = create.value;
            return Promise.resolve({ key, value: create.value });
          }),
        },
      },
    } as any;
    const usageService = { getGlobalSpendToday: jest.fn().mockResolvedValue(globalSpentTodayUsd) } as any;
    return { service: new AdminAIConfigService(prisma, usageService), prisma, store };
  }

  describe("getBudgetStatus", () => {
    it("reports null budgets and the default question limit when nothing has ever been configured", async () => {
      const { service } = makeService({});
      const status = await service.getBudgetStatus();
      expect(status.globalBudgetUsd).toBeNull();
      expect(status.perUserBudgetUsd).toBeNull();
      expect(status.dailyQuestionsPerSubject).toBe(10);
      expect(status.globalRemainingUsd).toBeNull();
    });

    it("computes remaining budget from the SAME today's-spend source the runtime circuit breaker uses", async () => {
      const { service, prisma } = makeService({ global_daily_ai_budget_usd: 5 }, 1.5);
      const status = await service.getBudgetStatus();
      expect(status.globalRemainingUsd).toBeCloseTo(3.5);
      expect(prisma.client.systemConfig.findUnique).toHaveBeenCalled();
    });

    it("never reports negative remaining budget when spend has exceeded the cap", async () => {
      const { service } = makeService({ global_daily_ai_budget_usd: 5 }, 7);
      const status = await service.getBudgetStatus();
      expect(status.globalRemainingUsd).toBe(0);
    });
  });

  describe("updateSpendingControls — validation", () => {
    it("rejects a per-user budget greater than the global budget", async () => {
      const { service } = makeService({ global_daily_ai_budget_usd: 5 });
      await expect(service.updateSpendingControls({ perUserDailyBudgetUsd: 10 })).rejects.toThrow(BadRequestException);
    });

    it("rejects setting a per-user budget when no global budget exists yet", async () => {
      const { service } = makeService({});
      await expect(service.updateSpendingControls({ perUserDailyBudgetUsd: 0.25 })).rejects.toThrow(BadRequestException);
    });

    it("rejects lowering the global budget below an already-configured per-user budget", async () => {
      const { service } = makeService({ global_daily_ai_budget_usd: 5, per_user_daily_ai_budget_usd: 1 });
      await expect(service.updateSpendingControls({ globalDailyBudgetUsd: 0.5 })).rejects.toThrow(BadRequestException);
    });

    it("accepts raising both together in the same call, even though per-user > the OLD global alone", async () => {
      const { service } = makeService({ global_daily_ai_budget_usd: 5, per_user_daily_ai_budget_usd: 1 });
      const result = await service.updateSpendingControls({ globalDailyBudgetUsd: 20, perUserDailyBudgetUsd: 10 });
      expect(result.globalBudgetUsd).toBe(20);
      expect(result.perUserBudgetUsd).toBe(10);
    });

    it("writes nothing to SystemConfig when validation fails", async () => {
      const { service, prisma } = makeService({ global_daily_ai_budget_usd: 5 });
      await expect(service.updateSpendingControls({ perUserDailyBudgetUsd: 10 })).rejects.toThrow();
      expect(prisma.client.systemConfig.upsert).not.toHaveBeenCalled();
    });
  });

  describe("updateSpendingControls — persistence and re-read behavior", () => {
    it("persists the owner-approved Phase 9.4B initial values", async () => {
      const { service, store } = makeService({});
      await service.updateSpendingControls({ globalDailyBudgetUsd: 5, perUserDailyBudgetUsd: 0.25, dailyQuestionsPerSubject: 10 });
      expect(store.global_daily_ai_budget_usd).toBe(5);
      expect(store.per_user_daily_ai_budget_usd).toBe(0.25);
      expect(store.default_daily_ai_questions_per_subject).toBe(10);
    });

    it("a subsequent getBudgetStatus call reflects the just-written values (no stale caching)", async () => {
      const { service } = makeService({});
      await service.updateSpendingControls({ globalDailyBudgetUsd: 8 });
      const status = await service.getBudgetStatus();
      expect(status.globalBudgetUsd).toBe(8);
    });
  });
});

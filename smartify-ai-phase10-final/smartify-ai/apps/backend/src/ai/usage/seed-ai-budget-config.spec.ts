/**
 * Phase 9.4B: proves the two AI-spend circuit-breaker SystemConfig keys
 * are seeded idempotently and never overwrite an admin-configured value —
 * against a mocked Prisma client only. This intentionally never touches a
 * real database and never runs `prisma db seed` — see the HARD SAFETY
 * RULES for Phase 9.4B ("Do not run the seed against the current live
 * database").
 */
import {
  seedAiBudgetConfig,
  isValidBudgetUsd,
  DEV_SAFE_GLOBAL_DAILY_AI_BUDGET_USD,
  DEV_SAFE_PER_USER_DAILY_AI_BUDGET_USD,
  type SystemConfigSeedClient,
} from "../../../../../packages/database/prisma/seed-ai-budget-config";

function makeMockClient() {
  const upsert = jest.fn().mockResolvedValue(undefined);
  const client: SystemConfigSeedClient = { systemConfig: { upsert } };
  return { client, upsert };
}

describe("seedAiBudgetConfig (Phase 9.4B fresh-environment seed)", () => {
  it("1: is idempotent — calling it twice issues the same two upserts both times with no error", async () => {
    const { client, upsert } = makeMockClient();
    await seedAiBudgetConfig(client);
    await seedAiBudgetConfig(client);
    expect(upsert).toHaveBeenCalledTimes(4); // 2 keys x 2 runs
  });

  it("2: never overwrites an existing value — uses update: {} (create-only-if-missing) for both keys, matching every other SystemConfig upsert in seed.ts", async () => {
    const { client, upsert } = makeMockClient();
    await seedAiBudgetConfig(client);
    for (const call of upsert.mock.calls) {
      const [args] = call;
      expect(args.update).toEqual({});
    }
  });

  it("creates global_daily_ai_budget_usd with the documented dev-safe value and description", async () => {
    const { client, upsert } = makeMockClient();
    await seedAiBudgetConfig(client);
    expect(upsert).toHaveBeenCalledWith({
      where: { key: "global_daily_ai_budget_usd" },
      update: {},
      create: {
        key: "global_daily_ai_budget_usd",
        value: DEV_SAFE_GLOBAL_DAILY_AI_BUDGET_USD,
        description: "Maximum combined AI/TTS spend allowed per day, across all students.",
      },
    });
  });

  it("creates per_user_daily_ai_budget_usd with the documented dev-safe value and description", async () => {
    const { client, upsert } = makeMockClient();
    await seedAiBudgetConfig(client);
    expect(upsert).toHaveBeenCalledWith({
      where: { key: "per_user_daily_ai_budget_usd" },
      update: {},
      create: {
        key: "per_user_daily_ai_budget_usd",
        value: DEV_SAFE_PER_USER_DAILY_AI_BUDGET_USD,
        description: "Maximum AI/TTS spend one student may consume per day.",
      },
    });
  });

  it("5: matches the exact live values this phase must not overwrite ($5 global / $0.25 per-user)", () => {
    // Hard-codes the live values from the HARD SAFETY RULES so this test
    // fails loudly if the dev-safe defaults are ever edited to disagree
    // with what's actually live in the database.
    expect(DEV_SAFE_GLOBAL_DAILY_AI_BUDGET_USD).toBe(5);
    expect(DEV_SAFE_PER_USER_DAILY_AI_BUDGET_USD).toBe(0.25);
  });

  describe("4: invalid values are not silently accepted", () => {
    it.each([
      ["a string", "20" as any],
      ["NaN", NaN],
      ["Infinity", Infinity],
      ["-Infinity", -Infinity],
      ["zero", 0],
      ["a negative number", -5],
    ])("throws and upserts nothing when the global override is %s", async (_label, bad) => {
      const { client, upsert } = makeMockClient();
      await expect(seedAiBudgetConfig(client, { globalDailyBudgetUsd: bad })).rejects.toThrow();
      expect(upsert).not.toHaveBeenCalled();
    });

    it.each([
      ["a string", "1" as any],
      ["NaN", NaN],
      ["Infinity", Infinity],
      ["zero", 0],
      ["a negative number", -1],
    ])("throws and upserts nothing when the per-user override is %s", async (_label, bad) => {
      const { client, upsert } = makeMockClient();
      await expect(seedAiBudgetConfig(client, { perUserDailyBudgetUsd: bad })).rejects.toThrow();
      expect(upsert).not.toHaveBeenCalled();
    });

    it("the underlying predicate rejects every malformed shape directly", () => {
      expect(isValidBudgetUsd("5")).toBe(false);
      expect(isValidBudgetUsd(NaN)).toBe(false);
      expect(isValidBudgetUsd(Infinity)).toBe(false);
      expect(isValidBudgetUsd(-Infinity)).toBe(false);
      expect(isValidBudgetUsd(0)).toBe(false);
      expect(isValidBudgetUsd(-1)).toBe(false);
      expect(isValidBudgetUsd(null)).toBe(false);
      expect(isValidBudgetUsd(undefined)).toBe(false);
      expect(isValidBudgetUsd(5)).toBe(true);
      expect(isValidBudgetUsd(0.25)).toBe(true);
    });
  });
});

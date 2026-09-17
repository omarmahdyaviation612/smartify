/**
 * Phase 9.4B: the AI-spend circuit-breaker's two SystemConfig keys were
 * already inline in seed.ts (added in an earlier Phase 9.4B pass, with the
 * owner-approved soft-launch caps below). Extracted into this small,
 * standalone module — same upserts, same values, same `update: {}`
 * (create-only-if-missing) semantics, zero behavior change — purely so it
 * can be unit-tested with a mocked Prisma client (see
 * seed-ai-budget-config.spec.ts) without executing the rest of seed.ts,
 * which seeds curricula/pricing/etc. and instantiates a real PrismaClient
 * at import time, or touching a real database.
 *
 * These are clearly-labeled development-safe defaults, editable afterward
 * from Admin > Platform Config > AI Spending Controls — never by editing
 * this file again. This is NOT a claim that they are production-approved
 * business pricing; see AIUsageService.assertWithinBudget's docstring in
 * apps/backend for the enforcement side.
 */
export const DEV_SAFE_GLOBAL_DAILY_AI_BUDGET_USD = 5.0;
export const DEV_SAFE_PER_USER_DAILY_AI_BUDGET_USD = 0.25;

/**
 * Deliberately duplicated (not imported) from
 * apps/backend/src/ai/usage/budget-config.util.ts#parseBudgetUsd:
 * @smartify/database must not depend on the backend app, and the check is
 * small enough that a short duplicate here is safer than inventing a new
 * shared package just for two constants. Keep both in sync if the
 * definition of "a valid USD budget" ever changes. Exported so it can be
 * unit-tested directly (see seed-ai-budget-config.spec.ts).
 */
export function isValidBudgetUsd(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export interface SystemConfigSeedClient {
  systemConfig: {
    upsert(args: {
      where: { key: string };
      update: Record<string, never>;
      create: { key: string; value: number; description: string };
    }): Promise<unknown>;
  };
}

/**
 * Idempotently ensures both AI-spend budget keys exist. Uses `update: {}`
 * (create-only-if-missing) so a value an admin has since changed via
 * PATCH /admin/ai-config/spending-controls is NEVER overwritten by a
 * later seed run — matches every other SystemConfig upsert in seed.ts
 * (default_daily_ai_questions_per_subject, tts_config). Refuses to run at
 * all if either value is something the runtime circuit breaker itself
 * would reject (non-finite, zero, negative) — defense against a future
 * edit silently reintroducing the exact dormant-breaker bug Phase 9.4
 * closed. `overrides` exists only so tests can exercise that guard
 * directly (see seed-ai-budget-config.spec.ts) — seed.ts's real call site
 * never passes it, so production always uses the two dev-safe constants
 * above.
 */
export async function seedAiBudgetConfig(
  prisma: SystemConfigSeedClient,
  overrides: { globalDailyBudgetUsd?: number; perUserDailyBudgetUsd?: number } = {},
): Promise<void> {
  const globalValue = overrides.globalDailyBudgetUsd ?? DEV_SAFE_GLOBAL_DAILY_AI_BUDGET_USD;
  const perUserValue = overrides.perUserDailyBudgetUsd ?? DEV_SAFE_PER_USER_DAILY_AI_BUDGET_USD;

  if (!isValidBudgetUsd(globalValue)) {
    throw new Error(`Refusing to seed an invalid global_daily_ai_budget_usd value: ${globalValue}`);
  }
  if (!isValidBudgetUsd(perUserValue)) {
    throw new Error(`Refusing to seed an invalid per_user_daily_ai_budget_usd value: ${perUserValue}`);
  }

  await prisma.systemConfig.upsert({
    where: { key: "global_daily_ai_budget_usd" },
    update: {},
    create: {
      key: "global_daily_ai_budget_usd",
      value: globalValue,
      description: "Maximum combined AI/TTS spend allowed per day, across all students.",
    },
  });
  await prisma.systemConfig.upsert({
    where: { key: "per_user_daily_ai_budget_usd" },
    update: {},
    create: {
      key: "per_user_daily_ai_budget_usd",
      value: perUserValue,
      description: "Maximum AI/TTS spend one student may consume per day.",
    },
  });
}

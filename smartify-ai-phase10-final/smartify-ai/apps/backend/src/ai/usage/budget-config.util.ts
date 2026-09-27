/**
 * SystemConfig keys and parsing for the USD AI-spend circuit breaker
 * (Phase 9.4). Shared between the runtime enforcement path
 * (AIUsageService.assertWithinBudget) and the admin read/write path
 * (AdminAIConfigService) so both agree on exactly what counts as a
 * validly configured budget — a single source of truth means the admin
 * screen can never show a value the breaker would actually reject.
 */
export const GLOBAL_DAILY_AI_BUDGET_USD_KEY = "global_daily_ai_budget_usd";
export const PER_USER_DAILY_AI_BUDGET_USD_KEY = "per_user_daily_ai_budget_usd";
// Independent platform content-authoring circuit breaker (2026-09-25) —
// deliberately a SEPARATE key from PER_USER_DAILY_AI_BUDGET_USD_KEY, never
// reused. CONTENT_AUTHORING_ACTOR_ID (grounding, lazy lesson/question
// authoring) is never evaluated against the per-user cap — see
// AIUsageService.assertWithinBudget/reserveBudget — because that cap is
// sized for one real student's daily usage, not shared platform-wide
// content-authoring spend across every unit/lesson/question generated
// that day. Still subject to the global cap above it, same as everyone.
export const PLATFORM_CONTENT_AUTHORING_DAILY_AI_BUDGET_USD_KEY = "platform_content_authoring_daily_ai_budget_usd";

/**
 * A USD budget has no safe application-level default (unlike the daily
 * question count, which defaults to 10 when unset — see
 * AIUsageService.getDailyLimit) — Phase 9.4 requires it to come from
 * real, validated configuration, and callers must fail closed rather than
 * silently allow unlimited spend when it doesn't. Missing, non-number,
 * NaN, Infinity, zero, and negative values are all rejected here as
 * equally "not validly configured" — the caller cannot tell them apart
 * and must not try to.
 */
export function parseBudgetUsd(raw: unknown): number | null {
  if (typeof raw !== "number") return null;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return raw;
}

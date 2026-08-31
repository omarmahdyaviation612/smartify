# Smartify AI — Phase 9: Admin Dashboard

Builds on Phases 1–8. Nothing prior was restarted. This is the final phase on the original roadmap.

## Role-scoped endpoints, not one generic "admin" role

Per the Phase 2 role design (`SUPER_ADMIN`, `ADMIN`, `CONTENT_MANAGER`, `SUPPORT`), Phase 9 doesn't gate everything behind a single `isAdmin` check — each `/admin/*` endpoint uses `@Roles(...)` with exactly the roles that should have it, enforced by the same `ClerkAuthGuard` + `RolesGuard` pattern every protected endpoint has used since Phase 2:

- **`AdminCurriculumController`** (`/admin/curriculum/*`) — `SUPER_ADMIN`, `ADMIN`, `CONTENT_MANAGER` can manage curricula/grades/subjects. The `pricing-plans` routes inside the same controller override that to `SUPER_ADMIN`/`ADMIN` only — `CONTENT_MANAGER` can edit content but not prices, matching the Phase 2 role intent exactly (`RolesGuard` checks handler-level `@Roles` before falling back to the controller's class-level default, so this per-route override actually works, not just as a comment).
- **`AdminAIConfigController`** (`/admin/ai-config/*`) — `SUPER_ADMIN` only. Provider cost rates and aggregate spend are exactly the "raw provider-cost config" the Phase 2 design excludes `ADMIN` from.
- **`AdminPaymentsController`** (`/admin/payments/*`) — `SUPER_ADMIN` only, same reasoning.
- **`AdminRevenueController`** (`/admin/revenue/*`) — `SUPER_ADMIN` only — financial data.
- **User management** reuses the `/users` endpoints already built in Phase 2 (`GET /users` allows `SUPER_ADMIN`/`ADMIN`/`SUPPORT`; `PATCH /users/:id/role` allows only `SUPER_ADMIN`/`ADMIN`) — Phase 9 didn't need to rebuild this, just point the admin frontend at it.

## Revenue vs. AI cost — the spec's business-safety check, made visible

`AdminRevenueService.getRevenueVsCostSummary()` computes real monthly recurring revenue (sum of `Subscription.monthlyTotalEGP` for `status: "active"` rows) against real AI cost (sum of `AIUsage.costUsd` in the window) — this is the "Total Revenue > AI API Costs" requirement from the original spec, backed by actual data rather than a projection.

**One honest caveat, stated directly in the API response** (`note` field): revenue is in EGP, AI cost is in USD. Rather than silently applying a guessed exchange rate to make one combined number, the endpoint returns both figures separately and says so — a wrong assumed FX rate would be worse than an admin having to apply a real one themselves.

## Single-active-provider invariant, enforced at the write path

Both `AdminAIConfigService.updateProvider()` and `AdminPaymentsService.updateProvider()` wrap activation in a transaction that deactivates every other provider of that type first. This matters because `AIProviderFactory`/`PaymentProviderFactory` (Phases 6 and 8) both just take "the first `isActive` row" — without this invariant, an admin could end up with two active providers and undefined behavior about which one actually gets used. Enforcing it in the admin write path, not just documenting it, is the safer choice.

## Frontend — role-aware, not just auth-aware

`/[locale]/admin` (overview + revenue/cost, nav cards), `/admin/users`, `/admin/curriculum` (curricula/grades/subjects + pricing, with the pricing section itself hidden for `CONTENT_MANAGER`), `/admin/platform` (AI provider, payment provider, system config — `SUPER_ADMIN` only). Every page wraps its content in `AdminGuard`, which is explicitly documented in its own code as **UX-only** — it prevents a confusing flash of admin UI for someone who'd get a 403 from the backend anyway, but the actual security boundary is `RolesGuard` on every route, exactly as established in Phase 2. The navbar's "Admin" link only appears for admin-capable roles, using the same non-authoritative `useCurrentUser()` hook.

## What Phase 9 does NOT include

- Full CRUD for the deeper curriculum tree (units/topics/lessons/questions) — grades and subjects are covered; going deeper is a natural, low-risk extension of the same pattern once there's real content to manage instead of placeholder seed data.
- Audit log viewer UI (the `AuditLog` table has been written to since Phase 2's role-change tracking; no admin screen reads it yet).
- Any UI for the "suspicious usage" flag `AdminAIConfigService.getUsageSummary()` computes (top-10 students by request count in the window) beyond returning the raw list — it's explicitly documented as an MVP eyeball-list, not real anomaly detection.
- System health monitoring (uptime, error rates, queue depth) — nothing in this build produces that kind of operational telemetry yet.

## Where this leaves the project

All ten phases from the original roadmap are now built: foundation, marketing site, onboarding, dashboard, AI tutor, practice/quizzes, payments, and admin. Three integration-test milestones remain **unverified against real credentials** in this environment and should be run before any production deployment, per the honesty pattern maintained since Phase 4:
1. Clerk auth flow (middleware composition, protected routes, session persistence, redirects, RBAC) — `04-phase4-decisions.md`.
2. OpenAI Tutor integration — `06-phase6-decisions.md`.
3. Stripe billing flow (checkout → webhook → subscription activation) — `08-phase8-decisions.md`.

Phase 10 in the original spec ("Testing and production optimization") is exactly where those three milestones belong.

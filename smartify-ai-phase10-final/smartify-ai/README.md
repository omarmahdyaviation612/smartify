# Smartify AI — Monorepo (Phase 2 Foundation)

LEARN • PRACTICE • ACHIEVE

This is the Phase 2 foundation: monorepo scaffold, database schema + placeholder seed, and Clerk-based authentication with backend-owned RBAC. See `01-architecture.md` and `02-phase2-decisions.md` (one level up, alongside this file when delivered) for the full design rationale — this README is just "how do I run it."

## Structure

```
apps/backend    NestJS API (auth, RBAC, business logic)
apps/frontend   Next.js app (marketing + student/parent/admin UI)
packages/database        Prisma schema, client, seed
packages/shared-types    enums & DTOs shared by both apps
packages/config          zod-validated env loading
packages/validation      shared zod request schemas
```

## Prerequisites

- Node.js 20+
- pnpm 9+ (`npm i -g pnpm`)
- PostgreSQL 15+ (local, Docker, or hosted — e.g. Supabase/Railway/Neon)
- Redis (for AI credit caching / rate limiting — used from Phase 6 onward, but the env var is required now so config validation passes)
- A Clerk application (free tier is fine): create one at https://dashboard.clerk.com, grab the publishable + secret keys, and set up a webhook endpoint pointing at `POST /webhooks/clerk` on your backend once it's deployed/tunnelled (e.g. via ngrok in local dev) — copy the webhook signing secret too.

## First-time setup

The repository includes an isolated PostgreSQL 16 + Redis 7 Compose stack. Its credentials are intentionally local-only; staging must supply secrets through its secret manager.

```bash
# 1. Install all workspace dependencies
pnpm install

# 2. Start local infrastructure
pnpm infra:up

# 3. Copy env files and fill in real values
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env.local

# 4. Generate the client, deploy the committed baseline, seed twice, and verify
pnpm db:generate
DATABASE_URL=postgresql://smartify:smartify_local@localhost:5432/smartify pnpm staging:verify

# 5. Link the shared subjects. Arabic Language and Social Studies live once,
#    under the Egyptian National grades, and are OFFERED to other curricula
#    through GradeSubject — they are not seeded per curriculum (2026-10-06).
pnpm --filter @smartify/backend build
cd apps/backend && node dist/scripts/shared-subjects-link.js --apply && cd ../..

# 6. Run both apps
pnpm dev
```

Backend runs on `http://localhost:4000`, frontend on `http://localhost:3000`.
Unauthenticated probes are `GET /health/live` (process) and `GET /health/ready` (database). Compose checks PostgreSQL and Redis health. Use `docker compose down -v` only when deliberately destroying local data to rehearse a clean deployment.

## Verifying the auth flow

1. Visit `http://localhost:3000`, sign up through the Clerk widget.
2. Confirm the webhook fired (check your backend logs or Clerk's webhook dashboard) and that a row appeared in the local `User` table with `role = STUDENT`.
3. Manually promote yourself to `SUPER_ADMIN` in the database (`UPDATE "User" SET role = 'SUPER_ADMIN' WHERE email = '...'`) — there's no UI for this yet, it's a Phase 9 admin-panel feature.
4. Call `GET /users` with your session token — it should now succeed (previously would 403 as a STUDENT).

## What's intentionally not here yet

Per the roadmap, Phase 2 was foundation only (auth/RBAC pattern below is what every future protected endpoint reuses). **Phase 3** (`03-phase3-decisions.md`) added design tokens, Arabic-first locale routing, the marketing homepage, `/curricula`, `/for-parents`, and live EGP pricing. **Phase 4** (`04-phase4-decisions.md`) added the onboarding wizard with a rule-based diagnostic. **Phase 5** (`05-phase5-decisions.md`) added the student dashboard. **Phase 6** (`06-phase6-decisions.md`) added the AI Service Layer, credit system, and AI Tutor. **Phase 7** (`07-phase7-decisions.md`) added the practice engine and quizzes/mock exams. **Phase 8** (`08-phase8-decisions.md`) added payments (Stripe as dev/test) and real EGP billing. **Phase 9** (`09-phase9-decisions.md`) added the role-scoped admin dashboard. **Phase 10** (`10-phase10-decisions.md`) added Fawry/InstaPay as honestly-classified planned providers, a real test suite, and production hardening. **A final Phase 10 acceptance review** (`11-phase10-acceptance-review.md`) then audited auth/authz, AI cost protection, concurrency, webhook security, production config, and database/ops against a strict checklist — finding and fixing several real gaps (a genuine concurrency race on the AI daily limit, a privilege-escalation path in role management, an untracked-billable-usage failure mode, non-idempotent webhook handling, and an unsafe production CORS default) and expanding the test suite from 20 to 67 tests. **Classification: Structurally Complete, with Internal Security Hardening Complete for all identified gaps — but Not Yet Production-Verified.** See `PRODUCTION-READINESS.md` and `11-phase10-acceptance-review.md` for the full detail; "production-ready" is deliberately not used anywhere in this project until real Clerk/OpenAI/Fawry credentials and a rehearsed deployment cycle exist.

## Verifying Phase 3–10 + acceptance review

```bash
pnpm install
pnpm test    # 67 tests across 11 spec files (no DB required — all use mocks)
pnpm dev
```

Visit `http://localhost:3000` — redirects to `/ar`. Sign up, complete onboarding, land on `/ar/dashboard`. Try `/ar/practice`, `/ar/quizzes`. Note: `/ar/tutor` now requires an active subscription (Phase 10 fix) — subscribe via `/ar/billing` first (Stripe test mode, if configured) before the AI Tutor will respond. Promote your account to `SUPER_ADMIN` in Postgres to access `/ar/admin`.

**Important — read `11-phase10-acceptance-review.md` and `PRODUCTION-READINESS.md` before deploying.** Nothing involving Clerk, OpenAI, or Stripe has been run against real credentials in this environment, and none of the new concurrency fixes have been exercised against a real concurrent-load test on a live database — both are explicit next steps, not completed verification.

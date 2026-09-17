# SMARTIFY — Handoff Checkpoint
**Date:** 2026-09-16
**Status:** Safe stop. No new phase started. No source code, database, or destructive action taken during this checkpoint — read-only verification only.

---

## Resume verification — 2026-09-17

The user instructed continuation. Phase 9.4E implementation and regression tests were already present in the working tree when this session resumed. The historical checkpoint below describes the earlier state; its statements that 9.4E is unstarted and the timezone issue is unfixed are superseded by this verification.

- Existing implementation uses UTC daily boundaries and explicit ISO-text `::timestamp` parameters for raw SQL usage-date keys, consistent with Prisma ORM reads. Quota and extra-credit refunds retain the original reservation day across midnight.
- Fresh default backend suite: **51 suites, 678 tests passed**.
- Fresh backend `tsc --noEmit`: **passed**.
- Both timezone suites, including the PostgreSQL suite: **20 tests passed with process TZ=UTC**, and **20 passed with process TZ=Africa/Cairo**. Each PostgreSQL run exercises both UTC and Africa/Cairo database session timezones.
- PostgreSQL timezone fixtures use connection-local temporary tables and a rolled-back transaction on the approved localhost:5432/smartify target. No persistent data migration or budget-setting change was performed.
- Commands ran through `apps/backend/node_modules/.bin/jest.CMD` and `tsc.CMD`, because `pnpm` was unavailable on this session's PATH. Timezone command: `jest.CMD --runInBand --silent --testPathIgnorePatterns=/node_modules/ --testPathPattern=ai-usage-timezone`, with the indicated `TZ` environment variable.
- This continuation verified existing source changes and updated this handoff; it did not modify application source. Frontend checks and the separate budget-concurrency PostgreSQL suite were not rerun in this continuation.

## 1. Project architecture and local services

- **Monorepo**: pnpm workspace, Turborepo (`turbo run <script>`), root at `D:\samrtify website\smartify-ai-phase10-final\smartify-ai`.
- **Frontend**: `apps/frontend` — Next.js **14.2.35** App Router, `[locale]` (`ar`/`en`) routing with RTL support, Clerk **5.7.6** auth. Must not be upgraded (standing hard rule across all phases).
- **Backend**: `apps/backend` — NestJS, Prisma/PostgreSQL via `@smartify/database` (`packages/database`).
- **Shared packages**: `packages/database` (Prisma schema/client, seed, migration/backup tooling), `packages/shared-types`, `packages/config`, `packages/validation`.
- **Local dev services** (not currently guaranteed running — verify before use): backend `nest start --watch` (or compiled `dist/main`), frontend `next dev`. Both were stopped at points during Phase 9.4D purely to release a Windows file lock on the Prisma query-engine DLL for `prisma generate` — if either is not currently running, that's expected, not a fault.
- **AI provider architecture**: `AIProviderFactory` resolves the active provider from `AIProviderConfig` (DB-driven, currently `openai`/`gpt-4o-mini`); TTS via a separate `TtsProviderFactory` (`gpt-4o-mini-tts`, voice `marin`).

## 2. Database identity and safety rules

- **Real database**: native PostgreSQL, `postgresql://…@localhost:5432/smartify`. `DATABASE_URL` lives in `apps/backend/.env` (not committed).
- **Never** use Docker Postgres on port 5433 (an `infra:up` script exists for a docker-compose Postgres/Redis stack — this is explicitly the forbidden target for any of this work).
- Owner: `omarmahdyaviation612@gmail.com`, role `SUPER_ADMIN`.
- All destructive-adjacent actions (backups, migrations) must go through the project's own safety tooling: `pnpm db:backup <label>`, `pnpm db:migrate:safe`, never `prisma migrate reset`, never raw destructive SQL. `packages/database/prisma/backup-guard.ts` validates target host (`localhost`/`127.0.0.1`/`::1`) and database name (`smartify`) before any `pg_dump`, and refuses to run under `NODE_ENV=production`.

## 3. Current migration count and status

- **11 migrations**, all applied, schema **up to date** (verified read-only via `prisma migrate status` at the start of this checkpoint).
- Most recent migration: `20260916075943_add_ai_budget_reservation` (Phase 9.4C) — purely additive (2 new tables + 1 enum, no destructive changes).
- Migration folders present but not yet committed to git: `20260915184006_add_question_draft` (pre-Phase-9.4, Question Bank work) and `20260916075943_add_ai_budget_reservation` (Phase 9.4C).

## 4. Current database baseline counts

(Read-only, verified at the start of this checkpoint — identical to the end of Phase 9.4D.)

| Table | Count |
|---|---|
| AIUsage | 96 |
| SystemConfig | 4 |
| AIDailyUsageCounter | 0 |
| User | 8 |
| StudentProfile | 6 |
| Question | 76 |
| QuestionDraft | 60 |
| AIDailyBudgetCounter | 0 |
| AIBudgetReservation | 0 |

## 5. Current live AI budget values

- `global_daily_ai_budget_usd` = **5** (USD/day, across all students) — `updatedAt: 2026-09-13T14:37:52.120Z`
- `per_user_daily_ai_budget_usd` = **0.25** (USD/day, per student) — `updatedAt: 2026-09-13T14:37:52.123Z`
- Both are **dev-safe placeholders**, not verified production-approved pricing. Unchanged since 2026-09-13, confirmed byte-identical (same value, same `updatedAt`) after every phase through 9.4D.

---

## 6. Completed phases and final verdicts

| Phase | Scope | Verdict |
|---|---|---|
| **9.3** | Privacy Policy, Terms of Service, payment-success UI safety re-verification | **PASS** |
| **9.4** | Trace + activate the USD AI-spend circuit breaker (`assertWithinBudget`), fail-closed on missing/invalid config | **PASS** |
| **9.4B** | Fresh-environment seed config (extraction + tests) + concurrent-overspend race analysis (documented, not fixed) | **PASS** |
| **9.4C** | Atomic USD budget reservation/reconciliation (`AIDailyBudgetCounter`, `AIBudgetReservation`), wired into all 5 AI entry points | **PASS** |
| **9.4D** | Real-PostgreSQL concurrency proof (found + fixed a real atomicity bug), retention audit + cleanup command, observability logging + admin visibility | **PASS** |

### Phase 9.3 — Privacy/Terms/payment-safety
- Added 4 real content gaps to `content/legal.ts` (parent/student linking, cookies, voice input, no-guarantee-of-outcomes), both EN+AR.
- Verified (no changes needed) `billing/success/page.tsx`, `billing.service.ts#getPaymentStatus()`, InstaPay status copy were already correctly backend-entitlement-gated.
- Added an InstaPay-specific test (`tests/instapay-payment-safety.cjs`) proving an uploaded receipt never displays "confirmed"/"active".

### Phase 9.4 — Circuit breaker activation
- Discovered the "keys don't exist" premise was stale — both budget `SystemConfig` rows already existed with valid values.
- The real gap: `assertWithinBudget` treated a missing/invalid budget key as "unlimited" rather than fail-closed, and didn't validate NaN/Infinity/zero/negative.
- Fixed via new `budget-config.util.ts` (`parseBudgetUsd`), shared between the enforcement path and the admin display.

### Phase 9.4B — Seed + concurrency documentation
- Extracted the seed's two budget-key upserts into `seed-ai-budget-config.ts` (pure refactor, testable in isolation) — confirmed idempotent, never overwrites an existing value.
- Proved (via mocked concurrent calls) that `assertWithinBudget` is a genuine TOCTOU race — documented, deliberately not fixed in this phase.

### Phase 9.4C — Atomic reservation system
- New tables `AIDailyBudgetCounter` (atomic per-scope/day accumulator) and `AIBudgetReservation` (per-request idempotent ledger).
- `reserveBudget()`/`reconcileBudget()`/`releaseBudget()` wired into `TutorService`, `TutorSpeechService`, `InteractiveLessonService`, `QuestionDraftGeneratorService`, `LessonDraftGeneratorService`.
- Migration `20260916075943_add_ai_budget_reservation` applied via `pnpm db:migrate:safe`, with a verified pre-migration backup.

### Phase 9.4D — Real-DB proof, retention, observability
- Real PostgreSQL integration test (`ai-budget-reservation.postgres.spec.ts`, isolated via test-only scope keys, excluded from the default `npx jest` run) found a genuine bug: a fresh row's first reservation attempt bypassed the limit entirely (`INSERT...ON CONFLICT...WHERE` only gates the conflict branch). Fixed with a two-statement atomic pattern.
- Also surfaced a **separate, pre-existing, unfixed** bug: `getRemainingToday()`'s raw-SQL writes vs. ORM reads disagree on `DateTime` serialization on non-UTC machines — see Section 11.
- Added a dry-run-capable retention cleanup script and structured RESERVED/RECONCILED/RELEASED observability logging + admin `globalCommittedUsdToday` visibility.

---

## 7. Exact files changed, per phase

**Phase 9.3**
- Modified: `apps/frontend/content/legal.ts`, `apps/frontend/tests/legal-pages.cjs`
- New: `apps/frontend/tests/instapay-payment-safety.cjs`

**Phase 9.4**
- New: `apps/backend/src/ai/usage/budget-config.util.ts`
- Modified: `apps/backend/src/ai/usage/ai-usage.service.ts`, `apps/backend/src/ai/usage/ai-usage.service.spec.ts`, `apps/backend/src/admin/ai-config/admin-ai-config.service.ts`

**Phase 9.4B**
- New: `packages/database/prisma/seed-ai-budget-config.ts`, `apps/backend/src/ai/usage/seed-ai-budget-config.spec.ts`
- Modified: `packages/database/prisma/seed.ts`, `apps/backend/src/ai/usage/ai-usage.service.spec.ts`

**Phase 9.4C**
- Modified: `packages/database/prisma/schema.prisma` (2 models + 1 enum), `apps/backend/src/ai/usage/ai-usage.service.ts`, `apps/backend/src/tutor/tutor.service.ts` (+`.spec.ts`), `apps/backend/src/tutor/tutor-speech.service.ts` (+`.spec.ts`), `apps/backend/src/interactive-lesson/interactive-lesson.service.ts` (+`.spec.ts`), `apps/backend/src/interactive-lesson/lesson-draft-generator/lesson-draft-generator.service.ts` (+`.spec.ts`), `apps/backend/src/question-bank/question-draft-generator/question-draft-generator.service.ts` (+`.spec.ts`)
- New: `packages/database/prisma/migrations/20260916075943_add_ai_budget_reservation/migration.sql`, `apps/backend/src/ai/usage/ai-budget-reservation.spec.ts`

**Phase 9.4D**
- Modified: `apps/backend/jest.config.js`, `apps/backend/package.json`, root `package.json`, `apps/backend/src/ai/usage/ai-usage.service.ts`, `apps/backend/src/ai/usage/ai-budget-reservation.spec.ts`, `apps/backend/src/admin/ai-config/admin-ai-config.service.ts` (+`.spec.ts`)
- New: `apps/backend/src/ai/usage/ai-budget-reservation.postgres.spec.ts`, `apps/backend/src/ai/usage/budget-reservation-cleanup.spec.ts`, `packages/database/prisma/cleanup-budget-reservations.ts`

*(Other modified/untracked files visible in `git status` — e.g. `app.module.ts`, `curricula.service.ts`, `dashboard.service.ts`, `onboarding.service.ts`, `practice.service.ts`, `quizzes.service.ts`, `apps/frontend/app/[locale]/onboarding/diagnostic/page.tsx`, the `question-bank/` directory, `voice-bakeoff/` — predate Phase 9.3 and belong to earlier Question Bank / Phase 10E-10F work, not any phase covered by this checkpoint.)*

## 8. Exact migrations added

1. `20260915184006_add_question_draft` — pre-Phase-9.4 (Question Bank), not covered by this checkpoint's phases.
2. `20260916075943_add_ai_budget_reservation` — Phase 9.4C. Adds `AIDailyBudgetCounter`, `AIBudgetReservation`, `AIBudgetReservationStatus` enum. Purely additive; no data migration, no destructive statements.

No migration was added in Phase 9.3, 9.4, 9.4B, or 9.4D.

## 9. Backup path(s) and verification status

- The backup that immediately preceded the Phase 9.4C migration: **`backups/postgres/smartify_pre_migration_20260916_105939.pgdump`** (154,307 bytes) — verified via `pg_restore --list` (273 TOC entries, valid custom-format archive, `dbname: smartify`) before the migration ran.
- Several earlier same-day backups exist from retried migration attempts (`smartify_phase9_4c_pre_migration_20260916_105129.pgdump`, `smartify_pre_migration_20260916_105146/105602/105702.pgdump`) — all valid, all superseded by the one above as the operative pre-migration snapshot.
- `backups/postgres/` also contains a long history of prior-session backups (Phase 10E/F content work, `baseline_pre_reconstruction`, `post_reconstruction`, etc.) — untouched, still present.

## 10. Current test results

| Check | Result |
|---|---|
| Backend full suite (`npx jest`, mocked, no DB) | 664/664 pass |
| Frontend suite (`.cjs`) | 112+/118 pass — 6 pre-existing documented gaps (2 need real Chrome/Clerk network, 4 need a `useSearchParams` mock the shared harness doesn't provide) |
| Real PostgreSQL integration (`pnpm test:postgres-integration`, live DB) | 7/7 pass |
| Cleanup script unit tests (mocked) | 8/8 pass |
| Backend type-check (`tsc --noEmit`) | Clean |
| Frontend type-check (`tsc --noEmit`) | Clean |
| Frontend production build (`next build`) | Success |
| Migration status | 11 migrations, up to date |

All results as of the end of Phase 9.4D and re-confirmed (migration status + row counts only) at the start of this checkpoint.

## 11. Remaining known risks

1. **`getRemainingToday()` timezone mismatch** — on a non-UTC machine, raw-SQL writes to `AIDailyUsageCounter` (via `reserveDailySlot`) and the ORM (`findUnique`) read in `getRemainingToday()` serialize the same JS `Date` differently for the `timestamp without timezone` column, so the read never finds the row the write created. Likely means "N of 10 questions remaining today" has never displayed correctly in any non-UTC deployment. **Does not affect actual enforcement** (`reserveDailySlot` is internally self-consistent, raw-SQL-only) — display only. Confirmed via direct reproduction during Phase 9.4D; not fixed (out of that phase's scope).
2. **Heuristic token-cost estimate** — `estimateMaxChatCostUsd()`'s 3-chars/token divisor is a conservative heuristic (errs high), not a formally proven bound for every possible provider/tokenizer. Output is capped by the real `max_tokens: 600` ceiling, so this is a soft, not hard, risk.
3. **Reservation-table retention** — `AIDailyBudgetCounter`/`AIBudgetReservation` grow indefinitely (no automatic pruning); a cleanup script (`pnpm db:budget-cleanup` / `:preview`) is implemented and dry-run-verified but has never been run for a real deletion, since both tables are currently empty. Worth a first real run once meaningful volume accumulates (estimated ~10,000-user scale before it meaningfully matters — see the Phase 9.4D report for the full growth table).
4. **Production budget values not yet approved** — `$5`/day global and `$0.25`/day per-user are dev-safe placeholders only, editable via `Admin > Platform Config > AI Spending Controls`. A real business decision on production limits is still outstanding.

## 12. Explicit next recommended phase

**Phase 9.4E — timezone-consistency fix**, addressing risk #1 above: reconcile the raw-SQL-vs-ORM `DateTime` serialization mismatch for `usageDate`-keyed tables (`AIDailyUsageCounter`, and by the same pattern potentially `AIDailyBudgetCounter`/`AIBudgetReservation`), most urgently to correct `getRemainingToday()`'s display. **This phase has explicitly NOT been started or run as part of this checkpoint.**

## 13. Explicit instructions — do NOT, without further explicit approval

- Do **not** reset, recreate, or drop the database, or run `prisma migrate reset`.
- Do **not** delete QA users, QA attempts, quiz results, learning plans, or any existing curriculum/content.
- Do **not** generate or publish new Questions/QuestionDrafts.
- Do **not** start Phase 10G.
- Do **not** change `global_daily_ai_budget_usd` or `per_user_daily_ai_budget_usd` without explicit owner approval.
- Do **not** run `pnpm db:budget-cleanup` (the real, non-dry-run deletion) without explicit approval, even though it is designed to be safe/bounded.
- Do **not** run Phase 9.4E, or any other new phase, until explicitly instructed to resume.

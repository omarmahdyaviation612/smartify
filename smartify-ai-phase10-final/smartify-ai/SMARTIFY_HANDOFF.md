# SMARTIFY AI — PROJECT HANDOFF

Generated: 2026-09-13, end of Phase 9.2.1. Read this first in a new session.
Do not rescan the whole repo unless evidence here is missing or contradicted
by what you find — then trust the repo, not this doc, and update this file.

---

## 1. ARCHITECTURE SUMMARY

**Monorepo**: pnpm workspaces + Turborepo. Root: `smartify-ai-phase10-final/smartify-ai/`.

- **Frontend**: `apps/frontend` — Next.js 14 (App Router), `app/[locale]/...` structure (ar/en), Tailwind, `@smartify/ui` shared components. Runs via `next start -p 3000`.
- **Backend**: `apps/backend` — NestJS 10, modular (one module per domain under `src/`). Runs via `node dist/main.js` (compiled with `nest build`; there is no `tsx`/`ts-node` available in this environment — one-off scripts under `src/scripts/*.ts` must be built with `npx nest build` then run as `node dist/scripts/<name>.js`). Port 4000.
- **Database**: `packages/database` — Prisma 5.18 + PostgreSQL, schema at `packages/database/prisma/schema.prisma`. Shared singleton client exported as `prisma` from `@smartify/database`; `PrismaService` (`apps/backend/src/prisma/prisma.service.ts`) just wraps it for Nest lifecycle.
- **Shared packages**: `@smartify/config` (env loading/validation, `loadBackendEnv()`), `@smartify/shared-types` (e.g. `UserRole` enum), `@smartify/ui`, `@smartify/validation`.
- **Redis**: runs in `docker-compose` but **is not actually wired into the backend** (not used for caching/sessions/rate-limiting yet — throttling is in-memory only).

### Authentication
Clerk (`@clerk/backend`). `ClerkAuthProvider` (`src/auth/clerk-auth.provider.ts`) verifies session tokens and looks up the Clerk user; `ClerkAuthGuard` attaches the local `User` row to the request; `RolesGuard` (`src/common/guards/roles.guard.ts`, 5 passing unit tests) checks `request.user.role` against `@Roles(...)` decorators — pure logic, no Clerk dependency itself. **`CLERK_SECRET_KEY` in this local `.env` is a REAL, working Clerk test-mode key** (confirmed live in Phase 9.2.1 — earlier phases incorrectly assumed no real Clerk credentials existed in this sandbox; that was wrong for this specific key). Full interactive HTTP+Clerk-session login has still never been exercised end-to-end in this project.

### AI Tutor architecture
`src/ai/` — `AIProviderFactory` resolves the active provider from the `AIProviderConfig` DB table (currently `openai`, `isActive=true`). `OpenAIProvider` calls the real OpenAI API (`gpt-4o-mini`), fails fast without `OPENAI_API_KEY`. Cost/abuse controls in `AIUsageService`: atomic per-subject daily question limit (`AIDailyUsageCounter`, race-condition-safe `INSERT...ON CONFLICT`), optional global/per-user daily USD budget caps (`SystemConfig` keys `global_daily_ai_budget_usd`/`per_user_daily_ai_budget_usd` — **not currently set**, so code-level fallback defaults apply), input cap `MAX_MESSAGE_CHARS=4000`, atomic usage-recording with `logUntrackedUsage()` fallback. `AIContextBuilderService` (`src/ai/context/ai-context-builder.service.ts`) is the ONE place all tutor/lesson/draft-generation prompts are built.

### TTS architecture
`src/tutor/tts/` — provider-factory pattern mirroring AI/payments. **Frozen/accepted for MVP per this handoff's instructions — do not change provider/model/voice/speed before launch unless explicitly asked.**

### Curriculum architecture
`Curriculum → Grade → Subject → Unit → Topic → Lesson` hierarchy. Visibility is controlled ONLY by `isActive` flags on `Curriculum`, `Grade`, and `Subject` (Topic/Unit have no `isActive` column — their reachability is entirely inherited from their Subject/Grade/Curriculum). Public/onboarding-facing queries (`CurriculaService.getPublicCatalog()` AND `getStructureSample()`, both in `src/curricula/curricula.service.ts`) filter at all three levels — this was a real bug in `getStructureSample()` until the Phase 9.1-correction fixed it (see §2).

### Lesson/session architecture
`src/interactive-lesson/` — `InteractiveLessonService` drives a step-by-step state machine per `(studentId, topicId)` via `LessonSession.currentStepIndex` + `LessonSession.stepResultsJson` (schemaless `Json` array of `StepResult`). Steps come from `Topic.teachingStepsJson` (types: INTRO/EXPLAIN/EXAMPLE/CHECK/REVIEW/COMPLETE). Deterministic arithmetic CHECK steps are graded in code (`answer-validators/deterministic-validator.ts`) before the model narrates — the model never overrides a deterministic grade. Each AI call is stateless/history-free by design (`runLessonAI` sends only one fresh user turn, no replayed conversation history — this was confirmed by code reading, not an assumption).

### Teaching Strategy Engine (Phase 8/8.1) — see §5 for the frozen decision
Pure deterministic logic in `src/interactive-lesson/teaching-strategy.util.ts`: `TeachingStrategy = CONCRETE_OBJECTS | NUMBER_LINE | SIMPLE_SYMBOLIC`, stored per-step in `StepResult.strategy`/`.strategyHistory` (no schema migration needed — reuses the schemaless JSON column). `decideStrategySwitch()` fires only on the 2nd meaningful wrong answer on a *conceptual* CHECK step. Guidance text is injected into `AIContextBuilderService`'s lesson-teaching prompt via a `STRATEGY OVERRIDE RULE` line that explicitly states the objective defines WHAT and the strategy defines HOW, with the strategy winning on conflict.

### Payment/subscription architecture
`Subscription` (per-student, unique on `studentId`; `status: pending|active|canceled|past_due`; `monthlyTotalEGP` snapshotted at subscribe time) + `PricingPlan` (keyed by Curriculum × Level). Generic automated-gateway abstraction exists in `src/payments/` (`PaymentProviderFactory`, `StripeProvider` real-but-dev-only, `FawryProvider`/`PaymobProvider`/`PayPalProvider`/the OLD `payments/providers/instapay.provider.ts` all unimplemented stubs, gated by `PaymentProviderConfig` DB rows — **all `isActive=false`**). **This generic-gateway InstaPay stub is NOT what the MVP uses — see next section.**

### Manual InstaPay architecture (the actual MVP payment mechanism) — separate module, fully built
`src/instapay/` (student-facing) + `src/admin/instapay/` (admin-facing) — completely independent of the generic `PaymentProviderFactory`/`PaymentProviderConfig` system above. Gated only by env vars `INSTAPAY_RECIPIENT_NAME`/`INSTAPAY_RECIPIENT_HANDLE` (set to test values locally). Flow: student `POST /instapay/subscription/initiate` (or `/question-pack/initiate`) → generates a reference (`SMAI-S-...`/`SMAI-P-...`), creates a `pending` `Subscription` row → student transfers money out-of-band → `POST /instapay/submissions` uploads a receipt (magic-byte-sniffed JPEG/PNG, 5MB cap, ownership-scoped, duplicate-reference blocked) → admin (`SUPER_ADMIN`/`ADMIN` only) reviews via `/admin/instapay/pending|history`, views the receipt (`Cache-Control: private, no-store`), and `confirm()`s (activates entitlement via `BillingService.applyWebhookEvent()` **before** marking `VERIFIED`, idempotent, audit-logged) or `reject()`s (audit-logged, grants nothing). Frontend: `app/[locale]/billing/instapay/page.tsx` (student) + `app/[locale]/admin/instapay/page.tsx` (admin), both wired up; `billing/page.tsx` links to the InstaPay checkout page.

**Verified live at the real service/DB layer in Phase 9.2 (see §2) — confirm→active, reject→still pending, duplicate-confirm→blocked with no double entitlement, receipt retrieval intact, exactly the expected audit-log count.** Never exercised over real authenticated HTTP (no real Clerk session token was ever obtained — see §3).

### Admin architecture
`RolesGuard` + `@Roles(SUPER_ADMIN, ADMIN)` (or narrower) on every admin controller. No self-service admin promotion exists by design (Phase 10 acceptance review closed the self/privilege-escalation hole) — the only way to create the first admin is a direct, deliberate DB write after verifying a real Clerk identity (exactly what Phase 9.2.1 did for the real owner).

### Backup/migration safety architecture — see §7, this is critical

---

## 2. PHASE HISTORY — FINAL ACCEPTED STATE

All CLOSED/PASS phases below are supported by evidence already in the repo (reports in this conversation, `docs/*.md`, migration files, DB state, test files) — not reconstructed from guesses.

| Phase | Status | Key outcome |
|---|---|---|
| Phase 2–4 | CLOSED (pre-existing, part of original bulk import) | Clerk auth pattern, onboarding, curriculum browsing established. See `02-phase2-decisions.md`–`04-phase4-decisions.md` at repo root (from the *original* Phase 1–10 import, numbering coincidentally overlaps with the later, unrelated "Phase 5+" work stream below — don't confuse the two). |
| Phase 5 | CLOSED/PASS | Lesson content-generation pipeline (draft-only, AI plans step structure, human review required before publish). Commit `951c517`. |
| R1 / reconstruction, R2 | CLOSED | Draft regeneration/correction round for "Addition with Zero" (`regenerate-lesson-draft-phase5-r2.ts`, `edit-lesson-draft-r2-1-conceptual-check.js`). |
| Phase 6 | CLOSED/PASS | `LessonPublishService` (draft→Topic publish, idempotent, `LessonDraft.publishedTopicId` unique-linked — the only schema migration in this whole work stream, `20260912200000_add_lesson_draft_publish_link`). `phase6-approve-and-publish.ts`, `phase6-rollback-test.ts`. |
| Phase 7 | CLOSED/PASS | Live QA of the published "Addition with Zero" topic via real `InteractiveLessonService` calls + real OpenAI. `phase7-live-qa.ts`. QA user: `qa-phase7-addition-with-zero@smartify.test`. |
| Phase 7.1 / 7.2 | CLOSED | Follow-up live QA proving HTTP/Clerk/TTS layers separately. QA user: `qa-phase71-addition-with-zero@example.com`. |
| Phase 8 | CLOSED/PASS | Teaching Strategy Engine V1 built + live-piloted (`phase8-strategy-pilot.ts`). Real OpenAI calls confirmed the deterministic switch fires correctly, **but** post-switch tutor responses still used apples/concrete-object framing — a real, evidenced defect, not a hypothesis. |
| Phase 8.1 | CLOSED/PASS | Fixed the Phase 8 prompt-adherence defect: strengthened `NUMBER_LINE` guidance (explicit object-word ban, required number-line/zero-steps framing) + added a WHAT-vs-HOW `STRATEGY OVERRIDE RULE` line. Re-verified live with 2 real OpenAI calls — confirmed materially different (number-line-framed, zero apples) output. 77 new/updated tests, all passing. |
| Phase 9 (audit) | CLOSED | Comprehensive read-only MVP launch-readiness audit. Found: manual InstaPay was already fully built (contradicting the stale `PRODUCTION-READINESS.md`), curriculum visibility was inverted (placeholders active, real content hidden), no admin user existed, no privacy/terms pages exist. |
| Phase 9.1 | CLOSED/PASS | Data-only fix for the curriculum-visibility finding: activated real Grade 1/Mathematics (Egyptian National Curriculum), deactivated all 10 `[PLACEHOLDER]` grades. Verified via the real `curricula.service.ts` visibility logic. Backup taken and verified first. |
| Phase 9.1-correction | CLOSED/PASS | Found (via live endpoint test) that `getStructureSample()` had NO `isActive` filtering, unlike `getPublicCatalog()` — leaked placeholder content even after Phase 9.1. Fixed (`curricula.service.ts`, `findFirst({isActive:true})` + `where:{isActive:true}` on grades/subjects), added 4 regression tests, re-verified live via HTTP after rebuild+restart. Independently reviewed and confirmed PASS by Codex supervisor. |
| Phase 9.2 | CLOSED/PASS | Manual InstaPay dry run at the real service/DB layer (no real money, synthetic labeled receipts). See §4 below for full result. |
| Phase 9.2.1 | CLOSED/PASS | Bootstrapped the real owner as `SUPER_ADMIN`, with Clerk identity verified live against the real Clerk Backend API first (not fabricated). See §3. |

**Not yet started: Phase 9.3 onward.**

---

## 3. OWNER / ADMIN STATE

**REAL OWNER CONFIGURATION:**
- Email: `omarmahdyaviation612@gmail.com`
- Role: `SUPER_ADMIN`
- Clerk identity: verified live against the real, configured Clerk test-mode Backend API before the DB write (exact email match, not banned, one unambiguous match). The `User.clerkUserId` column already holds this real, legitimate Clerk ID — not reproduced here per instruction (no secrets/full IDs in this doc).
- HTTP+real-Clerk-session authentication has **not** been verified end-to-end (no interactive browser sign-in was performed; minting a synthetic session via the Backend API was deliberately not done — judged out of scope without your direct say-so).

**LOCAL QA/TEST DATA — do not confuse with the above:**
- `qa-phase92-admin-bootstrap@smartify.test` — role `ADMIN`, QA-only, created for the Phase 9.2 dry run. **Not the real owner.** Currently has 2 real `AuditLog` entries attached (the Phase 9.2 confirm+reject actions) — recommend deactivating (`isActive=false`) rather than deleting before any production promotion, to preserve that audit trail.

---

## 4. PHASE 9.2 RESULT (manual InstaPay verification — do not re-run this)

Verified at the real service/DB layer (`InstapayService`/`AdminInstapayService`/`BillingService`, via `NestFactory.createApplicationContext`, no real HTTP/Clerk):

- **Confirm path**: initiate → synthetic labeled receipt submitted (`PENDING_VERIFICATION`) → admin `confirm()` → `VERIFIED` → **`Subscription.status` → `active`**.
- **Duplicate confirm**: threw `"This payment has already been processed."`, subscription unchanged — no double entitlement.
- **Reject path**: separate payer, admin `reject()` → `REJECTED` → **`Subscription.status` stayed `pending`** — no entitlement granted.
- Admin review surface (`listPending`/`listHistory`/`getReceipt`) all confirmed working.
- Exactly 2 `AuditLog` rows (`instapay.confirm`, `instapay.reject`) — duplicate attempt added no third entry.
- **Zero AI/TTS/image calls** (verified: `AIUsage` count unchanged throughout).
- No real money moved — both receipts were synthetic, explicitly labeled "NO REAL TRANSFER."

**Decision: manual InstaPay is the MVP payment method. Do not build Stripe/PayPal/Fawry/Paymob before MVP unless explicitly requested.**

---

## 5. TEACHING STRATEGY DECISION — FROZEN FOR MVP

**ACCEPTED. Do not expand the strategy catalog before MVP unless explicitly requested.**

Proven live (Phase 8 + 8.1, real OpenAI calls): `CONCRETE_OBJECTS` → after 2 meaningful conceptual failures → `NUMBER_LINE`. Objective (`Topic.teachingStepsJson[].objective`) determines WHAT to teach; the Teaching Strategy determines HOW; Phase 8.1 made the strategy explicitly win on conflict (e.g., an objective's own apples-example text vs. the number-line requirement). `SIMPLE_SYMBOLIC` is defined in the type but has no wired transition — leave as-is.

---

## 6. TTS DECISION — FROZEN FOR MVP

**ACCEPTABLE FOR MVP. Do not change provider/model/voice/speed before launch unless explicitly requested.**

---

## 7. DATABASE SAFETY — CRITICAL, READ BEFORE ANY MIGRATION/SEED COMMAND

**Expected target, always verify before any write:** `localhost:5432`, database `smartify`, native Windows PostgreSQL 18.6 service. **The Docker Postgres container on port 5433 (`smartify-ai-postgres-1`) is a stale historical artifact, NOT the real dev DB** — it was inspected read-only during incident forensics and predates the interactive-lesson engine entirely. Never target it.

**Incident history**: on 2026-09-12, during Phase 6 work, the dev database lost all row data (schema survived, `_prisma_migrations` was dropped) — suspected cause: a non-interactive `prisma migrate dev` invocation performing a drop-and-recreate before hitting its own "non-interactive environment" error. Full writeup: `docs/incident-2026-09-12-database-reset.md`. Data was reconstructed from committed seed scripts (not recovered) plus the AI draft-generation pipeline re-producing "Addition with Zero."

**Safety tooling that now exists as a direct result — always use it:**
- `pnpm db:backup` → `packages/database/prisma/backup-guard.ts` — validates target (host/db-name/`NODE_ENV`), takes a timestamped `pg_dump` to `backups/postgres/`, verifies non-zero size. Backups from this session: `smartify_pre_migration_20260913_043438.pgdump`, `_045058.pgdump`, `_045853.pgdump` (all in `backups/postgres/`, gitignored).
- `pnpm db:migrate:safe` → `packages/database/prisma/migrate-safe.ts` — same validation + backup, THEN runs `prisma migrate dev`, fails closed at every step.
- **Rule: never run bare `prisma migrate dev`/`migrate reset`/`db push --force-reset` against this database. Always `db:migrate:safe`, always with a verified backup immediately before, always with explicit authorization for anything destructive.**
- Backup/restore was genuinely rehearsed end-to-end (not just documented) on 2026-09-12 — see `docs/backup-restore-procedure-2026-09-12.md`. Row counts, FK integrity, and a real app boot against the restored copy were all verified.
- Known unresolved gap: Postgres `log_statement` is not configured — limited forensics during the incident. Recommended (not urgent): enable at least `ddl` logging before production.

**Current migration status (verified fresh, this session): 8 migrations applied, 0 unfinished, no drift.** The only migration from the "Phase 5+" work stream is `20260912200000_add_lesson_draft_publish_link` (Phase 6, `LessonDraft.publishedTopicId`) — the Teaching Strategy Engine and manual InstaPay both required **zero** schema migrations (reused existing schemaless JSON / existing tables).

---

## 8. CURRENT CURRICULUM STATE (verified fresh this session, post-Phase-9.1 — do not trust the old Phase 9 audit numbers, they predate the fix)

Via the exact same nested `isActive` visibility logic the app itself uses:

- **Visible curriculum**: exactly one — "Egyptian National Curriculum (Arabic)".
- **Visible grade**: exactly one — "Grade 1".
- **Visible subject**: exactly one — "Mathematics".
- **Real reachable topics (4, all 7 teaching steps each, unchanged/intact)**: "Addition (Part 1)", "Addition with Zero", "Comparing Numbers (Greater/Less)", "Subtraction (Part 1)".
- **Placeholder grades**: 0 remain active (all 10 confirmed deactivated).
- **Reachable empty placeholder topic**: 0 (confirmed — the `getStructureSample()` leak from before the Phase 9.1-correction is fixed and re-verified live).

**Still true from the Phase 9 audit (not yet addressed, not this session's scope):** only 4 real topics total exist — sufficient for a technical soft launch or small closed beta, **not sufficient for a public paid MVP**. No content was generated or changed this session.

---

## 9. CURRENT DB QA STATE (verified fresh this session — counts only, no sensitive values)

| Table | Count | Breakdown |
|---|---|---|
| User | 7 | 1 `SUPER_ADMIN` (real owner), 1 `ADMIN` (QA-only, `qa-phase92-admin-bootstrap@smartify.test`), 5 `STUDENT` (3 from Phases 7/7.1/8: `qa-phase7-addition-with-zero@smartify.test`, `qa-phase71-addition-with-zero@example.com`, `qa-phase8-strategy-pilot@smartify.test`; 2 from Phase 9.2: `qa-phase92-instapay-confirm@smartify.test`, `qa-phase92-instapay-reject@smartify.test`) |
| Subscription | 2 | 1 `active` (Phase 9.2 confirm-path payer), 1 `pending` (Phase 9.2 reject-path payer, correctly never activated) |
| InstapayPaymentSubmission | 2 | 1 `VERIFIED`, 1 `REJECTED` |
| AuditLog | 2 | `instapay.confirm` ×1, `instapay.reject` ×1 |
| AIUsage | 34 | Unchanged since Phase 8.1 — confirms zero AI calls across all of Phase 9/9.1/9.2/9.2.1 |

**All of the above except the real owner `User` row is local-dev-only QA/test data** — none of it will migrate to a fresh production database (which starts empty via `prisma migrate deploy` + seed, not a copy of this dev DB). No cleanup action is required before production for that reason alone; the one exception already noted in §3 (QA admin's audit trail) is about *this* database specifically, if it were ever promoted rather than replaced.

---

## 10. LAUNCH STATUS (updated from current state — do not re-list already-completed items as open work)

**Resolved since the original Phase 9 audit (do NOT re-flag these):**
- ~~InstaPay not implemented~~ — fully built and now live-verified (Phase 9.2).
- ~~No admin user exists~~ — real owner SUPER_ADMIN now bootstrapped (Phase 9.2.1).
- ~~Curriculum visibility inverted~~ — fixed and verified, twice (Phase 9.1 + the structure-sample correction).

**Still open, starting point for Phase 9.3 onward:**
1. Privacy Policy + Terms of Service pages — still absent anywhere in `apps/frontend` (verify still true before building — not re-checked this session, but no work has touched the frontend since the Phase 9 audit found this).
2. Payment-success page (`billing/success`) still shows an unconditional "You're subscribed!" regardless of real state — not re-verified this session, flagged in the original Phase 9 audit and in the 2026-09-10 manual QA doc; check current state before fixing.
3. AI budget `SystemConfig` values (`global_daily_ai_budget_usd`/`per_user_daily_ai_budget_usd`) still unset, running on code fallback defaults.
4. Production configuration/deployment readiness — CORS/Redis/logging findings from the Phase 9 audit stand unchanged (nothing in Phases 9.1/9.1-correction/9.2/9.2.1 touched this area).
5. Real Grade 1 Mathematics content expansion beyond the current 4 topics, before treating this as a public paid MVP (§8).

**Do NOT build**: Stripe/Fawry/Paymob/PayPal, Teaching Strategy catalog expansion, multi-instance/Redis-backed rate limiting, new content-generation tooling (the Phase 5/6 pipeline already works) — none of these are MVP blockers per the accepted Phase 9 audit findings.

---

## 11. GIT / WORKSPACE SNAPSHOT

- Branch: `main`
- HEAD: `951c5172f2f53c46cdf9f1eda9b0bed735301b06` — "Add Phase 5 lesson content-generation pipeline (draft-only, not published)"
- Working tree: dirty, nothing committed since HEAD across all of Phases 5–9.2.1 (all work described in this document exists only as uncommitted working-tree changes).

**Pre-existing baseline (Phases 5–9, NOT newly created by 9.1/9.1-correction/9.2/9.2.1 — do not re-attribute):**
Modified: `.gitignore`, `ai-context-builder.service.ts`+`.spec.ts`*, `interactive-lesson.module.ts`, `interactive-lesson.service.ts`+`.spec.ts`, `interactive-lesson.types.ts`, `lesson-draft-generator.service.ts`+`.spec.ts`, `lesson-draft.types.ts`, `generate-lesson-draft-phase5.ts`, root `package.json`, `packages/database/package.json`, `schema.prisma`, `seed*.js`/`seed.ts`, `pnpm-lock.yaml`.
Untracked: `lesson-publish.service.ts`+`.spec.ts`, `teaching-strategy.util.ts`+`.spec.ts`*, `phase6-approve-and-publish.ts`, `phase6-rollback-test.ts`, `phase7-live-qa.ts`, `phase8-strategy-pilot.ts`, `phase8-1-number-line-check.ts`, `regenerate-lesson-draft-phase5-r2.ts`, `docs/incident-2026-09-12-database-reset.md`, `packages/database/ar-home.png`, `backup-guard.ts`, `edit-lesson-draft-*.js`, `migrate-safe.ts`, the one migration folder.

*`ai-context-builder.service.ts`/`.spec.ts` and `teaching-strategy.util.ts`/`.spec.ts` were further modified/extended in Phase 8.1 (prompt-adherence fix) — still part of the pre-9.1 baseline as of this snapshot.

**New in Phase 9.1 / 9.1-correction / 9.2 / 9.2.1 (this is the actually-new work):**
- Modified: `apps/backend/src/curricula/curricula.service.ts` (the `getStructureSample()` `isActive`-filter fix).
- Untracked (new files): `apps/backend/src/curricula/curricula.service.spec.ts` (4 regression tests), `apps/backend/src/scripts/phase9-2-instapay-dry-run.ts`, `apps/backend/src/scripts/phase9-2-1-owner-clerk-precheck.ts`, `apps/backend/src/scripts/phase9-2-1-owner-bootstrap.ts`.
- Phase 9.1 itself and Phase 9.2/9.2.1's identity bootstrap were pure **database** writes (no source files) — see §7/§9 for what changed.

Nothing has been committed to git at any point in this work stream — all of it is live in the working tree only.

---

## 12. VERIFICATION SNAPSHOT (re-run fresh this session, not just cited from memory)

```
npx jest        → Test Suites: 41 passed, 41 total | Tests: 435 passed, 435 total
npx tsc -p . --noEmit → 0 errors
```
All mocked — no live OpenAI/TTS/image calls were made to produce this snapshot. Live-verified evidence (real OpenAI calls, real InstaPay flow) is documented separately in §2/§4/§5 above and was NOT re-run to produce this handoff.

---

## 13. NEXT SESSION — START HERE

1. Read this handoff (`SMARTIFY_HANDOFF.md`) first, in full, before touching anything else.
2. Do NOT rescan the entire repository unless something here is missing or contradicted by what you find in the repo.
3. Inspect only the files relevant to the next phase you're asked to do.
4. Preserve all database safety rules in §7 — verify target identity, take a verified backup via `pnpm db:backup`, before any write.
5. Do not repeat already-completed live AI/TTS/payment QA (§2, §4) — it's done and evidenced; re-run only if something has since changed or you're explicitly asked to re-verify.
6. The next phase is **Phase 9.3** — pick from the "still open" list in §10 (Privacy/Terms, payment-success fix, AI budget config, production config, content expansion) based on what the user actually asks for next; don't assume the order.
7. Keep phases small and scoped, exactly like 9.1/9.1-correction/9.2/9.2.1 were.
8. After each phase, STOP and report for independent review — do not chain multiple phases in one turn.
9. Do not automatically proceed to the following phase without the user (or their supervisor process) explicitly authorizing it.
10. Optimize for MVP launch — do not expand scope, catalogs, providers, or architecture beyond what's already accepted and frozen in §5/§6/§10's "Do NOT build" list, unless explicitly requested.

# Curriculum-Grounded Homework Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a paid, photo-based homework coach that guides students through one exercise using only grounded material from their own curriculum and grade.

**Architecture:** Add a dedicated Homework backend domain for image intake, grounded-topic matching, atomic exercise allowance, resumable sessions, and coached turns. Reuse current Clerk authentication, subject entitlements, curriculum grounding helpers, AI provider abstraction, actual usage ledger, spend budgets, and the student's single subscription; expose the experience in a new localized frontend page and billing flow.

**Tech Stack:** Next.js 14 App Router, React 18, NestJS 10, Prisma 5, PostgreSQL, Clerk, existing AIProviderFactory and payment-provider abstractions, Tailwind CSS, Jest.

**Spec:** `docs/superpowers/specs/2026-10-07-curriculum-grounded-homework-helper-design.md`

## Global Constraints

- Student selects one entitled subject and submits one exercise image at a time.
- Topic matching is restricted to the student's curriculum, grade, entitled subject, active topics, and valid current grounding assignments.
- Do not start tutoring without a confirmed grounded topic; do not fall back to open-domain answers.
- Offer one hint or question at a time; count only explicit incorrect answer submissions; reveal a complete solution after three incorrect submissions or an explicit early request.
- Do not persist source image bytes; persist extracted question text and resumable text-only sessions.
- One accepted exercise consumes one feature-specific monthly question allowance; unreadable/unsupported submissions and pre-acceptance failures refund it.
- Bill the add-on with the existing single student subscription; activate access only through verified billing activation paths.
- Do not set or seed the EGP price or monthly question allowance size in this implementation; read them from trusted server configuration and fail closed until configured.
- Record actual image and tutoring provider use under a distinct `homework_helper` feature and keep existing global/per-user AI spend protections active.
- Never commit or run a migration against Production as part of this plan.

## File Map

### Backend

- Create `apps/backend/src/homework/homework.module.ts` to register the feature's controller, service, image handler, quota manager, and topic matcher.
- Create `apps/backend/src/homework/homework.controller.ts` for authenticated status, upload, topic-confirmation, turn, and session-history routes.
- Create `apps/backend/src/homework/homework.service.ts` for entitlement, session ownership/state, strict topic confirmation, answer-attempt state, and provider orchestration.
- Create `apps/backend/src/homework/homework-image.service.ts` for in-memory image validation, multimodal question extraction/topic proposal, spend accounting, and guaranteed buffer cleanup.
- Create `apps/backend/src/homework/homework-topic-matcher.ts` for candidate topic retrieval and backend validation using `assignedGroundingSliceOrNull` and `resolveSubjectAccess`.
- Create `apps/backend/src/homework/homework-quota.service.ts` for monthly allowance status, atomic reserve/consume/refund, and expiry of abandoned topic-confirmation reservations.
- Create focused tests alongside these services and an HTTP-level controller test.
- Modify `apps/backend/src/ai/ai-provider.interface.ts`, `apps/backend/src/ai/providers/openai.provider.ts`, `apps/backend/src/ai/providers/anthropic.provider.ts`, and `apps/backend/src/ai/providers/local-model.provider.ts` to expose explicit vision capability; only the OpenAI adapter is enabled for Homework images and unsupported active providers fail closed.
- Reuse `apps/backend/src/ai/usage/ai-usage.service.ts` `assertWithinBudget`, budget reservation/reconciliation, and `buildUsageRow({ feature: "homework_helper", creditsUsed: 0 })`; retain generic feature-key support and do not change legacy Tutor question counters.
- Modify `apps/backend/src/billing/billing.service.ts`, `apps/backend/src/billing/billing.controller.ts`, `apps/backend/src/billing/billing-http.spec.ts`, and `apps/backend/src/billing/billing.service.spec.ts` to include the add-on in trusted subscription totals and verified activation flows.
- Modify `apps/backend/src/instapay/instapay.controller.ts`, `apps/backend/src/instapay/instapay.service.ts`, `apps/backend/src/instapay/instapay.service.spec.ts`, `apps/backend/src/instapay/instapay-http.spec.ts`, `apps/backend/src/admin/instapay/admin-instapay.service.ts`, `apps/backend/src/admin/instapay/admin-instapay.service.spec.ts`, and `apps/backend/src/admin/instapay/admin-instapay-http.spec.ts` so the existing subscription payment reference and verified admin confirmation carry the add-on change.
- Modify `apps/backend/src/app.module.ts` to register `HomeworkModule`.

### Database

- Modify `packages/database/prisma/schema.prisma` to persist Homework sessions, text messages, monthly allowance counters/reservations, and current/pending add-on subscription state while preserving the one-subscription-per-student rule.
- Create `packages/database/prisma/migrations/20261007090000_add_homework_helper/migration.sql` with additive tables, indexes, constraints, and default-disabled add-on state. Do not rewrite historical subscription rows or grant entitlements during migration.
- Validate the schema with `pnpm --filter @smartify/database exec prisma validate` and regenerate the Prisma client with `pnpm --filter @smartify/database generate`; add no database-seeding or live-database migration step.

### Frontend

- Create `apps/frontend/app/[locale]/homework/page.tsx` for subject selection, upload, topic confirmation, guided session, early solution reveal, allowance status, and resumption.
- Create `apps/frontend/content/homework.ts` for Arabic and English labels, validation errors, unsupported-question copy, billing gates, and session states.
- Modify `apps/frontend/app/[locale]/dashboard/page.tsx` to link to Homework Help and show its active/locked entry state from the server response.
- Modify `apps/frontend/app/[locale]/billing/page.tsx`, `apps/frontend/content/billing.ts`, and the existing subscription response type to show the optional add-on, trusted monthly total, and pending payment/resume state without inventing a price.
- Use `apps/frontend/lib/api-client.ts` FormData support for the upload and keep image data only in browser memory until submission completes.

---

### Task 1: Add Homework session and allowance persistence

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20261007090000_add_homework_helper/migration.sql`
- Create: `apps/backend/src/homework/homework-session.util.ts`
- Test: `apps/backend/src/homework/homework-session.util.spec.ts`

**Interfaces:**
- Session status values: `AWAITING_TOPIC_CONFIRMATION | TUTORING | SOLVED | UNSUPPORTED | LIMIT_REACHED | CLOSED`.
- Credit state values: `RESERVED | CONSUMED | REFUNDED`.
- `countIncorrectAnswerAttempt(input: { explicitAnswer: boolean; evaluation: "CORRECT" | "INCORRECT" | "NOT_AN_ANSWER" }): { incorrectAttemptCount: number; revealSolution: boolean }` increments only explicit incorrect answers and sets `revealSolution` at count 3.
- Persist only extracted question text, model messages, attempt state, confirmed topic references, and billing-period identifiers; add no image column or image relation.

- [ ] **Step 1: Write session-state unit tests.** Cover three explicit wrong answers, correct answers, hints/non-answers, attempts after solution, and status transitions; assert image data is not present in session/message creation shapes.
- [ ] **Step 2: Run the focused test and confirm it fails.** Run `pnpm --filter @smartify/backend exec jest src/homework/homework-session.util.spec.ts --runInBand`; expected: the new module or function is missing.
- [ ] **Step 3: Add Prisma models and migration.** Add `HomeworkSession`, `HomeworkMessage`, and a student-and-billing-period allowance counter/reservation representation; add unique keys needed for atomic exercise reservation and idempotent consume/refund. Add nullable/default-disabled subscription add-on fields and pending-change metadata. Create the additive SQL migration with foreign keys, indexes, and safe defaults.
- [ ] **Step 4: Implement attempt and status utility.** Implement the exact `countIncorrectAnswerAttempt` signature above and reject invalid transitions through explicit typed results rather than implicit truthy state.
- [ ] **Step 5: Run focused checks.** Run the focused Jest test, `pnpm --filter @smartify/database exec prisma validate`, and `pnpm --filter @smartify/database generate`; expected: all pass without connecting to a database.
- [ ] **Step 6: Review migration safety.** Confirm the SQL does not drop/rename existing columns, backfill paid access, or query a configured database; confirm all new entitlements default disabled.

### Task 2: Implement monthly exercise quota and server configuration

**Files:**
- Create: `apps/backend/src/homework/homework-quota.service.ts`
- Create: `apps/backend/src/homework/homework-quota.service.spec.ts`
- Modify: `packages/database/prisma/schema.prisma` and the migration from Task 1 only if Prisma model constraints require the final counter shape.

**Interfaces:**
- `HomeworkQuotaService.getStatus(studentId: string, periodStart: Date, periodEnd: Date): Promise<{ limit: number; used: number; reserved: number; remaining: number; periodEnd: Date }>`.
- `reserveExercise(studentId: string, periodStart: Date, sessionId: string): Promise<{ reserved: boolean; reservationId?: string }>`.
- `consumeReservation(studentId: string, sessionId: string): Promise<boolean>` and `refundReservation(studentId: string, sessionId: string): Promise<boolean>` are idempotent; only one state transition may win.
- The monthly limit and add-on price come from trusted `SystemConfig` keys `homework_addon_monthly_price_egp` and `homework_monthly_exercise_allowance`. Missing, invalid, zero, or negative values disable new purchases/usage and never default to a guessed price or allowance.

- [ ] **Step 1: Write quota tests.** Cover remaining-count shape, no configured allowance, exhausted quota, simultaneous reservations for the last slot, idempotent consume/refund, refund of unreadable/unsupported inputs, and releasing expired topic-confirmation reservations without altering consumed sessions.
- [ ] **Step 2: Run focused tests and confirm failure.** Run `pnpm --filter @smartify/backend exec jest src/homework/homework-quota.service.spec.ts --runInBand`; expected: quota service is missing.
- [ ] **Step 3: Implement atomic quota accounting.** Use a Postgres conditional upsert/update, matching the existing `AIUsageService.reserveDailySlot()` concurrency pattern; use the student's actual subscription period and a unique session reservation key.
- [ ] **Step 4: Implement idempotent lifecycle transitions.** Guard each reservation transition with its current state; repeated confirmation, retry, or cleanup calls must not double-consume or over-refund.
- [ ] **Step 5: Implement reservation expiry cleanup.** Expire only pending topic-confirmation reservations after the configured short TTL; preserve the text-only session for resumption and require a fresh reservation before tutoring if the prior reservation expired.
- [ ] **Step 6: Add validated configuration reads.** Read `homework_addon_monthly_price_egp` and `homework_monthly_exercise_allowance` through `SystemConfig`; reject missing, non-number, zero, negative, NaN, and infinite values. Do not add seed values or client-supplied overrides. Return a locked/unavailable state until administrators configure both.
- [ ] **Step 7: Run focused tests and backend build.** Run the quota Jest test and `pnpm --filter @smartify/backend build`; expected: concurrency and failure-path tests pass and backend compiles.

### Task 3: Add verified add-on billing to the existing subscription

**Files:**
- Modify: `apps/backend/src/billing/billing.service.ts`
- Modify: `apps/backend/src/billing/billing.controller.ts`
- Modify: `apps/backend/src/billing/billing.service.spec.ts`
- Modify: `apps/backend/src/billing/billing-http.spec.ts`
- Modify: `apps/backend/src/instapay/instapay.controller.ts`
- Modify: `apps/backend/src/instapay/instapay.service.ts`
- Modify: relevant files under `apps/backend/src/admin/instapay/`
- Test: existing billing and InstaPay specs plus a focused add-on lifecycle spec if the existing files cannot express the cases clearly.

**Interfaces:**
- Extend authenticated billing requests with `homeworkAddon: boolean`; never accept client price or allowance.
- Extend subscription/status responses with `{ homeworkAddonActive: boolean; homeworkAddonPending: boolean; homeworkAddonMonthlyAmountEGP: number | null }`.
- Extend pending subject-change metadata in a backward-compatible parser so old `{ subjectIds, monthlyTotalEGP, checkoutUrl? }` rows continue to work and the new add-on choice is included in the server-computed total.
- Preserve exactly one `Subscription` row per student. On webhook/manual payment activation, apply both subject and add-on state atomically and idempotently.

- [ ] **Step 1: Add failing billing tests.** Cover server-computed subject-plus-add-on total, no client price trust, add-on activation only after verified webhook/admin InstaPay confirmation, duplicate event idempotency, active-subscription upgrade, pending-payment resume, unsupported provider fail-closed behavior, cancellation/past-due disabling, and preserving legacy rows.
- [ ] **Step 2: Run focused billing tests and confirm failure.** Run `pnpm --filter @smartify/backend exec jest src/billing/billing.service.spec.ts --runInBand`; expected: current request/response shape lacks the add-on.
- [ ] **Step 3: Implement server-side checkout calculation.** Extend the subject checkout and active-subscription upgrade paths to include an optional add-on using only validated server config, record a pending requested state before redirect, and include the correct new total in existing provider params.
- [ ] **Step 4: Implement verified activation and status.** Extend the existing webhook transaction and manual InstaPay confirmation path to activate the add-on only after trusted payment confirmation; keep `subscription.activated` idempotent and preserve the historical `selectedSubjectIds` behavior.
- [ ] **Step 5: Fail closed on unsupported upgrade paths.** Keep the add-on unavailable for an existing provider that cannot change recurring billing; do not set active state from a client success redirect or a receipt submission.
- [ ] **Step 6: Run focused payment tests.** Run `pnpm --filter @smartify/backend exec jest src/billing/billing.service.spec.ts src/billing/billing-http.spec.ts src/instapay --runInBand`; expected: legacy and new billing cases pass.

### Task 4: Implement image intake and grounded topic proposal

**Files:**
- Modify: `apps/backend/src/ai/ai-provider.interface.ts`
- Modify: `apps/backend/src/ai/providers/openai.provider.ts`
- Modify: `apps/backend/src/ai/providers/anthropic.provider.ts` and `apps/backend/src/ai/providers/local-model.provider.ts` to declare `supportsVision = false`; declare `supportsVision = true` only on the OpenAI adapter used for this upload path.
- Create: `apps/backend/src/homework/homework-image.service.ts`
- Create: `apps/backend/src/homework/homework-image.service.spec.ts`
- Create: `apps/backend/src/homework/homework-topic-matcher.ts`
- Create: `apps/backend/src/homework/homework-topic-matcher.spec.ts`
- Reuse: `apps/backend/src/ai/context/topic-grounding-assignment.util.ts`, `apps/backend/src/common/subject-access.ts`, and `apps/backend/src/ai/usage/ai-usage.service.ts`.

**Interfaces:**
- Add explicit `supportsVision: boolean` capability to provider adapters; do not infer image support from model names or send images to an unsupported provider.
- `HomeworkImageService.proposeQuestion(input: { studentId: string; subjectId: string; image: { buffer: Buffer; mimetype: string; size: number } }): Promise<{ extractedQuestion: string; candidates: Array<{ topicId: string; topicNameAr: string; topicNameEn: string; confidence: number }>; usage: { providerKey: string; model: string; inputTokens: number; outputTokens: number } }>`.
- `HomeworkTopicMatcher.getEligibleCandidates(studentId: string, subjectId: string)` returns only active topics in the resolved curriculum-grade subject with valid current topic-level grounding; `assertEligibleTopic(studentId, subjectId, topicId)` rechecks all constraints at confirmation time.
- Topic proposal output uses JSON object mode with candidate IDs chosen from a server-provided allowlist; backend rejects unknown IDs and never trusts model-provided curriculum identifiers.

- [ ] **Step 1: Write provider capability tests.** Verify OpenAI image content is passed through the supported multimodal message type, while providers without verified image capability reject the request before network use.
- [ ] **Step 2: Write image-validation tests.** Cover supported MIME allowlist, maximum bytes, decoded pixel bounds, empty/corrupt input, no logging of image bytes, and buffer cleanup on provider success and failure.
- [ ] **Step 3: Write topic-matcher tests.** Cover same-subject/current-grade/current-curriculum restriction, shared content subject resolution, stale/blocked/missing grounding exclusion, unsupported questions, ambiguous candidates, and backend rejection of an invented topic ID.
- [ ] **Step 4: Run focused provider/image/matcher tests and confirm failure.** Run `pnpm --filter @smartify/backend exec jest src/homework/homework-image.service.spec.ts src/homework/homework-topic-matcher.spec.ts src/ai/providers/openai.provider.spec.ts --runInBand`; expected: new services and capability are absent.
- [ ] **Step 5: Implement vision capability and bounded upload.** Extend the provider interface, declare capabilities explicitly, and configure `FileInterceptor("photo")` with in-memory storage and hard file limits. Reject unsupported MIME, invalid file signatures, oversized dimensions, and missing buffers before any provider call.
- [ ] **Step 6: Implement grounded candidates and structured proposal.** Resolve subject access from the student profile, load eligible grounded topics only, send the image and bounded candidate descriptions to a vision-capable provider, parse strict JSON, and verify returned IDs against the allowlist.
- [ ] **Step 7: Record image-analysis cost.** Persist actual token usage using AIUsage feature `homework_helper`, no legacy Tutor question credit, and the existing budget reservation/reconciliation path. Do not put image content, extracted image bytes, or student-private image URLs in diagnostics.
- [ ] **Step 8: Guarantee transient image cleanup.** Release the in-memory buffer/reference in a `finally` path and never copy the raw image into a Prisma model, object store, application log, or analytics event.
- [ ] **Step 9: Run focused tests and backend build.** Run the focused Jest command from Step 4 and `pnpm --filter @smartify/backend build`; expected: provider capability, validation, matching, cleanup, and usage tests pass.

### Task 5: Implement authenticated Homework API and tutoring state machine

**Files:**
- Create: `apps/backend/src/homework/homework.controller.ts`
- Create: `apps/backend/src/homework/homework.service.ts`
- Create: `apps/backend/src/homework/homework.module.ts`
- Create: `apps/backend/src/homework/homework.service.spec.ts`
- Create: `apps/backend/src/homework/homework-http.spec.ts`
- Modify: `apps/backend/src/ai/context/ai-context-builder.service.ts` and its spec to add a Homework-only grounded prompt, leaving existing Tutor prompt output unchanged.
- Reuse: `apps/backend/src/ai/usage/ai-usage.service.ts` public budget and usage-row methods to reserve/reconcile each Homework call; do not add a second spend ledger.
- Modify: `apps/backend/src/app.module.ts`.

**Interfaces:**
- `GET /homework/status` -> `{ addonActive: boolean; remaining: number; monthlyLimit: number; periodEnd: string | null; eligibleSubjects: Array<{ id: string; nameAr: string; nameEn: string }> }`.
- `POST /homework/sessions` multipart field `photo`, text field `subjectId` -> `{ sessionId: string; extractedQuestion: string; candidates: TopicCandidate[]; status: "AWAITING_TOPIC_CONFIRMATION"; remaining: number }`.
- `POST /homework/sessions/:id/topic` JSON `{ topicId: string }` -> confirmed session with `status: "TUTORING"`; consumes the exercise allowance exactly once.
- `POST /homework/sessions/:id/turn` JSON `{ message: string; kind: "ANSWER" | "HELP" | "REVEAL_SOLUTION" }` -> `{ sessionId: string; reply: string; status: HomeworkSessionStatus; incorrectAttemptCount: number; solutionRevealed: boolean }`.
- `GET /homework/sessions` lists only caller-owned text-only sessions; `GET /homework/sessions/:id` returns one caller-owned session/messages.

- [ ] **Step 1: Write service and HTTP tests.** Cover Clerk guard, subject/add-on authorization, ownership, unconfirmed-topic rejection, stale grounding rejection, quota required before provider use, upload rejection/refund, accepted topic consumes once, duplicate confirmation idempotency, persisted text-only history, resumption, and no image payload in API responses.
- [ ] **Step 2: Add answer evaluation tests.** Cover `ANSWER` turns evaluated as correct/incorrect, `HELP` turns never incrementing attempts, malformed evaluation JSON not incrementing attempts, reveal on the third incorrect answer, explicit early reveal, and calls blocked after the session is solved/closed/at the configured cap.
- [ ] **Step 3: Run focused tests and confirm failure.** Run `pnpm --filter @smartify/backend exec jest src/homework/homework.service.spec.ts src/homework/homework-http.spec.ts --runInBand`; expected: controller/service are missing.
- [ ] **Step 4: Implement strict route and session checks.** Use `ClerkAuthGuard` and `CurrentUser`; resolve the current `StudentProfile`; validate subject entitlement, add-on status, session ownership, topic membership, and grounding freshness in backend service methods for every operation.
- [ ] **Step 5: Implement upload-to-confirmation flow.** Reserve the feature allowance and AI spend before model calls; create text-only pending session; refund on unreadable/unsupported/provider failure; expire abandoned topic reservations idempotently; confirm a valid candidate before enabling turns and consuming the credit.
- [ ] **Step 6: Implement grounded Homework prompt and turn state machine.** Provide only the confirmed topic's current grounding slice and extracted question. Require structured evaluation `{ "kind": "CORRECT" | "INCORRECT" | "NOT_AN_ANSWER", "reply": "..." }` for answer turns; backend counts only an explicit `ANSWER` whose parsed result is `INCORRECT`. Provide worked solution after the third incorrect attempt or explicit reveal request.
- [ ] **Step 7: Persist each successful turn atomically.** Write user message, assistant reply, correctness classification, incorrect count, and session status in one transaction; log actual AI usage with feature `homework_helper` and maintain the existing budget reservation lifecycle.
- [ ] **Step 8: Implement status/history/resume endpoints.** Return only text-based session data owned by the student; require active add-on and current entitlement before any new provider turn, while allowing read-only history based on established session ownership rules.
- [ ] **Step 9: Register `HomeworkModule` and run focused verification.** Run the service/HTTP tests, relevant AIContextBuilder tests, `pnpm --filter @smartify/backend build`, and `pnpm --filter @smartify/database exec prisma validate`; expected: no route starts provider work before authorization/grounding and all types compile.

### Task 6: Build Arabic and English student experience

**Files:**
- Create: `apps/frontend/app/[locale]/homework/page.tsx`
- Create: `apps/frontend/content/homework.ts`
- Modify: `apps/frontend/app/[locale]/dashboard/page.tsx`
- Modify: `apps/frontend/app/[locale]/billing/page.tsx`
- Modify: `apps/frontend/content/billing.ts`
- Create: `apps/frontend/playwright.config.ts`
- Create: `apps/frontend/tests/homework-flow.spec.ts`
- Modify: `apps/frontend/package.json` to add the `test:e2e` Playwright script.

**Interfaces:**
- Use `useApiClient().apiFetch` for JSON and `apiFetch` with `FormData` for `POST /homework/sessions`; never set multipart `Content-Type` manually.
- Keep upload preview in a revocable browser object URL; clear the file input, blob URL, and component-held `File` after submission completes or the user leaves the page.
- Page states: loading, add-on locked, no entitled subjects, selecting subject, selecting photo, uploading, topic confirmation, manual topic choice, tutoring, exhausted allowance, unreadable/unsupported, provider unavailable, and resumable session list.

- [ ] **Step 1: Define bilingual UI copy.** Add Arabic and English labels/messages for photo capture, supported file error, privacy statement, subject/topic confirmation, hint/answer/reveal actions, allowance, resume, and all backend failure states.
- [ ] **Step 2: Add dashboard entry.** Link to `/${locale}/homework`; render lock/upgrade guidance from `/homework/status` when the add-on is inactive, and never infer active access only from client subscription fields.
- [ ] **Step 3: Build subject/photo/topic flow.** Fetch server status, show only eligible subjects, accept one image, post `FormData`, render the extracted question and candidate topic, request confirmation, and offer manual topic selection when the backend marks matching as ambiguous.
- [ ] **Step 4: Build guided session and history.** Render persisted messages safely via existing `renderTutorMessage`, send `HELP`, `ANSWER`, or `REVEAL_SOLUTION` intent explicitly, show attempt count and remaining allowance, and load/resume sessions from API.
- [ ] **Step 5: Add billing toggle and payment resume.** Extend the current billing screen for students with an active subject subscription, include the server-computed add-on amount in the displayed monthly total, preserve subject selection, and link to verified `/billing/checkout` or `/instapay/subscription/initiate` pending-payment flow. If price or allowance config is unavailable, display the configured-unavailable state and do not offer purchase.
- [ ] **Step 6: Add bilingual Playwright flow coverage.** Mock `/homework/status`, `/homework/sessions`, topic confirmation, and tutoring turns. Assert Arabic and English upload labels, one-question-only submission, topic confirmation, three incorrect attempts, early solution reveal, locked billing gate, and resume behavior.
- [ ] **Step 7: Check keyboard/accessibility and RTL.** Ensure photo input and topic/answer controls have Arabic/English accessible names, visible focus, RTL-aware alignment, and mobile-safe layout.
- [ ] **Step 8: Run frontend checks.** Run `pnpm --filter @smartify/frontend exec tsc --noEmit`, `pnpm --filter @smartify/frontend lint`, and `pnpm --filter @smartify/frontend exec playwright test tests/homework-flow.spec.ts --config=playwright.config.ts`; expected: typecheck, lint, and bilingual mocked flows pass.

### Task 7: End-to-end contract verification and release readiness

**Files:**
- Modify: `apps/backend/src/homework/homework-http.spec.ts`
- Modify: `apps/backend/src/billing/billing-http.spec.ts`
- Modify: `apps/frontend/tests/homework-flow.spec.ts`
- Modify: `docs/superpowers/specs/2026-10-07-curriculum-grounded-homework-helper-design.md` only if implementation reveals an approved design change; request user review before changing approved behavior.

- [ ] **Step 1: Add HTTP contract coverage with mocked provider/database.** Exercise upload → candidate proposal → topic confirmation → two incorrect submissions → third incorrect submission → full solution → session retrieval. Assert no raw image is in database calls and actual AI usage is recorded.
- [ ] **Step 2: Add failure-path HTTP coverage.** Exercise stale grounding, unsupported subject, inactive add-on, exhausted quota, ambiguous topic, unrecognized photo, failed provider call, forged topic ID, expired reservation, and cross-student session ID. Assert no forbidden provider call or unauthorized data is returned.
- [ ] **Step 3: Run targeted tests.** Run `pnpm --filter @smartify/backend exec jest src/homework src/billing/billing.service.spec.ts src/billing/billing-http.spec.ts --runInBand`; expected: all Homework and changed billing tests pass.
- [ ] **Step 4: Run package checks.** Run `pnpm --filter @smartify/database exec prisma validate`, `pnpm --filter @smartify/backend build`, `pnpm --filter @smartify/frontend exec tsc --noEmit`, and `pnpm --filter @smartify/frontend lint`; expected: all pass.
- [ ] **Step 5: Review generated migration without applying it.** Verify only additive DDL, default-disabled entitlement, no Production connection, and no generated backfill that grants the add-on.
- [ ] **Step 6: Check final diff and report release gates.** Confirm new image/session storage paths do not persist raw photos; report unset price/allowance configuration as explicit blockers to purchase activation; do not commit, push, or deploy unless separately requested.

## Plan Self-Review

- **Spec coverage:** Photo validation/deletion, subject entitlement, grounded-topic proposals and confirmation, hints/answer attempts/solution reveal, resume/history, monthly allowance, actual-cost accounting, verified billing, failure behavior, bilingual UI, and release gates all map to Tasks 1–7.
- **Placeholder scan:** No implementation step uses TODO/TBD or leaves an unspecified safety/authorization behavior. Price and allowance size are intentionally deferred by the approved spec and are read from trusted configuration; missing values fail closed.
- **Type consistency:** Session states, attempt evaluator result, API route payloads, quota interfaces, and vision proposal types are defined before their consumers.
- **Scope:** This remains one connected Homework feature subsystem. Whole worksheets, voice, open-web fallback, and production migration/deployment are outside this plan.

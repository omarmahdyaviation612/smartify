# AI Question Packs and Tutor Answer Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add subject-scoped 10-question packs for 50 EGP, cache reusable tutor answers, and enforce friendly Egyptian Arabic and curriculum boundaries.

**Architecture:** Extend Prisma with a daily extra-credit ledger, purchase records, and scoped tutor-answer cache. Keep payment provider behavior behind the existing abstraction, grant credits only from verified idempotent webhook events, and make TutorService check cache before reserving a question or calling AI. Update the tutor UI through the existing API client and preserve current Fawry-unavailable behavior.

**Tech Stack:** NestJS, Prisma 5/PostgreSQL, Next.js 14 App Router, React, Jest, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-01-ai-question-packs-cache-design.md`

## Global Constraints

- The feature applies to tutor chat only, not generated quizzes or practice assessments.
- The existing allowance remains ten questions per subject per day.
- The extra pack is exactly ten questions for exactly one subject and expires at the end of the current day.
- Cached answers contain no student name, account identifiers, or prior conversation messages.
- Credits are granted only after a verified payment webhook; duplicate webhook delivery is a no-op.
- Arabic tutor responses use gentle Egyptian colloquial Arabic and remain within the selected curriculum, grade, subject, and topic.
- Use the existing payment-provider abstraction; do not add a Fawry SDK or invent provider credentials.
- Apply schema changes with `prisma db push`; this repository has no migration baseline.

---

### Task 1: Add question-pack and answer-cache schema

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Test: `packages/database/prisma/schema.prisma` via Prisma validation

**Interfaces:**
- Produces Prisma models for `TutorQuestionPackPurchase`, `TutorExtraQuestionCredit`, and `TutorAnswerCache`.
- `TutorExtraQuestionCredit` is unique by `studentId`, `subjectId`, and `usageDate`; `TutorAnswerCache` is unique by curriculum, grade, subject, topic, language, and normalized prompt.

- [ ] **Step 1: Add the purchase model**

Define student/subject relations, fixed quantity and amount snapshots, statuses (`pending`, `paid`, `failed`, `canceled`), provider/session/event identifiers, and timestamps. Add indexes for student/status and external payment identifiers.

- [ ] **Step 2: Add the daily extra-credit model**

Define an integer `remaining` counter and a unique student/subject/day key. Add a relation to the purchase that granted the credits and indexes for expiry lookup.

- [ ] **Step 3: Add the tutor answer cache model**

Store curriculumId, gradeId, subjectId, nullable topicId, language, normalizedPrompt, answer, provider/model metadata, and created/updated timestamps. Add the composite uniqueness constraint required by the spec.

- [ ] **Step 4: Run Prisma validation**

Run `pnpm --filter @smartify/database exec prisma validate`.
Expected: schema is valid.

- [ ] **Step 5: Apply schema and regenerate**

Run `pnpm --filter @smartify/database exec prisma db push --accept-data-loss`.
If Windows reports a Prisma engine file lock, stop the running backend process and rerun the same command before continuing.

### Task 2: Implement atomic question allowance and purchase service

**Files:**
- Create: `apps/backend/src/tutor-question-packs/tutor-question-packs.service.ts`
- Create: `apps/backend/src/tutor-question-packs/tutor-question-packs.controller.ts`
- Create: `apps/backend/src/tutor-question-packs/tutor-question-packs.module.ts`
- Modify: `apps/backend/src/app.module.ts`
- Test: `apps/backend/src/tutor-question-packs/tutor-question-packs.service.spec.ts`

**Interfaces:**
- `getRemaining(userId: string, subjectId: string): Promise<{ dailyRemaining: number; extraRemaining: number; totalRemaining: number; packPriceEGP: number; packSize: number }>`
- `consumeForTutor(studentId: string, subjectId: string): Promise<{ source: "daily" | "extra"; limit: number }>`
- `startPurchase(userId: string, subjectId: string): Promise<{ checkoutUrl: string }>`
- `applyPaidPurchase(providerKey: string, event: { purchaseId: string; externalEventId: string }): Promise<void>`

- [ ] **Step 1: Write failing service tests**

Cover daily slots first, extra credits after the daily limit, rejection when both are empty, concurrent-safe decrement behavior through raw SQL, fixed quantity/price validation, and rejection of subjects not selected by the student.

- [ ] **Step 2: Run the focused tests**

Run `pnpm --filter @smartify/backend exec jest src/tutor-question-packs/tutor-question-packs.service.spec.ts --runInBand`.
Expected: FAIL because the service and models do not exist.

- [ ] **Step 3: Implement allowance reads and atomic consumption**

Reuse `AIUsageService` for the configured daily limit. Read the daily counter plus the current-day extra ledger. Reserve the daily counter while capacity exists; otherwise decrement extra credits with one conditional SQL update. Return a typed source result and never decrement extra credits before confirming that the daily limit is exhausted.

- [ ] **Step 4: Implement purchase creation**

Validate the student profile and selected subject, create a pending 10-question/50-EGP purchase, call `PaymentProviderFactory`, and persist provider/session identifiers. Return the provider checkout URL or the existing clear unavailable error when Fawry is not configured.

- [ ] **Step 5: Implement idempotent paid-purchase application**

Use a unique provider/event key and a transaction that marks the purchase paid once and upserts ten credits for the student, subject, and current date. Ignore duplicate events and reject mismatched amounts/statuses.

- [ ] **Step 6: Add authenticated endpoints**

Expose `GET /tutor/question-pack/remaining?subjectId=...` and `POST /tutor/question-pack/purchase` with `subjectId`. Register the module in `AppModule`.

- [ ] **Step 7: Run focused tests**

Run the same Jest command and expect all allowance and purchase tests to pass.

### Task 3: Wire payment webhook events to question packs

**Files:**
- Modify: `apps/backend/src/billing/billing.service.ts`
- Modify: `apps/backend/src/billing/billing-webhook.controller.ts`
- Modify: `apps/backend/src/billing/billing.module.ts`
- Test: `apps/backend/src/billing/billing.service.spec.ts`

**Interfaces:**
- Existing subscription webhook handling remains unchanged.
- Question-pack payment events dispatch to `TutorQuestionPacksService.applyPaidPurchase`.

- [ ] **Step 1: Write failing webhook tests**

Cover a verified `question_pack.paid` event, duplicate event delivery, unknown purchase IDs, and subscription events continuing to use the existing path.

- [ ] **Step 2: Run the focused billing tests**

Run `pnpm --filter @smartify/backend exec jest src/billing/billing.service.spec.ts --runInBand`.
Expected: FAIL for the new event cases.

- [ ] **Step 3: Dispatch question-pack events**

After provider signature verification, recognize the question-pack event payload, validate its purchase ID and external event ID, and delegate to the question-pack service. Do not grant credits in the controller.

- [ ] **Step 4: Run billing tests**

Expect all existing and new billing tests to pass.

### Task 4: Add tutor answer cache and integrate it before AI usage

**Files:**
- Modify: `apps/backend/src/tutor/tutor.service.ts`
- Create: `apps/backend/src/tutor/tutor-answer-cache.service.ts`
- Modify: `apps/backend/src/tutor/tutor.module.ts`
- Test: `apps/backend/src/tutor/tutor.service.spec.ts`
- Test: `apps/backend/src/tutor/tutor-answer-cache.service.spec.ts`

**Interfaces:**
- `normalizePrompt(prompt: string): string`
- `find(params: { curriculumId: string; gradeId: string; subjectId: string; topicId?: string; language: string; prompt: string }): Promise<{ answer: string } | null>`
- `save(params: { ...same scope; prompt: string; answer: string; provider: string; model: string }): Promise<void>`

- [ ] **Step 1: Write failing cache tests**

Verify normalization, exact cache hits, misses when subject/curriculum/grade/topic/language changes, and no student identifiers in stored data.

- [ ] **Step 2: Run cache tests**

Run `pnpm --filter @smartify/backend exec jest src/tutor/tutor-answer-cache.service.spec.ts --runInBand`.
Expected: FAIL because the cache service does not exist.

- [ ] **Step 3: Implement cache service**

Normalize whitespace and case without attempting unsafe semantic matching. Query by all curriculum scope fields and normalized prompt. Upsert successful answers on the composite key.

- [ ] **Step 4: Add cache lookup to TutorService**

Keep profile, selected-subject, message, and active-subscription validation first. Lookup the cache before daily reservation. On a hit, persist the user’s private conversation messages while skipping AI usage reservation, extra-credit consumption, provider invocation, and usage ledger writes.

- [ ] **Step 5: Use the question-pack allowance on cache misses**

Replace the current “extra packages coming soon” rejection with `TutorQuestionPacksService.consumeForTutor`. Release only a daily reservation if the provider or persistence path fails; never refund a successfully consumed paid credit unless the same transaction proves the credit was not used.

- [ ] **Step 6: Save successful responses**

After the existing atomic private-message/usage transaction succeeds, save the cache entry with curriculum, grade, subject, optional topic, language, answer, provider, and model. A cache write failure must be surfaced/logged explicitly without corrupting the private conversation transaction.

- [ ] **Step 7: Run tutor tests**

Run `pnpm --filter @smartify/backend exec jest src/tutor/tutor.service.spec.ts src/tutor/tutor-answer-cache.service.spec.ts --runInBand`.
Expected: all existing tutor tests plus cache behavior pass.

### Task 5: Strengthen tutor prompt and expose the frontend purchase flow

**Files:**
- Modify: `apps/backend/src/ai/context/ai-context-builder.service.ts`
- Modify: `apps/frontend/app/[locale]/tutor/page.tsx`
- Modify: `apps/frontend/content/*` only if existing tutor copy is centralized there
- Test: `apps/backend/src/ai/context/ai-context-builder.service.spec.ts` or the existing prompt test location

**Interfaces:**
- Remaining endpoint response fields: `dailyRemaining`, `extraRemaining`, `totalRemaining`, `packPriceEGP`, `packSize`.
- Purchase action posts `{ subjectId }` to `/tutor/question-pack/purchase`.

- [ ] **Step 1: Add failing prompt assertions**

Assert Arabic prompts require Egyptian colloquial Arabic, a gentle teacher tone, simple explanations, and explicit redirection for questions outside the selected curriculum/subject/topic. Assert English behavior remains available when the student writes in English.

- [ ] **Step 2: Update the context builder**

Add the exact behavior requirements to the single shared tutor system prompt; do not duplicate prompt text in TutorService.

- [ ] **Step 3: Update tutor remaining state**

Load the extended remaining response for the currently selected subject, display daily/extra/total counts, and refresh it after each successful message.

- [ ] **Step 4: Add exhausted-state purchase action**

When total remaining is zero, render “شراء 10 أسئلة إضافية — 50 جنيه” in Arabic (and the English equivalent). Disable duplicate submissions, show the provider-unavailable message when Fawry is inactive, and redirect to a returned checkout URL when available.

- [ ] **Step 5: Run prompt and frontend validation**

Run the focused backend prompt tests, then `pnpm --filter @smartify/frontend lint`.
Expected: no lint errors or warnings.

### Task 6: Full validation and database verification

**Files:**
- Modify: `packages/database/prisma/seed.ts` only if the fixed pack configuration belongs in seed data
- Test: existing backend/frontend test suites

- [ ] **Step 1: Verify schema and generated client**

Run `pnpm --filter @smartify/database exec prisma validate` and query the database to confirm the three new tables exist.

- [ ] **Step 2: Run backend tests and build**

Run `pnpm --filter @smartify/backend exec jest --runInBand` and `pnpm --filter @smartify/backend build`.
Expected: all tests pass and the build succeeds.

- [ ] **Step 3: Run frontend lint and build**

Run `pnpm --filter @smartify/frontend lint` and `pnpm --filter @smartify/frontend build`.
Expected: no lint errors/warnings and the production build succeeds.

- [ ] **Step 4: Exercise the API manually**

With the local backend and database running, verify remaining-question output, exhausted response, unavailable Fawry purchase response, cache hit behavior without a provider call, and subject-scoped isolation.

- [ ] **Step 5: Mark the tracked feature complete**

Update the session todo `ai-question-packs-cache` to `done` only after schema, tests, builds, and the manual API checks pass.

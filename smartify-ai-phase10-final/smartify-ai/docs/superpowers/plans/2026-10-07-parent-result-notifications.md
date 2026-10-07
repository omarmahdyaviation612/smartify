# Parent Result Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Send linked parents a short email and WhatsApp result summary when a student completes a quiz, exam, or Practice answer batch.

**Architecture:** Reuse `EmailService`; add a mocked WhatsApp provider and a notification coordinator that accepts an allowlisted summary. Persist a deduplication/delivery row per result event, and require a verified parent WhatsApp destination before delivery. Result persistence and student responses remain independent from provider availability.

**Tech Stack:** NestJS 10, Prisma, PostgreSQL, Resend, HTTP fetch to the configured WhatsApp Business provider, Jest.

**Spec:** `docs/superpowers/specs/2026-10-07-parent-features-launch-design.md` (Assessment and practice notifications; Failure and privacy behavior)

## Global Constraints

- Only linked parents are recipients.
- Message fields are limited to child name, score, subject, and completion date/time; never include questions, answers, explanations, conversations, or costs.
- Send one Practice summary per submitted answer batch, not one message per answer.
- Provider failures never fail the student’s quiz or Practice result.
- Do not log phone numbers, score payloads, or answer content; do not deploy or use Production credentials.

---

### Task 1: Add the notification and verified-contact persistence model

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20261007100000_parent_result_notifications/migration.sql`
- Modify: `apps/backend/src/parent/parent.service.spec.ts`

**Interfaces:**
- `ParentProfile` gains nullable `whatsAppPhone` and `whatsAppVerifiedAt` fields.
- `PracticeSubmission` stores `studentId`, a client-generated idempotency key, `correctCount`, `total`, distinct server-derived `subjectIds`, and `createdAt`; unique `(studentId, idempotencyKey)` prevents re-submission from creating duplicate batches.
- `ParentResultNotification` stores `parentId`, `eventKey`, nullable `quizResultId`/`practiceSubmissionId`, `emailStatus`, `whatsAppStatus`, sanitized failure text, and timestamps; unique `(parentId, eventKey)` prevents duplicate dispatch. It stores no answers or message body.
- `ParentWhatsAppVerification` stores `parentId`, `phoneE164`, `codeHash`, `expiresAt`, `attempts`, and timestamps; never store the one-time code in plaintext.

- [ ] Add focused service mock fixtures for unverified/verified contacts, idempotency keys, and channel states.
- [ ] Add the additive SQL migration and Prisma relations/indexes for `ParentProfile`, `PracticeSubmission`, `ParentResultNotification`, and `ParentWhatsAppVerification`.

```prisma
model PracticeSubmission {
  id             String   @id @default(cuid())
  studentId      String
  idempotencyKey String
  correctCount   Int
  total          Int
  subjectIds     Json
  createdAt      DateTime @default(now())
  student        StudentProfile @relation(fields: [studentId], references: [id], onDelete: Cascade)
  notifications  ParentResultNotification[]
  @@unique([studentId, idempotencyKey])
}

model ParentResultNotification {
  id                   String   @id @default(cuid())
  parentId             String
  eventKey             String
  quizResultId         String?
  practiceSubmissionId String?
  emailStatus          String   @default("PENDING")
  whatsAppStatus       String   @default("PENDING")
  safeFailureCode      String?
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  parent               ParentProfile @relation(fields: [parentId], references: [id], onDelete: Cascade)
  quizResult           QuizResult? @relation(fields: [quizResultId], references: [id], onDelete: Cascade)
  practiceSubmission   PracticeSubmission? @relation(fields: [practiceSubmissionId], references: [id], onDelete: Cascade)
  @@index([parentId, createdAt])
  @@unique([parentId, eventKey])
}

model ParentWhatsAppVerification {
  id         String   @id @default(cuid())
  parentId   String
  phoneE164  String
  codeHash   String
  expiresAt  DateTime
  attempts   Int      @default(0)
  createdAt  DateTime @default(now())
  parent     ParentProfile @relation(fields: [parentId], references: [id], onDelete: Cascade)
  @@index([parentId, expiresAt])
}
```

- [ ] Add back-relations on `ParentProfile`, `QuizResult`, and `StudentProfile`; use the repository's actual quiz-result model name and relation key discovered before editing. Add `PracticeSubmission.notifications`, the parent verification relation, lookup indexes, and a SQL check requiring exactly one of `quizResultId` or `practiceSubmissionId`.
- [ ] Add `PracticeSubmission` with a unique `(studentId, idempotencyKey)` constraint and one parent relation back-reference as needed. On duplicate key, return the persisted batch summary and do not write attempts or send another notification.
- [ ] Run `pnpm --filter @smartify/database exec prisma validate` and `pnpm db:generate` against the configured local environment only.
- [ ] Commit the schema delivery as `feat: persist parent result delivery status`.

### Task 2: Add WhatsApp provider configuration and parent verification flow

**Files:**
- Create: `apps/backend/src/notifications/whatsapp.provider.ts`
- Create: `apps/backend/src/notifications/whatsapp.provider.spec.ts`
- Modify: `packages/config/src/index.ts`
- Modify: `apps/backend/src/parent/parent.controller.ts`
- Modify: `apps/backend/src/parent/parent.service.ts`
- Modify: `apps/backend/src/parent/parent.module.ts`
- Modify: `apps/frontend/app/[locale]/parent/page.tsx`

**Interfaces:**
- `WhatsAppProvider.sendTemplate(to: string, template: string, parameters: string[]): Promise<{ sent: boolean }>`.
- Parent endpoints start verification and confirm a short-lived one-time code; a verified number is stored only after successful confirmation.

- [ ] Add provider tests for missing credentials, accepted delivery, provider rejection, and timeout; assert logs omit destination and message fields.
- [ ] Implement the provider against the approved WhatsApp Business sender configuration with explicit timeout and sanitized errors; keep missing config disabled.
- [ ] Add a parent-only phone capture and verification flow with expiry, attempt limit, resend rate limit, and server-side ownership checks. Send verification through a configured approved WhatsApp template, persist only a salted code hash, and compare hashes safely.

```ts
// POST /parent/whatsapp/verification
{ "phoneE164": "+201000000000" }

// POST /parent/whatsapp/verification/confirm
{ "verificationId": "verification-id", "code": "123456" }
```

- [ ] Add localized settings UI explaining that result summaries use the verified number; do not request browser SMS/call permissions.
- [ ] Run focused provider/parent tests and backend/frontend builds.
- [ ] Commit the verified-contact delivery as `feat: verify parent WhatsApp contact`.

### Task 3: Coordinate safe result notifications

**Files:**
- Create: `apps/backend/src/notifications/result-notification.service.ts`
- Create: `apps/backend/src/notifications/result-notification.service.spec.ts`
- Modify: `apps/backend/src/notifications/notifications.module.ts`
- Modify: `apps/backend/src/quizzes/quizzes.module.ts`
- Modify: `apps/backend/src/quizzes/quizzes.service.ts`
- Modify: `apps/backend/src/practice/practice.module.ts`
- Modify: `apps/backend/src/practice/practice.service.ts`
- Modify: `apps/backend/src/email/email.service.ts`
- Create: `apps/backend/src/email/email.service.spec.ts`
- Modify: `apps/frontend/app/[locale]/practice/page.tsx`
- Modify: `apps/backend/src/app.module.ts`

**Interfaces:**
- `notifyResult(input: { eventKey: string; studentId: string; studentName: string; subjectNames: { en: string[]; ar: string[] }; score: number; completedAt: Date }): Promise<void>`.
- The service resolves parent recipients through `ParentStudentRelation`, writes one deduplicated delivery record per parent/result, and dispatches both configured channels best-effort.

- [ ] Add tests asserting the exact message field allowlist, linked-parent-only recipients, duplicate event suppression, unverified-phone skip, and provider failure isolation.

```ts
expect(delivery).toEqual(expect.objectContaining({
  studentName: "Student Name",
  score: 80,
  subject: "Science",
  completedAt: expect.any(Date),
}));
expect(JSON.stringify(delivery)).not.toMatch(/question|answer|explanation|conversation/i);
```

- [ ] Integrate all completed quiz types, including the existing lesson check, deriving subject identity from server-loaded result content.
- [ ] Add a frontend-generated batch UUID to the Practice submit body and preserve it across a retry of that same submit action; clear it only after a definitive success or a new answer batch begins.
- [ ] Persist `PracticeSubmission` transactionally with the idempotency key and aggregate result only; use its ID as the notification event key. Duplicate-key retry returns the existing summary and skips both duplicate attempt writes and notification dispatch.
- [ ] Integrate `PracticeService.submitPractice` once after the batch result is persisted; represent all distinct server-derived subjects in the subject field when one batch spans more than one subject.
- [ ] Sanitize existing email-provider error logging so it never includes recipient addresses, payloads, score data, or answer content; add a test asserting those values are absent from logs.
- [ ] Run `pnpm --filter @smartify/backend exec jest src/notifications src/quizzes/quizzes.service.spec.ts src/practice/practice.service.spec.ts --runInBand` and `pnpm --filter @smartify/backend build`.
- [ ] Commit the notifications delivery as `feat: notify parents of assessment results`.

### Task 4: Surface failed notification deliveries for safe retry

**Files:**
- Create: `apps/backend/src/admin/notifications/admin-notifications.controller.ts`
- Create: `apps/backend/src/admin/notifications/admin-notifications.service.ts`
- Create: `apps/backend/src/admin/notifications/admin-notifications.service.spec.ts`
- Create: `apps/frontend/app/[locale]/admin/notifications/page.tsx`
- Modify: `apps/frontend/app/[locale]/admin/page.tsx`

**Interfaces:**
- Import the notifications module in `AppModule`; the admin endpoints list failed channel statuses and retry delivery by notification ID, guarded with the existing admin role guard. They never return phone numbers, answer data, or stored message text.

- [ ] Add admin-role tests for failed-delivery listing, retry authorization, and duplicate retry idempotency.
- [ ] Add an admin list and retry control that reveals only child name, result date, channel, and sanitized error status.
- [ ] Run focused notification/admin tests and frontend/backend builds.
- [ ] Commit the retry queue as `feat: add parent notification retry queue`.

**External release requirement:** Production WhatsApp delivery stays disabled until the business sender, approved template, and credentials are supplied and verified. No secret values belong in source control.

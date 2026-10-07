# Family InstaPay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Let a student or a linked parent initiate and track a manual InstaPay payment for one specific student and purchase, with explicit administrator review and activation.

**Architecture:** Keep the existing student routes intact and add parent-scoped operations that resolve the selected child through `ParentStudentRelation`. Reuse `BillingService`, `InstapayService`, `AdminInstapayService`, and the current admin review UI; add a polling cue to the admin dashboard for new pending receipts.

**Tech Stack:** NestJS 10, Prisma, Next.js 14, React 18, PostgreSQL, Jest.

**Spec:** `docs/superpowers/specs/2026-10-07-parent-features-launch-design.md` (Family subscription and manual payment)

## Global Constraints

- Parent-selected `studentId` is accepted only after checking a live parent-child relation on the server.
- Each payment reference belongs to one student and one service; the admin verifies and activates that exact purchase manually.
- Preserve the student’s current payment workflow and current prices; no price changes, online payment API, or auto-activation.
- Do not read Production data, upload a real receipt, or deploy.

---

### Task 1: Refactor InstaPay operations around a server-verified student profile

**Files:**
- Modify: `apps/backend/src/instapay/instapay.service.ts`
- Modify: `apps/backend/src/instapay/instapay.service.spec.ts`
- Modify: `apps/backend/src/parent/parent.service.ts`
- Modify: `apps/backend/src/parent/parent.service.spec.ts`
- Create: `apps/backend/src/parent/parent-instapay.service.ts`
- Create: `apps/backend/src/parent/parent-instapay.service.spec.ts`

**Interfaces:**
- Add `assertLinkedStudent(parentUserId: string, studentProfileId: string): Promise<StudentProfile>` to `ParentService`.
- Add `ParentInstapayService` as the parent authorization boundary, with `initiateSubscription(parentUserId, studentProfileId, input)`, `initiateQuestionPack(parentUserId, studentProfileId, input)`, `submitReceipt(parentUserId, studentProfileId, input)`, and `listSubmissions(parentUserId, studentProfileId)`. Each method calls `ParentService.assertLinkedStudent` before invoking any payment lookup or mutation.
- Refactor `InstapayService` with profile-scoped operations for subscription initiation, question-pack initiation, receipt submission, and receipt listing. Keep student methods resolving `studentProfileId` from `userId` and delegating to these operations.
- Existing student-facing methods continue resolving `studentProfileId` from `userId` and delegate to the same implementation.

- [ ] Add failing tests for a parent with two linked students, a non-linked student, and a parent who has no profile.
- [ ] Add failing tests proving a parent cannot reuse another child’s payment reference or list another child’s receipt.

```ts
await expect(service.listSubmissions("parent-user", "unlinked-student"))
  .rejects.toThrow(ForbiddenException);
expect(prisma.instapayPaymentSubmission.findMany).not.toHaveBeenCalled();
```

- [ ] Run `pnpm --filter @smartify/backend exec jest src/instapay/instapay.service.spec.ts src/parent/parent.service.spec.ts --runInBand` and verify failure before implementation.
- [ ] Implement the shared student-profile operations and invoke them only after the parent relation check succeeds.
- [ ] Preserve upload size, MIME, magic-byte, amount, and duplicate-reference checks.
- [ ] Run the focused tests and backend build.
- [ ] Commit as `feat: scope InstaPay purchases to linked children`.

### Task 2: Add parent payment routes and family UI

**Files:**
- Modify: `apps/backend/src/parent/parent.controller.ts`
- Modify: `apps/backend/src/parent/parent.module.ts`
- Modify: `apps/backend/src/parent/parent-instapay.service.ts`
- Modify: `apps/frontend/app/[locale]/parent/page.tsx`
- Create: `apps/frontend/app/[locale]/parent/payments/page.tsx`
- Reuse: `apps/frontend/app/[locale]/billing/instapay/page.tsx`

**Interfaces:**
- Parent routes are under `/parent/children/:studentId/instapay/...` and guarded for `PARENT`.
- Exact routes: `POST /parent/children/:studentId/instapay/subscription/initiate`, `POST /parent/children/:studentId/instapay/question-pack/initiate`, `POST /parent/children/:studentId/instapay/receipt`, and `GET /parent/children/:studentId/instapay/submissions`.
- Parent UI selects a linked child and one existing purchase/service; student billing UI remains unchanged.

- [ ] Add route tests proving all initiate/list/submit operations check the linked child before payment lookup or write.

```ts
const route = `/parent/children/${studentId}/instapay/subscription/initiate`;
await request(app.getHttpServer()).post(route).set("Authorization", parentToken)
  .send({ subjectIds: [subjectId] }).expect(403);
expect(instapayService.initiateSubscriptionForStudentProfile).not.toHaveBeenCalled();
```

- [ ] Add parent payment UI for payment instructions, exact amount/reference, JPEG/PNG receipt upload, and pending/verified/rejected status.
- [ ] Localize all new labels and display Arabic/Social Studies subject names in Arabic per the shared MOE catalog.
- [ ] Run route tests, `pnpm --filter @smartify/backend build`, and `pnpm --filter @smartify/frontend build`.
- [ ] Commit as `feat: let parents submit child InstaPay receipts`.

### Task 3: Surface new admin receipt arrivals

**Files:**
- Modify: `apps/frontend/app/[locale]/admin/page.tsx`
- Modify: `apps/frontend/app/[locale]/admin/instapay/page.tsx`
- Modify: `apps/backend/src/admin/instapay/admin-instapay.service.spec.ts`

**Interfaces:**
- Reuse `GET /admin/instapay/pending-count` and the current pending review route; do not create a second receipt queue.
- Admin dashboard refreshes the pending count every 30 seconds while mounted; a count increase shows a localized in-app alert linking to `/admin/instapay`.

- [ ] Add a frontend verification checklist for initial count, count increase, page unmount cleanup, and review-link navigation.
- [ ] Poll with cleanup and prevent overlapping requests; keep the current pending list authoritative when the review page opens.
- [ ] Verify with `pnpm --filter @smartify/frontend build` and the existing admin InstaPay service tests.
- [ ] Commit as `feat: alert admins to pending InstaPay receipts`.

# Parent Feature Marketing and Release Verification Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make the public parent-feature page accurately reflect shipped capabilities and verify the full parent journey in Arabic and English.

**Architecture:** Keep the existing bilingual content module as the source of availability labels. Update statuses only after the dashboard, notifications, payments, and teacher-request plans have completed their focused checks.

**Tech Stack:** Next.js 14, React 18, Tailwind CSS, TypeScript.

**Spec:** `docs/superpowers/specs/2026-10-07-parent-features-launch-design.md` (Marketing page; Verification and release)

## Global Constraints

- Never label a capability available before its user path and access checks pass.
- Do not claim that a teacher request is a confirmed booking.
- Preserve the current EGP prices and defer price review.
- Do not deploy or run Production queries.

---

### Task 1: Update bilingual parent feature statuses and claims

**Files:**
- Modify: `apps/frontend/content/for-parents.ts`
- Modify: `apps/frontend/app/[locale]/for-parents/page.tsx`

**Interfaces:**
- Keep `ForParentsCopy.features` statuses as the only source of “available” versus “planned” labels.
- Arabic and English feature descriptions convey the same shipped behavior.

- [ ] Review every feature key in both locale arrays side by side and record a checklist in the implementation review; verify both locales have identical keys and corresponding availability states. The repository has no dedicated frontend unit-test setup for this content module.
- [ ] Mark multi-child overview, lessons/results, curriculum/subjects, usage, weak-topic review, and payment only after their implementation plans pass.
- [ ] Describe email/verified-WhatsApp result summaries using the approved four-field payload; keep phone-verification/configuration dependence clear.
- [ ] Describe teacher sessions as requests reviewed by the team, not instant booking.
- [ ] Remove the blanket disclaimer that all parent capabilities are under active development only when the page’s per-feature statuses accurately represent availability.
- [ ] Run `pnpm --filter @smartify/frontend build` and commit as `docs: reflect live parent features accurately`.

### Task 2: Final cross-flow review checklist

**Files:**
- Review: `apps/frontend/app/[locale]/parent/page.tsx`
- Review: `apps/frontend/app/[locale]/for-parents/page.tsx`
- Review: `apps/frontend/app/[locale]/admin/instapay/page.tsx`
- Review: `apps/frontend/app/[locale]/admin/teacher-requests/page.tsx`

- [ ] Verify a parent with two linked children sees both; an unrelated child is absent.
- [ ] Verify the parent dashboard does not contain conversation text, question text, or answer fields.
- [ ] Verify a quiz and a Practice batch produce only the approved summary fields and that each linked parent is resolved server-side.
- [ ] Verify an unlinked child cannot initiate or read parent payments, and upload alone does not activate a purchase.
- [ ] Verify new pending receipts increment the admin badge and the alert opens the pending review page.
- [ ] Verify a teacher request remains pending until an admin transition and is shown as confirmed only after the admin confirms it.
- [ ] Verify Arabic and English public pages match implementation state; Arabic and Social Studies remain Arabic across curriculum labels.
- [ ] Run the focused backend Jest suites and both backend/frontend builds; do not run any Production query, real transfer, or deployment.

## Delivery dependency

Complete plans 1–4 before this release plan. WhatsApp is not live until a verified sender/template and credentials are supplied and an authorized delivery check succeeds.

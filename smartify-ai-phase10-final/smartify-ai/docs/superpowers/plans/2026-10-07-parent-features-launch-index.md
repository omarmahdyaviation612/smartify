# Parent Features Launch Execution Plans

> **For agentic workers:** Read the approved design at `docs/superpowers/specs/2026-10-07-parent-features-launch-design.md` and the one subsystem plan being executed. Follow each plan task-by-task; do not mix workstreams.

**Goal:** Finish the parent capabilities shown as under development, in independently reviewable and testable deliveries.

**Architecture:** Extend the existing linked-child parent dashboard first, then add result delivery, parent-initiated manual payment, and administrator-managed teacher requests. Update the marketing page only after the corresponding capabilities are verified.

**Tech Stack:** Next.js 14, React 18, NestJS 10, Prisma, PostgreSQL, Clerk, Resend, and the existing manual InstaPay flow.

**Spec:** `docs/superpowers/specs/2026-10-07-parent-features-launch-design.md`

## Global Constraints

- Parent data is limited to children connected through `ParentStudentRelation`.
- Parents never receive question text, submitted/correct answers, explanations, or student conversations.
- Arabic Language and Social Studies remain Arabic and use the existing grade-specific shared MOE content; do not duplicate curriculum content or invoke AI to recreate it.
- Results messages contain only child name, score, subject, and completion date/time.
- InstaPay remains a manual receipt and administrator-review flow; payment is available to the student or a linked parent and is scoped to one student and purchase.
- Do not change prices in this project; pricing review is last and separate.
- Teacher requests are not confirmed bookings until an administrator confirms them.
- Do not query Production, test a real payment, or deploy during implementation without separate authorization for the specific target and action.

## Delivery order

1. [Family dashboard and reporting](2026-10-07-family-dashboard-reporting.md)
2. [Quiz and Practice result notifications](2026-10-07-parent-result-notifications.md)
3. [Parent and student InstaPay](2026-10-07-family-instapay.md)
4. [Teacher session requests](2026-10-07-parent-teacher-requests.md)
5. [Parent feature marketing and release verification](2026-10-07-parent-feature-release.md)

Each plan ends with its focused mocked checks and application build. The next plan begins only after the prior delivery has a clean diff and passes its focused checks.

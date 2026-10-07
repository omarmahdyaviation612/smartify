# Parent Features Launch Design

## Goal

Complete the capabilities marked “Planned” on `/[locale]/for-parents` by building on the existing parent-child relationship, dashboard, curriculum sharing, manual InstaPay, and result records. Preserve strict access to linked children, and update marketing status only after each capability is implemented and verified.

## Approved scope

### Family dashboard and curriculum identity

- A parent account can link and view multiple student accounts through the existing single-use invitation flow.
- The parent dashboard shows only linked children. For each child it shows name, curriculum, grade, subjects, completed lessons, quiz/exam results, and learning progress.
- Arabic Language and Social Studies always display and teach in Arabic. For a given grade, British and American curriculum catalogs use the existing shared Egyptian MOE content identity; do not duplicate PDFs, Units, Topics, grounding, lessons, or questions, or make new AI calls to recreate them. The separate shared-MOE design remains the authority for subject identity and content resolution.
- Parents do not receive student conversations, question text, or submitted answers.

### Usage and review guidance

- Show AI question usage and remaining daily allowance per child and subject using the existing daily usage enforcement data and configured limit. This is read-only; limits remain administered by the Smartify team.
- Show weak topics and suggested review using recorded practice attempts and assessment results. Use deterministic aggregation of existing records; this view must not make AI-provider calls.
- Keep the calculation explainable and avoid claiming a trend where there is not enough history.

### Assessment and practice notifications

- Notify only parent accounts linked to the student when a quiz, mock exam, topic assessment, lesson check, or submitted Practice batch is completed.
- Deliver via email and WhatsApp. The notification body contains only the child’s name, score, subject, and the completion date and time. It must not include questions, selected or correct answers, explanations, conversation content, or token/cost details.
- Practice notification is one summary per submitted answer batch, not one message per answer.
- Reuse the existing Resend email service, which currently sends only for lesson checks. Add an isolated WhatsApp delivery adapter; no WhatsApp provider or parent phone field currently exists. Send to an email on the linked parent account and a WhatsApp number only after it has been collected and verified. Missing provider configuration, unverified contact, or delivery failure must not block the student’s result; the parent dashboard remains the source of truth.
- Delivery is best-effort and deduplicated per completed result/batch. Log delivery status without logging scores, answers, or contact data.

### Family subscription and manual payment

- Payment initiation is available from either the student account or a linked parent account.
- A parent must select the child and then the specific subject or service. Server-side checks must prove that the selected child is linked to that parent and that the requested item belongs to that child; clients cannot supply an arbitrary student identity.
- Both roles use the existing manual InstaPay transfer and receipt-upload flow. The submission is associated with the intended child and purchase, and remains pending until an administrator reviews the receipt and explicitly activates the correct service for that child.
- Show pending/approved/rejected status in the appropriate student or parent view. The admin dashboard surfaces new pending receipts and their count for review. Do not auto-activate on upload, consolidate subscriptions across children, add a payment API, or change prices in this project. Price review is a separate final step after these features are delivered.

### Teacher session requests

- Add a parent request flow that captures the linked child, subject/topic, and preferred contact/time information.
- A request is not a confirmed booking. An administrator reviews it, contacts the family, and confirms the session manually. Provide request status to the parent and an admin queue.
- No availability calendar, teacher matching automation, payment, or session pricing is included. No price is invented.

### Marketing page

- Replace the blanket “Planned / under active development” claims with per-capability availability that matches the shipped experience in Arabic and English.
- A capability changes to “Available” only after its user path, access controls, and failure states pass verification. Keep unavailable capabilities accurately labeled and do not imply the manual teacher request is an automatically confirmed appointment.

## Architecture and data flow

The existing `ParentStudentRelation` is the authorization boundary. Parent-facing endpoints must scope all reads, payments, result notifications, and requests by the authenticated parent’s relation rows; student-provided invitation codes remain single-use and expiring. Reuse the existing dashboard result records, `AIUsage`/`AIDailyUsageCounter`, question attempts, subject sharing resolution, payment receipt handling, and `EmailService` where possible.

If new persisted data is needed, keep it narrow: verified parent WhatsApp contact/notification preference, notification delivery deduplication/status, and teacher session request state. Any schema change must be additive and have a safe migration; avoid storing answer content or duplicating canonical MOE curriculum content.

## Failure and privacy behavior

- Missing parent profile, invalid relationship, or unlinked child fails closed; no student identity can be queried by supplying an ID alone.
- Email/WhatsApp outages never fail a quiz, practice submission, or payment receipt upload. Persisted dashboard data remains available and failed delivery is visible to operators for retry.
- Parent views and outbound result notices expose only the approved summary fields. No conversation access is added.
- Receipt review failure leaves the payment pending; only an explicit administrator confirmation activates service.
- Missing or unverified WhatsApp contact disables that channel for the parent and must not fall back to an unverified number.

## Verification and release

- Add mocked tests for multi-child isolation, unlinked-child rejection, grade-scoped shared subject display, no duplicate curriculum/AI work, correct per-subject usage, deterministic weak-topic summaries, notification field allowlist and recipient scoping, one notification per Practice batch, delivery failure/deduplication, parent- and student-initiated receipt scoping, manual activation, admin pending-receipt visibility, and teacher request state transitions.
- Verify both Arabic and English pages and narrow mobile layouts. Run the focused backend/frontend checks and builds defined by the repository.
- Do not run Production queries, send real test payments, or deploy as part of implementation unless separately authorized for the specific action and target. Production WhatsApp delivery additionally requires an approved provider, verified sending number, and configured credentials; do not represent it as live before a real delivery check is authorized and completed.

## Delivery decomposition

1. Family dashboard: multi-child details, subjects/curriculum, progress, usage, and deterministic review guidance.
2. Result notifications: email and verified WhatsApp, limited payload, parent scoping, and delivery fallback.
3. Family payment: student/parent initiation, child-scoped manual receipt review, and admin pending signal.
4. Teacher requests: parent request form, admin queue, and manual confirmation.
5. Marketing status and final cross-flow verification; prices reviewed only afterward in a separate change.

The first implementation plan should target delivery group 1. Groups 2–4 may proceed in order after their dependencies and external configuration are reviewed; group 5 closes the parent-feature launch.

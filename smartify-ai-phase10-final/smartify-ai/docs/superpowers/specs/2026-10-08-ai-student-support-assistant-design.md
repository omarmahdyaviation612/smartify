# AI Student Support Assistant Design

**Status:** Approved for implementation  
**Date:** 2026-10-08

## Goal

Give students an in-app technical support assistant that can inspect a screenshot the student chooses to upload, guide them through troubleshooting one step at a time, and hand unresolved problems to a human support employee through an admin ticket queue.

## Approved product decisions

- The first release is for students. Parent support can be considered separately.
- The assistant is a dedicated technical-support experience, separate from the curriculum Tutor.
- The student describes the problem and explicitly uploads its screenshot; the app does not capture the screen silently.
- The assistant uses the screenshot, the student's description, and limited safe page context to explain troubleshooting steps and stay with the student through the attempt.
- The assistant never executes account, subscription, payment, or curriculum changes. It does not request passwords, authentication codes, or payment credentials.
- The assistant only troubleshoots technical problems using Smartify. It refuses general questions and unrelated tasks such as recipes, writing software, or copying/cloning a product; obvious unrelated requests are rejected before any AI provider call.
- The student can request a human at any time. The assistant also escalates when it cannot resolve the issue, troubleshooting stalls, or AI support is unavailable.
- Escalation creates a ticket in the admin dashboard and emails support staff. Staff replies from the dashboard; the student sees the reply in the same support conversation and receives an email notification.
- Support-ticket states are New, In progress, and Closed. Staff can take ownership, reply, and close a ticket. Students can mark the issue resolved or request reopening while the ticket is available.
- The screenshot and support conversation are deleted 10 days after ticket closure. Access to open support conversations and their screenshots is restricted to the owning student and authorized support administrators.
- Support does not consume the student's lesson Tutor question allowance. It has separate configurable usage and spend limits. If a limit or AI outage prevents assistance, the student can still submit a human-support ticket.

## Recommended architecture

Create a dedicated Student Support domain rather than adding screenshot troubleshooting to the Tutor chat. Reuse the existing authentication and student profile, AI provider and usage/budget controls, private upload/storage utilities, Resend email service, and admin authorization patterns. Keep support sessions, ticket status, assignment, messages, and retention metadata independent of curriculum learning history and lesson question allowances.

Persist the screenshot in private storage and support text in the application database while the case is open. The model receives only the uploaded screenshot, the student's description, the current route/page name, locale, and a small allowlisted set of non-sensitive client diagnostics. Never send cookies, bearer tokens, browser storage, full URLs containing query secrets, unrelated lesson conversations, or arbitrary account data to the model. Do not put screenshot bytes, full message content, or personal identifiers in application logs or email bodies. Admin email notifications should link to the authenticated ticket in the admin dashboard.

The AI response is guidance only. The backend owns identity checks, upload validation, rate and spend limits, transcript ownership, ticket creation, message persistence, staff access, and the 10-day deletion schedule. The frontend cannot mark a case as staff-resolved or access another student's case by supplying an identifier.

## Student and support-staff flow

1. The student opens Technical Support, describes the issue, and explicitly selects or captures an image using the browser's normal file picker/camera controls.
2. The backend authenticates the student, validates file type, byte size, and decoded dimensions, and creates an owned support conversation. It stores the image in private storage and records the current app route and locale, excluding query strings and credentials.
3. The assistant receives the image, description, safe context, and only the current support conversation. It replies with one clear troubleshooting step and asks whether it worked before continuing.
4. The assistant offers “Contact support” at any point. It also escalates on repeated failed steps, uncertainty, provider errors, or a support budget limit. No AI failure may prevent creating a human ticket.
5. On escalation, create or update one ticket for the conversation, include an AI-written concise summary, preserve the student/assistant transcript and screenshot for the ticket, set status to New, and email support staff a secure dashboard link. Avoid duplicate tickets from repeated clicks.
6. A support employee opens the ticket, reviews the screenshot and transcript, changes status to In progress, and replies from the admin dashboard. The student sees the reply in the existing support conversation and receives a notification email with a secure app link, not the screenshot or transcript.
7. The employee closes the issue after resolving it. The student may mark it resolved; reopening returns it to the queue while the case is retained. Delete the image and support conversation 10 days after the ticket is closed. If the ticket is reopened before deletion, reset the retention deadline until it is closed again.

## Data and API boundaries

Add a dedicated support case/conversation model linked to the authenticated StudentProfile, with ticket status, timestamps, assignment/closure metadata, and a deletion deadline. Add support messages with sender type, text, and creation time. Store screenshot object keys and validated metadata only; keep the object private and issue short-lived access for authorized staff viewing. Do not store screenshot base64 in database rows or logs.

Expose authenticated student endpoints to create a support case/upload, send a message, request escalation, list the student's own cases, retrieve a case, and mark a case resolved or request reopening. Expose admin-only endpoints to list/filter tickets, view authorized case contents and screenshot, update status/assignment, and reply. Every endpoint scopes student operations to the authenticated profile; every admin operation requires an explicit support/admin role. Email delivery must be best effort and must not roll back a persisted ticket or reply.

Exact endpoint paths and storage implementation are implementation decisions; the access-control and payload boundaries above are requirements.

## AI behavior and cost controls

- Use a separate feature key for technical-support AI usage. Do not consume Tutor questions or homework-helper exercise credits.
- Apply per-student request limits, image limits, a maximum number of assistant turns per case, and an independent configurable support budget. Record actual provider usage in the existing AI usage ledger.
- If the support limit is reached, stop AI calls with a plain explanation and leave the “Contact support” path available.
- The assistant must not claim it changed settings or fixed the account. It can describe steps the student or an authorized employee can take.
- If the problem concerns billing, account access, safety, or a consequential account action, prioritize human escalation. Do not ask for secrets or payment information.
- Keep the assistant limited to app troubleshooting; it should not become an open-ended tutor or general chat mode.

## Privacy and safety

- Require an explicit user-selected image. Accept only approved image types, enforce byte and decoded-pixel limits, and reject malformed files.
- Use private object storage with authorization checks and short-lived viewing access. Do not expose permanent public screenshot URLs.
- Restrict screenshot and transcript access to the owning student and authorized support administrators. Do not expose them in parent dashboards or general analytics.
- Exclude screenshot bytes, transcript text, credentials, and full URLs from logs, email bodies, and analytics.
- Delete screenshot objects, support messages, and case content 10 days after closure. Retention cleanup must be retryable and visible to administrators if it fails; deletion must cover storage as well as database content.
- Do not automatically capture the page, inspect unrelated browser tabs, read local storage/cookies, or execute actions in the student's session.

## Failure behavior

- Unsupported, malformed, or oversized image: explain the problem and let the student choose another image; do not call the AI provider.
- AI timeout, provider outage, or budget exhaustion: keep the conversation available and offer ticket submission immediately.
- Email outage: persist the ticket/reply and show it in the relevant dashboard/conversation; log a delivery status without logging private content, and allow an authorized retry.
- Unauthorized case access: fail closed without revealing whether another student's case exists.
- Storage deletion failure: retain the deletion deadline, retry cleanup, and surface a non-sensitive operational alert; do not report the data as deleted until storage confirms it.
- Student closes the page mid-conversation: persist enough state to resume their own case later.

## Verification and release

Before release, cover the following with focused mocked tests and an end-to-end smoke flow:

- Student ownership and admin role enforcement across case listing, messages, screenshot viewing, status changes, and replies.
- Upload validation, private storage, cleanup on upload failure, and proof that screenshot bytes and message content never enter logs/email payloads.
- One-step-at-a-time guidance, explicit human request, uncertainty/repeated failure escalation, and AI outage/budget fallback to ticket creation.
- Idempotent ticket creation, status transitions, staff replies appearing to the correct student, email best-effort behavior, and retry visibility.
- Ten-day retention calculation, reset on reopening, and deletion of both database content and private storage objects, including retry after a failed deletion.
- Arabic and English student/admin interfaces and narrow mobile layouts.
- No use of Tutor question allowances; separate support AI spend is recorded and bounded.

Release only after an authorized test student can upload a screenshot, receive guided steps, escalate, see an admin reply, and after an authorized staff account can process the ticket without cross-student access. Verify the 10-day cleanup path in a controlled environment before enabling automatic deletion in production.

## Out of scope for the first release

- Parent-facing support and parent access to student support screenshots or transcripts.
- WhatsApp support or WhatsApp notifications.
- Silent/automatic screen capture, remote control, click automation, or account/entitlement changes by AI.
- Human support SLA promises, staff scheduling, or a public support email address.
- General curriculum tutoring, diagnosing student performance, or using course conversations as support context.
- A separate paid student support plan; usage and spend are operationally capped, with exact numeric limits set in trusted server configuration.

## Design self-review

- The approved support flow, admin/email escalation, staff replies, and 10-day post-closure retention are represented consistently.
- Student data access is scoped to the owner; support staff access is role-gated; screenshots remain private.
- AI cannot mutate accounts, and AI failure does not block a human ticket.
- Support AI spend is separate from lesson question allowances and bounded independently.
- No unresolved product decisions are hidden in the design; exact endpoint paths and trusted numeric usage caps remain implementation/configuration choices.

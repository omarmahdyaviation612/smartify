# AI Student Support Assistant Implementation Plan

**Status:** Executing with user authorization  
**Design:** `docs/superpowers/specs/2026-10-08-ai-student-support-assistant-design.md`

## Goal and boundaries

Deliver a student-only technical support area, separate from the learning Tutor. Students describe an issue, explicitly attach a screenshot, and receive one-step-at-a-time troubleshooting. The assistant must not change accounts or entitlements. Students can escalate at any time; escalation creates an admin ticket and sends a notification email. Staff reply in the admin dashboard and students receive the reply in the conversation and by email. Keep screenshots and conversation until ten days after closure, then remove them. Support has independent limits and never spends Tutor question credits.

## Implementation tasks

1. **Persistence and migration**
   - Add support ticket, message, and private attachment metadata models with explicit ownership, status, assignment, creation/closure/deletion timestamps, safe route and locale fields, and useful indexes.
   - Add a migration without touching existing curriculum, billing, or student data.
2. **Private upload storage and retention**
   - Add a private-object storage service using existing S3 configuration, strict JPEG/PNG signature, byte-size, and decoded-dimension validation, and no public URLs.
   - Serve image bytes only through an authenticated ownership/admin-checked endpoint with `private, no-store` headers.
   - Delete expired content idempotently after closure + ten days; retain the ticket’s minimal non-content audit state as specified.
3. **Student API and AI guidance**
   - Create a dedicated support module/controller/service with student-only ownership checks, safe route context allowlist, per-student request/turn caps, separate feature spend cap, and AI usage ledger rows tagged `student_support` with zero Tutor credits.
   - Persist the issue, attachment, and messages; send only the current support conversation and user-selected screenshot to the vision-capable provider.
   - Provide a no-AI path to submit a human ticket and fallback escalation on provider/budget failure. Never log transcript or image data.
4. **Human ticket workflow and email**
   - Add support admin endpoints for queue, details, assignment, reply, close/reopen, and authorized attachment viewing.
   - Email staff on escalation and students on staff reply using generic content and authenticated dashboard/conversation links; never attach screenshots or transcripts to email.
5. **Student and admin UI**
   - Add bilingual `/[locale]/support` student flow with screenshot picker, description, stepwise chat, retry/escalate controls, and ticket status/reply view.
   - Add a global student support shortcut alongside the existing dashboard shortcut.
   - Add bilingual admin support queue/details page and navigation entry using existing admin guard patterns.
6. **Review and handoff**
   - Inspect migration/schema diff, authorization boundaries, storage lifecycle, limits, and both locales; document any configuration prerequisites and known limitations.
   - Automated tests/builds and deployment are outside this work pass unless the user asks to verify or deploy.

## Key files to inspect or change

- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/<timestamp>_student_support/`
- `apps/backend/src/app.module.ts`
- `apps/backend/src/ai/usage/ai-usage.service.ts`
- `apps/backend/src/email/email.service.ts`
- New `apps/backend/src/student-support/**`
- `apps/frontend/app/[locale]/layout.tsx`
- New `apps/frontend/app/[locale]/support/page.tsx`
- New `apps/frontend/app/[locale]/admin/support/page.tsx`
- `apps/frontend/app/[locale]/admin/page.tsx`

## Risk controls

- No public attachment URLs; every read is authorized on the server.
- No silent screen capture, secrets, browser storage, or query parameters sent to AI.
- File signature and decoded dimensions are validated; temporary buffers are zeroed.
- Separate support accounting is enforced before provider calls; support usage never consumes Tutor credits.
- Email notifications contain no sensitive content and never block ticket creation/reply.
- Retention cleanup is repeat-safe and content deletion is logged without logging content.

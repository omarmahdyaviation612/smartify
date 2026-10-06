# Curriculum-Grounded Homework Helper Design

**Status:** Design for user review
**Date:** 2026-10-07

## Goal

Give a student a photo-based homework helper that coaches the student through one exercise using only trusted material from the student's own curriculum and grade. The student should do the work: the helper offers one hint or question at a time, checks attempts, and reveals a complete worked solution after three incorrect answer attempts, with an option to request the solution earlier.

The feature is a paid monthly add-on to the student's existing subscription. It has its own visible monthly homework-question allowance. The actual price and allowance size are intentionally deferred to the later pricing decision.

## Approved product decisions

- Student selects one of their entitled subjects before taking or uploading a photo.
- The first release handles one exercise per image; whole worksheets and question cropping are out of scope.
- The system proposes a matching curriculum topic from the student's own grade and curriculum. The student confirms it. If matching is ambiguous, the student selects a unit or topic before tutoring starts.
- Tutoring context must come from a valid, current, topic-scoped curriculum grounding assignment. If the question cannot be tied to supported curriculum content, the helper requests clarification or reports that the material is unsupported. It must not answer from general knowledge.
- Tutoring provides one hint or question at a time. Only explicit incorrect answer attempts count toward the three-attempt reveal threshold. Hints do not count as incorrect attempts. The student may request the worked solution early.
- One accepted exercise consumes one monthly homework-question credit and covers its image analysis, tutoring turns, and worked solution. Unreadable, unsupported, or failed submissions do not consume a student credit.
- Raw photos are processed transiently and are not retained by the application. The extracted question, conversation, attempts, and session state are stored so the student can resume later.
- The add-on is a separate entitlement and allowance, but is billed with the existing subscription in one monthly invoice. Exact prices are deferred.

## Recommended architecture

Add a dedicated Homework mode and backend module that reuses the current authentication, subject entitlement checks, curriculum grounding helpers, AI provider selection, AI cost ledger, and budget circuit breakers. Keep homework session state and its student-facing monthly allowance distinct from ordinary Tutor conversations and Tutor question packs. This isolates the different pedagogy, photo handling, strict grounding gate, and billing entitlement without duplicating authentication or provider safety controls.

The current `Subscription` model is unique per student, and current subject billing snapshots a monthly total. The add-on therefore extends the existing subscription lifecycle rather than creating a second recurring subscription. Any pending add-on change must become active only through the existing verified payment activation paths; cancellation or past-due subscription lifecycle events must disable the add-on consistently. Store the add-on's active state, billing-period dates, and price snapshot separately from subject selection so removing or changing a subject cannot accidentally grant or revoke the homework entitlement. Preserve provider-specific restrictions and fail closed when the student's current provider cannot process an upgrade.

## Student and server flow

1. The student opens Homework Help, selects an entitled subject, and captures or selects one image.
2. The server authenticates the student, checks active subject entitlement and paid add-on status, validates the image type and size, and atomically reserves one allowance credit. It applies upload throttling and AI budget reservation before any paid vision request.
3. A vision-capable provider extracts the exercise text and proposes candidate topics drawn only from the student's curriculum, grade, selected subject, and active topics with valid grounding assignments. Do not log image bytes or persist the raw image. Always release temporary buffers/files in success and error cleanup paths.
4. If the image cannot be read, the question is unsupported, or no valid topic can be matched, return a clear retry/unsupported result and refund the allowance reservation. Record provider usage and enforce platform spend limits even when the student credit is refunded.
5. Show the proposed topic for student confirmation. If the system cannot identify one candidate reliably, ask the student to choose an eligible unit/topic. Do not start tutoring until a valid, grounded topic is confirmed.
6. On confirmation, commit the reserved monthly question credit and create a resumable homework session containing extracted text, subject/topic identifiers, curriculum/grade identity, attempt count, status, and text messages. Never store the source image.
7. For each turn, re-check session ownership, current entitlement, the confirmed topic's grounding validity, the monthly credit reservation, per-session safety limits, and global/per-user AI budget before calling the provider. Give the model only the validated topic-scoped curriculum content and conversation history.
8. Count explicit student answer submissions that are judged incorrect. At three incorrect answer attempts, offer the complete worked solution; support an explicit early reveal request. Mark the session solved when the student demonstrates a correct solution or completes the worked solution flow.
9. Persist session state and text messages after each successful turn. Allow the owner to list and resume unfinished sessions. Access checks must prevent one student from reading or mutating another student's session.

## Data and API boundaries

Introduce a Homework domain rather than expanding the generic Tutor endpoint with image-specific modes. The backend owns image validation, allowance reservation/refund, topic candidate selection, grounding checks, attempt counting, session ownership, and whether a worked solution can be shown.

Persist a homework session and text-only message history. Track allowance reservations/consumption idempotently by student, billing period, and accepted exercise so concurrent requests cannot overspend the monthly allowance or consume a credit twice. A session is linked to the student's profile, entitled subject, confirmed topic, and the curriculum/grade context used at creation. Session state should distinguish at least awaiting-topic-confirmation, tutoring, solved, unsupported, and closed/limit-reached.

Expose authenticated endpoints for: add-on/allowance status; transient image submission and topic proposal; topic confirmation; tutoring turns and early solution request; session listing; and session retrieval/resumption. The frontend must never decide entitlement, attempt count, grounding validity, or quota consumption.

## Billing and usage controls

- Treat the feature add-on as an item on the existing student subscription and verified payment lifecycle, with an independent entitlement state and monthly exercise allowance.
- Use current verified checkout/upgrade and webhook or administrator-confirmation flows. Do not enable access based only on a client redirect, submitted receipt, or a client-supplied student/subject identifier.
- The server computes the final monthly amount from trusted pricing configuration. Do not accept price or allowance values from the client. Pricing and allowance size are a later decision.
- Enforce the monthly question allowance with an atomic reservation. Refund the reservation on unreadable/unsupported input and provider failures before an accepted exercise; do not refund after tutoring has started.
- Record actual provider/model/input/output token usage under a distinct homework feature key in the existing AI usage ledger. Apply the existing global and per-user USD safety budgets to every costly operation, including image analysis and each tutoring turn.
- Apply configured image byte/pixel limits, supported image MIME types, request throttling, and a server-side per-session call/token ceiling. The student-facing allowance remains exercise-based; technical caps protect against unusually long sessions and abuse.
- If an add-on upgrade cannot be applied for a provider, keep access locked and present the existing supported billing path/contact flow. Do not bypass provider lifecycle verification.

## Privacy and safety

- Accept only explicitly supported image MIME types and enforce byte and decoded-pixel limits before model submission.
- Keep image bytes out of persistent database/object storage, application logs, error reports, analytics, and session history. Clean up in-memory buffers and any temporary processing artifact on every exit path.
- Persist only extracted text and student/assistant text messages, attempts, topic references, and session status. Provide a user-facing indication that the original photo is not saved.
- Restrict curriculum candidate matching to the student's own curriculum, grade, and entitled subject. A model suggestion is not authority: the backend verifies the chosen topic and its current grounding assignment before tutoring.
- Never fall back to open-domain answers when grounding is missing, stale, blocked, or mismatched.
- Keep the early-solution request, answer judgments, and attempt counter server-controlled so client manipulation cannot bypass the designed tutoring flow or allowance.

## Failure behavior

- Unsupported format, oversized image, or unreadable photo: explain the issue and request another photo; no allowance credit is consumed.
- No supported curriculum match: explain that the question is outside the available course content; do not produce an answer; refund the reservation.
- Ambiguous topic match: ask the student to confirm a suggested topic or select an eligible topic; do not provide tutoring until resolved.
- Stale/blocked grounding, inactive subject entitlement, expired add-on, or exhausted allowance: stop before the provider call and explain the next valid action.
- Provider or platform budget failure: return a recoverable message, release uncommitted allowance/budget reservations as appropriate, and retain no image.
- Session ownership mismatch: return not found/forbidden without exposing another student's data.

## Testing and acceptance criteria

Implementation should include automated tests for:

- Subject/add-on authorization and verified billing activation/cancellation behavior, including duplicate webhook delivery.
- Atomic allowance reservation, refund on failures, period reset, and concurrent requests for the last credit.
- MIME, byte, and decoded-pixel validation; image cleanup and absence of image persistence/logging.
- Topic candidates restricted to the student's curriculum, grade, subject, active topics, and valid current grounding assignments; fail-closed behavior for absent/stale/mismatched grounding.
- Student confirmation and ambiguous-topic fallback.
- Hint turns not incrementing wrong-answer count; explicit wrong attempts incrementing it; full solution after three wrong attempts and early reveal on request.
- Session ownership, listing, resumption, and persisted text-only history.
- Actual usage ledger records feature `homework_helper` and accounts for vision and tutoring calls under existing spend limits.
- Arabic and English upload, guidance, error, allowance, and resume UI states.

Acceptance requires a student to complete a grounded photo-to-guidance session, resume an unfinished session, and reach a worked solution under the approved rules; an unsupported or ungrounded question must never receive a general answer; the photo must not persist; and the monthly allowance and actual AI spend must be enforced and auditable.

## Out of scope for the first release

- Whole-page worksheet parsing, multiple exercises per photo, or cropping/rotating/editing tools.
- Open-web search, answering unsupported topics from general model knowledge, or importing new curriculum sources.
- Final EGP price, monthly allowance size, and marketing copy for the paid tier.
- Voice tutoring, parent/teacher dashboards, or analytics beyond the usage ledger needed for operations and cost control.

## Design self-review

- No unresolved placeholders or contradictory user decisions remain in this design.
- The strict server-side grounding gate is explicit and does not rely on a prompt-only instruction.
- Payment access is tied to verified existing billing activation paths; unsupported payment-provider changes fail closed.
- The feature-specific session and allowance are separated from generic Tutor question accounting while reusing shared auth, grounding, provider, and budget controls.
- Exact pricing and allowance size remain intentionally open for the later pricing stage, as requested.

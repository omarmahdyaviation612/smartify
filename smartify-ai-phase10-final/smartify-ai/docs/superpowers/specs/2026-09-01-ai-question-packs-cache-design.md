# AI Question Packs and Tutor Answer Cache

## Goal

Allow a student to buy ten additional AI tutor questions for one subject on
the current day for 50 EGP, while reusing previously generated tutor answers
and enforcing friendly, curriculum-scoped teaching behavior.

## Scope

- This change applies to tutor chat only, not generated quizzes or practice
  assessments.
- The existing allowance remains ten questions per subject per day.
- The extra pack is exactly ten questions for exactly one subject and expires
  at the end of the current day.
- The Fawry checkout remains behind the existing payment-provider abstraction;
  until Fawry is configured, checkout is represented as pending/unavailable
  and no credits are granted.

## Data model

Add:

- A per-student, per-subject, per-day extra-credit counter or ledger that can
  be updated atomically and records the source purchase.
- A purchase record containing student, subject, quantity (10), amount (50),
  status (`pending`, `paid`, `failed`, `canceled`), payment provider/session
  identifiers, and timestamps.
- A tutor answer cache containing curriculum, grade, subject, optional topic,
  language, normalized student prompt, answer, model metadata, and timestamps.
  Add a uniqueness constraint over the scope fields and normalized prompt.

Existing conversation messages remain the student’s private history. Cached
answers contain no student name, account identifiers, or prior conversation
messages.

## Request flow

1. Tutor validates the student, selected subject, subscription, and message.
2. It searches the answer cache using curriculum, grade, subject, topic,
   response language, and normalized prompt.
3. On a cache hit, it returns the stored answer without reserving a daily
   slot, consuming extra credit, or calling the AI provider.
4. On a miss, it atomically consumes the daily slot first, then the student’s
   subject/day extra credit if the daily allowance is exhausted.
5. A successful provider response is saved to the private conversation and
   inserted/upserted into the cache. A provider or database failure releases
   the reservation and never grants or consumes extra credit incorrectly.

The extra-credit check and consumption must be concurrency-safe. A cached
answer must not bypass subject ownership, active subscription, or curriculum
scope checks.

## Purchase flow

- When the tutor reports no remaining daily questions and no extra credit,
  the frontend shows “شراء 10 أسئلة إضافية — 50 جنيه” for the current subject.
- The backend creates a pending purchase and asks the active payment provider
  for a checkout session.
- Only a verified payment webhook changes the purchase to `paid` and adds ten
  credits for that student/subject/day.
- Duplicate webhook delivery is idempotent.
- If Fawry is not configured, the endpoint returns a clear unavailable
  response and the UI explains that payment is coming soon.

## Tutor behavior

For Arabic responses, the system prompt explicitly requests gentle Egyptian
colloquial Arabic, simple wording, short explanations, examples, and a
supportive teacher tone. The tutor must remain inside the student’s selected
curriculum, grade, subject, and current topic when present. For unrelated or
out-of-scope questions it briefly redirects the student to the current
lesson instead of answering from outside the curriculum.

## API/UI

- Extend the remaining-questions response with daily remaining questions,
  extra remaining questions, and the fixed pack price.
- Add a subject-scoped purchase endpoint and payment response.
- Update the tutor UI to show the combined remaining count, the exhausted
  state, and the purchase action/status.
- Keep Arabic and English labels aligned.

## Testing and deployment

- Unit-test atomic daily-plus-extra consumption, cache hits/misses, cache
  isolation by subject/curriculum/topic/language, payment state transitions,
  webhook idempotency, and out-of-scope prompt instructions.
- Run Prisma schema validation and apply the schema with `prisma db push`
  because this repository has no migration baseline.
- Run the focused backend tests, backend build, frontend lint, and frontend
  build.

# Smartify AI — Phase 6: AI Tutor, AI Service Layer, Credit System

Builds on Phases 1–5. Nothing prior was restarted. This is the first phase that makes a real external AI provider call, so it gets more scrutiny than earlier phases.

## Architecture: provider abstraction is load-bearing, not decorative

`apps/backend/src/ai/` — feature code (`TutorService`) never imports the OpenAI SDK directly. It depends on `AIProviderFactory.getActiveProvider()`, which reads the active row from `AIProviderConfig` in Postgres and returns a concrete `AIProvider` (currently only `OpenAIProvider` is functional; `AnthropicProvider` and `LocalModelProvider` exist as real stub classes implementing the same interface, throwing a clear "not implemented yet" rather than pretending to work). Switching providers or models later is a database row change, not a redeploy.

`OpenAIProvider` fails **fast and clearly** if `OPENAI_API_KEY` isn't set — it throws `ServiceUnavailableException` from `generate()` rather than letting the SDK crash with a confusing error. The tutor endpoint propagates this as a plain "AI Tutor isn't configured yet" message, and the frontend shows the same message instead of a broken chat UI. This matters because this sandbox environment has no real OpenAI key — the code is written and structurally sound, but **has not made a real API call**. That's an explicit gap, not an oversight; see the verification section below.

## Credit / cost control — aligned to the real pricing model, not the Phase 1 draft

The Phase 1 draft imagined a generic monthly "AI Credits" pool (FREE/BASIC/PLUS/PREMIUM). That was superseded in Phase 3 by your actual approved pricing: **10 AI questions per subject per day, included in every subscribed subject**, with extra-question packages priced TBD. Phase 6 implements that real rule instead of the abandoned draft:

- `AIUsageService.getRemainingToday(studentId, subjectId)` counts today's `AIUsage` rows (`feature: "tutor_chat"`) for that student+subject and compares against `SystemConfig.default_daily_ai_questions_per_subject` (seeded `10`, admin-tunable).
- `TutorService.sendMessage()` checks this **before** calling the provider — an already-exhausted subject never spends real API cost.
- After a successful call, `AIUsageService.recordUsage()` logs a real `AIUsage` row using the model's **actual** token counts from the OpenAI response (not the pre-call estimate) and computes `costUsd` from `AIProviderConfig`'s per-token rates — so `Total Revenue > AI costs` stays measurable from real data, per the spec's cost-safety requirement.
- `AIUsage` gained two columns this phase (`studentId`, `subjectId`) — additive, non-breaking — specifically so per-subject daily limits are queryable without joining through conversations.
- The `AICredits`/`QuestionPackage` tables from Phase 3 remain reserved for when extra-question-package pricing is finalized (Phase 8, payments) — Phase 6 doesn't invent numbers for those.

## Safety guardrails — encoded once, in `AIContextBuilderService`

Every tutor request's system prompt is built by one function (`buildTutorSystemPrompt`), so guardrails can't drift between call sites:
- **Teaching approach** (spec §8): don't reveal the final answer immediately — hint, break into steps, reveal once genuinely attempted; explain the concept after revealing an answer, not just the mechanics.
- **Scope** (spec §9): stay within the student's current curriculum/subject; redirect if asked something unrelated.
- **Certainty**: state uncertainty plainly rather than presenting a guess as fact.
- **Age-appropriateness**: tone instructions vary by age band (young / middle-grade / advanced), pulled from the real `StudentProfile.age`.
- **AI-vs-verified content**: the prompt itself tells the model to acknowledge it's AI-generated tutoring, not verified curriculum content — and the API response includes `isAiGenerated: true`, which the frontend uses to badge every assistant message ("AI-generated" label, in `content/tutor.ts`), keeping the distinction from Phase 2's `Lesson.isAiGenerated`/`Question.isAiGenerated` fields consistent all the way to the chat UI.

This is prompt-level guardrailing, appropriate for an MVP — it is **not** a substitute for output-side content moderation, which isn't built in this phase and should be considered before any real production traffic.

## Frontend

`/[locale]/tutor` — subject picker (from the student's actual selected subjects via the existing `/dashboard/summary` endpoint, no new endpoint needed), a live "N of 10 questions left today" indicator, a simple chat thread, and graceful handling of both the "not configured" and "daily limit reached" error cases with distinct, honest messages rather than a generic failure. The dashboard's AI Tutor card is no longer a "Coming soon" placeholder — it's a real link, since the feature now exists (its *configuration* being incomplete in this environment is a deployment detail, not a missing feature).

## What Phase 6 does NOT include

- Streaming responses (the OpenAI call is request/response; streaming is a reasonable follow-up but adds real complexity for an MVP chat UI).
- Voice, image, or document input (explicitly deferred per the original spec's "future architecture" section).
- Output-side safety moderation/classification beyond the system prompt.
- Question Package purchases (pricing still TBD, per Phase 3 decision).
- Any change to `Assessment`/practice-question generation — that's Phase 7 (Practice & Quizzes), which can now reuse this same `AIProviderFactory`/`AIContextBuilderService` machinery instead of rebuilding it.

## Verification status

**Not run against a live OpenAI key in this environment.** The code path (`ClerkAuthGuard` → `TutorService` → daily-limit check → `AIProviderFactory` → `OpenAIProvider` → usage logging) is structurally complete and type-checked by inspection, but has not executed a real request/response cycle. Add this to the Phase 4 integration-test milestone checklist before production: set a real `OPENAI_API_KEY`, run `pnpm dev`, and confirm a full tutor exchange — including that the daily counter actually decrements and blocks correctly at the 10th question.

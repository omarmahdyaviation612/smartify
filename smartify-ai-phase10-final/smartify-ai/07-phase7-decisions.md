# Smartify AI — Phase 7: Practice & Quizzes

Builds on Phases 1–6. Nothing prior was restarted.

## Refactor: shared `TopicAccuracyService`

Before adding practice and quizzes, the per-topic accuracy logic that was inlined in `DashboardService` (Phase 5) got extracted into `apps/backend/src/analytics/topic-accuracy.service.ts`. Three features now need "what's the student's accuracy on topic X" — dashboard weak topics, practice's adaptive difficulty, and quiz weak-topic results — so this is defined in exactly one place instead of drifting across three reimplementations. `DashboardModule`, `PracticeModule`, and `QuizzesModule` all import `AnalyticsModule`.

Also added `QuestionAttempt.source` (`"diagnostic" | "practice" | "quiz"`, additive/non-breaking) so it's possible to tell which flow produced a given attempt — onboarding's diagnostic submission now tags its rows accordingly.

## Practice engine — rule-based adaptive difficulty, not an AI call

The spec's practice engine calls for the AI to "recommend practice based on weak areas." Phase 7 implements this **algorithmically**, not via an LLM request:

- `PracticeService.pickDifficultyWeights(accuracyPercent)` — a plain lookup table (weak accuracy → skew easy/medium, mid → balanced, strong → skew medium/hard), applied to the student's real, current accuracy for the selected topic(s) via `TopicAccuracyService`.
- This is a deliberate choice: spending an OpenAI call just to pick which existing question to serve next would be pure cost with no real benefit over a clear, fast, explainable rule — the AI Tutor (Phase 6) is where an actual LLM adds value (explaining, hinting), and that boundary stays intact here.
- `GET /practice/topics?subjectId=` — topics annotated with real accuracy (or "not attempted yet"), so the student can see where they're weak before choosing.
- `GET /practice/questions?subjectId=&topicId=&count=` — weighted random sample honoring the difficulty distribution above.
- `POST /practice/submit` — grades server-side, writes `QuestionAttempt` rows (`source: "practice"`), returns per-question feedback (correct/incorrect + the actual `explanationEn`) so it's a completed learning loop, not just a score.

## Quizzes & exams — same stateless pattern as onboarding's diagnostic

Rather than introduce a new "in-progress quiz" table, `QuizzesService` reuses the pattern already established by onboarding: `GET /quizzes/questions` returns a question set **without answers**, the client holds it locally, and `POST /quizzes/submit` grades everything at once and is the only place a `QuizResult` row gets created. Two types, per spec:

- **Topic Assessment** (`topicId` required) — ~8 questions from one topic.
- **Mock Exam** (subject-wide) — up to 20 questions spread across all the subject's topics.

`submitQuiz()` returns, all from real data: score, full per-question breakdown (your answer, correct answer, explanation), weak topics **within that specific quiz**, and rule-based recommended next steps ("Review 'X' (Y% on this quiz)") derived from those weak topics — again deliberately not an AI-generated recommendation, for the same cost/complexity reasoning as practice. `QuizResult.resultJson` stores the full breakdown so `GET /quizzes/results/:id` can replay it later.

## Frontend

`/[locale]/practice` and `/[locale]/quizzes` — both follow the same shape as onboarding's diagnostic UI (question list → submit → results), which keeps the codebase consistent rather than inventing a new interaction pattern per feature. The dashboard now links to both from its header instead of only linking to the AI Tutor.

## What Phase 7 does NOT include

- AI-generated practice questions or AI-written explanations — everything still comes from the existing (placeholder) question bank; question *generation* via the AI layer is a natural Phase 8+ extension once real curriculum content exists to generate from responsibly.
- Timed exams / exam-day UX (countdown timers, auto-submit) — the spec doesn't require this yet and it's a meaningful chunk of additional UI state.
- Quiz history browsing UI (the `GET /quizzes/results` list endpoint exists on the backend; no frontend page surfaces it yet — reasonable next increment).

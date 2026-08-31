# Smartify AI — Phase 3 Completion + Phase 4 (Onboarding) Decisions

Builds directly on `01-architecture.md`, `02-phase2-decisions.md`, and `03-phase3-decisions.md`. Nothing prior was restarted.

---

## Phase 3 completion: `/curricula` and `/for-parents`

### `/curricula`
- Backend: `GET /curricula` (public) returns the full Curriculum → Grade → Subject catalog from the database. `GET /curricula/:code/structure-sample` returns one real Grade → Subject → Unit → Topic → Lesson chain, used to illustrate "how content is structured" with **actual seeded data**, never a hand-written example.
- Frontend: hero, dynamic 4-system grid, a structure diagram followed by the live sample, an interactive `CurriculumExplorer` (curriculum → grade → subjects, client-side, backed by the same catalog fetch), and a CTA into onboarding. Nothing about curricula/grades/subjects is hardcoded in the page — if the seed changes, the page changes with it.

### `/for-parents`
- Purely a content page (`content/for-parents.ts`) listing eight capabilities from the spec (multi-child accounts, progress visibility, subject/curriculum tracking, AI usage visibility, daily limits, weak-area review, subscription management, teacher-session booking).
- **Every single one is currently marked `planned`, not `available`.** Even though `ParentProfile`/`ParentStudentRelation` exist in the schema (Phase 2), there is no parent-facing UI or API yet — so per the instruction not to overstate current functionality, nothing here is shown as live. The status is a plain field on each feature object (`content/for-parents.ts`), so flipping something to `available` later is a one-line change, not a redesign.
- CTA is "create an account" with an explicit disclaimer that parent access is enabled manually as features ship — not a functional self-serve parent signup, since role changes are admin-only (Phase 2 decision).

---

## Phase 4: Onboarding

### Scope decision: diagnostic is rule-based, not AI-adaptive

The master spec's Step 6 calls for an "AI-powered diagnostic assessment" with adaptive difficulty. That genuinely depends on the AI Service Layer, which is Phase 6. Building it now would mean either:
(a) faking AI behavior with hardcoded logic dressed up as "AI," or
(b) wiring a real OpenAI call this early, ahead of the credit/cost-control system Phase 6 is supposed to establish first.

Neither is right. Phase 4 instead ships a **real, working, rule-based diagnostic**: a fixed spread of existing question-bank items across the student's selected subjects, graded server-side, producing a genuine per-subject score and a simple "focus on your lowest-scoring subjects first" plan. This is honestly labeled in the UI (`copy.diagnostic.placeholderNotice`, `copy.planReady.planNote`) and in code comments as `generatedBy: "rule_based_v1"` on the `LearningPlan` row — so it's unambiguous, in the data itself, that this isn't the AI-personalized version yet. Upgrading to true adaptive/AI-generated diagnostics in Phase 6 is a service-layer change, not a schema change — `Assessment.scoreJson` and `LearningPlan.planJson` are already flexible `Json` fields.

### Backend (`apps/backend/src/onboarding`)

- `POST /onboarding/profile` — validates against the existing `studentOnboardingSchema` (packages/validation), verifies the grade belongs to the chosen curriculum and the subjects belong to the chosen grade (never trusts client-supplied relationships blindly), upserts `StudentProfile`, replaces `StudentSubject` rows.
- `GET /onboarding/diagnostic` — returns ~10 questions spread across the student's selected subjects' topics, **without correct answers**.
- `POST /onboarding/diagnostic/submit` — grades answers server-side against `Question.correctAnswerJson`, writes `QuestionAttempt` rows, creates an `Assessment` (`type: "diagnostic"`) with a per-subject score breakdown, and a starter `LearningPlan`.
- `GET /onboarding/summary` — assembles profile + latest diagnostic score + active learning plan for the final step.
- All four require `ClerkAuthGuard` (any signed-in user — no specific role needed to onboard yourself).

### Frontend (`apps/frontend/app/[locale]/onboarding/*`)

Five pages matching the spec's steps: `profile → curriculum → grade-subjects → diagnostic → plan-ready`.

- **State handling:** `profile` and `curriculum` write to a client-side draft (`lib/onboarding-draft.ts`, `localStorage`) rather than hitting the backend on every keystroke/screen — there's nothing durable to save until grade+subjects are chosen. `grade-subjects` is where the first real `POST /onboarding/profile` happens, submitting the full accumulated draft atomically. From that point on, the backend is the source of truth; `plan-ready` clears the local draft once it successfully reads the real summary back.
- **Auth:** all five pages are behind Clerk (not in the middleware's public-path list), and API calls use `lib/api-client.ts`'s `useApiClient()` hook, which attaches the live Clerk session token as a Bearer header on every request.
- Bilingual throughout via `content/onboarding.ts`, following the same `getXCopy(locale)` pattern as the rest of the site.

### What's explicitly NOT built yet (and says so in the UI)

`plan-ready` tells the student plainly that the full dashboard is "coming soon" (`copy.planReady.dashboardComingSoon`) — there's no dashboard to send them to yet; that's Phase 5.

---

## Clerk middleware — integration-test milestone (not yet verified)

Per your instruction, the current middleware composition (`apps/frontend/middleware.ts`) stays as-is, with its existing MVP-assumption comments preserved. To be explicit about its status:

- **Not yet run against a real Clerk application.** Everything in Phases 2–4 has been written and reasoned about, but this environment cannot execute `pnpm dev`, provision a Postgres/Redis instance, or hold live Clerk credentials — so none of this has been integration-tested end to end.
- **Before any production deployment**, treat the following as an explicit test milestone once a real Clerk app + database are wired up:
  1. Locale middleware + Clerk middleware composition — confirm a fresh visit to `/` correctly redirects to `/ar`, and that the Clerk `auth().protect()` call still fires correctly for protected paths after the locale-stripping logic in `middleware.ts`.
  2. Protected routes — confirm `/[locale]/onboarding/*` actually blocks unauthenticated access, and that `/[locale]/pricing`, `/[locale]/curricula`, `/[locale]/for-parents` remain accessible without sign-in.
  3. Session persistence — confirm a signed-in user stays signed in across a full page reload and across a locale switch.
  4. Redirects — confirm the post-sign-in/sign-up redirect lands somewhere sensible (currently no explicit `afterSignUpUrl`/`afterSignInUrl` is set — worth deciding once there's a real dashboard to land on in Phase 5).
  5. RBAC — confirm `GET /users` correctly 403s for a fresh `STUDENT` account and succeeds after manually promoting that account to `ADMIN`/`SUPER_ADMIN` in Postgres, per the Phase 2 README steps.

Until that milestone is run, the auth flow should be treated as **written, not verified**.

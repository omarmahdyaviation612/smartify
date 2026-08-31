# Smartify AI — Phase 5: Student Dashboard

Builds on Phases 1–4. Nothing prior was restarted.

## Design principle: show what's real, label what isn't

The master spec's dashboard section (streak, weekly study time, subject progress bars, weak topics, upcoming exams, achievements, AI Tutor shortcut) assumes several features that don't exist yet as of Phase 5 (gamification/streak tracking, exam scheduling, the AI Tutor itself, lesson-based progress). Rather than fabricate numbers or wire up dead links, `GET /dashboard/summary` returns `null`/empty for anything not actually implemented, and the frontend renders those as explicit dashed-border "Coming soon" cards (`ComingSoonCard`) instead of fake data or broken links.

**What's real and populated from actual data:**
- Profile header (name, curriculum, grade) — from `StudentProfile`.
- **Recommended focus** — from the rule-based `LearningPlan` created during onboarding's diagnostic step.
- **Subject progress** — derived from the diagnostic `Assessment.scoreJson`, explicitly labeled as diagnostic-based rather than lesson-completion-based (there's no lesson-consumption UI yet — that's Phase 6/7 territory with the practice engine).
- **Topics to review** — computed live from `QuestionAttempt` accuracy per topic (topics under 60% correct), which will naturally start reflecting real practice activity once the practice engine exists, without any backend changes.
- **Recent activity** — the student's last 5 `QuestionAttempt` rows (question, subject, correct/incorrect, timestamp) — genuinely happened, not sample data.

**What's explicitly "Coming soon":** AI Tutor shortcut (Phase 6), streak, weekly study time, achievements, upcoming exams. Each has its own honest one-line explanation rather than a vague "N/A".

## Backend

`GET /dashboard/summary` (`ClerkAuthGuard` only — any signed-in student). Throws `404` if the user hasn't completed onboarding yet (no `StudentProfile`); the frontend catches this and redirects to `/onboarding/profile` instead of showing a broken dashboard.

## Frontend

`/[locale]/dashboard` — client component (needs the live Clerk token via `useApiClient()`). Reuses `Navbar` for consistent nav/language-switch/sign-out access. `Navbar` itself now uses Clerk's `<SignedIn>`/`<SignedOut>` to show a "Dashboard" link + `UserButton` for authenticated users instead of always showing Login/Get Started.

The onboarding wizard's final step (`plan-ready`) now links to `/dashboard` instead of home, since it's a real destination.

## What Phase 5 does NOT include

No sidebar/app-shell navigation, no lesson browsing/"Continue Learning" (there's no lesson-consumption UI to continue into yet), no settings/subscription management page. These are natural extensions of the same pattern once their underlying features (practice engine, payments) exist.

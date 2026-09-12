# Smartify website QA — 2026-09-10

## Result

Broad local smoke test completed. The website is usable for navigation and admin inspection, but it does not pass a complete end-to-end readiness gate. All 46 localized route variants were visited; this is route coverage, not 46 fully verified workflows.

Environment: Chrome, trusted local frontend https://localhost:3443, backend http://localhost:4000, current signed-in account. No application source, account roles, curriculum, billing settings, student answers, or payment records were changed during this QA pass. Existing local data includes placeholder curriculum and activity. Earlier startup/configuration repairs preceded this pass.

## Automated verification

| Check | Result |
| --- | --- |
| Backend Jest (`node node_modules/jest/bin/jest.js --runInBand`) | 105 tests passed, 16 suites |
| Frontend routing (`node --test tests/auth-routing.cjs`) | 32 tests passed |
| Frontend Next lint | No warnings or errors |
| Frontend TypeScript (`tsc --noEmit --incremental false`) | Passed |
| Anonymous GET /users/me, /dashboard/summary, /admin/revenue/summary | All HTTP 401 |
| Anonymous Arabic/English dashboard and admin requests | HTTP 307 to locale-correct sign-in |

Anonymous HTTP probes test guards; they do not establish that a real OAuth login works over HTTP. The active browser uses HTTPS. No new build was run during this pass because the existing production server uses the build folder.

## Confirmed findings

### High: Practice start fails silently with missing topics

On `/ar/practice`, the current English subject is selected, with only “All topics” available. Clicking “Start Practice” leaves the form unchanged. Chrome records `ApiError: No topics found for this selection.` The user sees no explanation or recovery action. The English page has the same empty topic selection.

Source: `apps/frontend/app/[locale]/practice/page.tsx`, `startPractice()`, awaits the request without catching errors. Add a visible no-content state and request error handling, and provide topics/questions for the subject before claiming the learning flow is ready.

### High: Quiz start fails silently with empty topic

On `/ar/quizzes`, the topic assessment selector is empty but “Start Quiz” remains enabled. Clicking it leaves the page unchanged. Chrome records `ApiError: topicId is required for a topic assessment.`

Source: `apps/frontend/app/[locale]/quizzes/page.tsx`, `startQuiz()`, sends an empty topic ID and has no error handling. Require an available topic before enabling this action and display backend errors. Mock-exam completion was not tested.

### High: Billing has no purchase path for the current profile

On `/en/billing`, after “Loading plans...” disappears, only the heading and “You don't have an active subscription yet” remain. No plan or subscribe control appears. Public pricing and admin pricing do display plans. The Arabic billing route was also visited, but the settled empty state was specifically verified in English.

The exact data/configuration cause was not isolated. Investigate the available-plans response for this profile and its curriculum mapping; add an explicit empty-plan state. No checkout was started.

### Medium: Payment success page makes an unverified success claim

Opening `/ar/billing/success` or `/en/billing/success` directly displays “تم الاشتراك!” / “You're subscribed!” even though the billing page reports no active subscription and no payment was made in this test. Source inspection confirms this is static copy without payment/subscription verification.

This is a misleading UI state, not evidence of payment or entitlement bypass. Verify payment/subscription state before claiming success; distinguish pending, failed, and active states.

### Medium: Current diagnostic route sends an existing learner back to profile setup

`/en/onboarding/diagnostic` initially loads, then redirects to `/en/onboarding/profile` with empty fields. The current account already has a dashboard/profile, while its selected English subject has no topics. The exact diagnostic response was not captured. The frontend maps a 400 response to grade/subject setup, whose missing browser draft can redirect again to profile. Investigate this recovery path rather than making an existing learner restart without an explanation.

### Content and presentation gaps

- Curriculum selectors contain repeated, indistinguishable `[PLACEHOLDER] Grade 7` options.
- Dashboard recommendations, diagnostic results, and recent activity include placeholder Mathematics content, whereas the current learning subject selector contains English. The consistency of historical results with current enrollment needs review; no data was rewritten.
- Streaks, study time, achievements, and scheduled exams are explicitly coming soon.
- The Arabic admin routes still present their controls in English.
- Parent marketing marks capabilities as planned; the parent dashboard has profile/linking controls, but actual account linking was not exercised.
- Admin platform settings show Stripe as a development/test provider and Fawry/Paymob as not implemented. Payment processing remains unverified.

## Browser coverage

Each of the following was visited with both `/ar` and `/en` prefixes (23 routes per locale):

`/`, `/curricula`, `/pricing`, `/for-parents`, `/dashboard`, `/free-trial`, `/practice`, `/quizzes`, `/tutor`, `/billing`, `/billing/success`, `/parent`, `/onboarding/profile`, `/onboarding/curriculum`, `/onboarding/grade-subjects`, `/onboarding/diagnostic`, `/onboarding/plan-ready`, `/admin`, `/admin/users`, `/admin/curriculum`, `/admin/platform`, `/sign-in`, `/sign-up`.

Verified interactions and settled states:

- Public content and pricing render with Arabic RTL / English LTR.
- Curriculum selection updates British grades and subjects; language switching preserves the curriculum page route.
- Free-trial subject selection loads; Start Free Session navigates to Tutor.
- Tutor subject selector and message input load. No prompt was sent or trial credit consumed.
- Student dashboard and plan-ready summary render existing data.
- Onboarding curriculum/grade routes enforce browser-draft prerequisites. Empty profile submission is rejected by required-field validation. A full new enrollment was not completed.
- Admin overview and revenue summary load. User table loads. Curriculum pricing, upload selectors, AI/payment provider details, and system configuration are visible. No mutations/uploads were submitted.
- Signed-in sign-up eventually redirects to the homepage. Auth routes were visited under the existing session; this pass did not repeat OAuth, sign-out, or password recovery.
- At a temporary 390×844 viewport, Arabic/English home, Arabic pricing, and Arabic admin showed no horizontal document overflow. Default viewport was restored. This is a basic mobile smoke check, not a full accessibility or device audit.

## Admin access

The current signed-in account already has access to the Super Admin platform controls and revenue summary. No role change is needed.

- Dashboard: https://localhost:3443/ar/admin
- English dashboard: https://localhost:3443/en/admin
- Users: https://localhost:3443/ar/admin/users
- Curriculum and pricing: https://localhost:3443/ar/admin/curriculum
- Platform settings: https://localhost:3443/ar/admin/platform

The navbar's **Admin** link is also available after account data loads. These local links require the frontend, HTTPS proxy, backend, and database to remain running.

## Remaining coverage limits

Not verified end to end: real AI answers and credit accounting, payment/checkout/webhooks, destructive or privileged admin writes, PDF ingestion, new registration/onboarding completion, answer submissions/scoring against live data, parent/student linking, logout/relogin, non-admin authenticated role matrix, load/performance testing, full security audit, or full accessibility audit. Existing automated tests cover portions of these behaviors using test fixtures/mocks; passing them does not substitute for live integration verification.

Recommended next work: repair the Practice/Quiz empty/error states and content availability, investigate the missing billing plans, correct payment-success verification, then run end-to-end flows with a dedicated disposable student/parent test account and payment-provider sandbox.

# Smartify takeover verification — 2026-09-08

Production launch remains on hold. This pass inspected the current checkout and began Phase 1 with dependency triage only. No application source, dependency versions, credentials, databases, or containers were changed.

## Existing work

- HEAD: ec464b1, staging/integration foundation merge. `git log --oneline -15` returned eight commits, including staging DB/smoke foundation, admin material uploads, local auth/CORS/startup fixes, subject selection, and the free tutor trial.
- Monorepo: Next.js frontend, NestJS backend, and config/database/shared-types/UI/validation packages; pnpm 9.7.0 and Turbo.
- Initial working tree was NOT clean: 13 modified files covering backend PDF support and dependency additions, frontend admin uploads, onboarding guards/draft restoration, Clerk middleware, root metadata, Prisma schema, and lockfile. These changes remain intact.
- Handoff reports successful authenticated onboarding, resume/draft/summary persistence, and logout protection. Source inspection confirms the described Clerk middleware composition and prerequisite guards. Authenticated browser flows were not repeated in this pass.
- Existing environment validation, payment abstractions, AI usage controls, and health endpoints are present. Their presence is not evidence of production integration readiness.

## Fresh validation

Commands used `corepack pnpm` because pnpm was absent from the sandbox PATH; accessing its existing cache required sandbox escalation.

| Check | Result |
| --- | --- |
| Root `lint` | Failed: Turbo selected global pnpm 11.24.0 despite project pin 9.7.0 |
| Frontend direct `lint` | Pass, no warnings |
| Backend direct `lint` | Pass, one existing unused `isActive` warning in admin-ai-config.service.ts |
| Root `typecheck` | Missing script |
| Frontend `exec tsc --noEmit --incremental false` | Pass after production build completed |
| Backend `run test --runInBand` | 15 suites, 83 tests passed |
| Frontend `build` | Pass, Next.js 14.2.35, 45 static pages generated |
| Backend `build` | Pass |
| GET localhost:3000/en | HTTP 200 |
| GET localhost:4000/health/live | HTTP 200 |
| GET localhost:4000/health/ready | HTTP 200; readiness handler checks database with SELECT 1 |

An initial frontend typecheck overlapped Next.js type generation and reported missing generated files. The sequential rerun passed. Do not run those checks concurrently. Root lint replayed cached backend output; direct package lint above was run fresh. Existing tests use mocked dependencies; no seed, migration, payment, or AI request was executed. Existing servers were observed, not restarted; this does not prove they serve the newly built artifacts.

## Corrections and remaining work

- LearningMaterial is already in `20260905000000_baseline`. The missing migration is for the working-tree change adding required subjectId, its foreign key/index, and nullable topicId. Existing rows require a reviewed backfill; do not edit the baseline or apply a speculative migration to real data.
- Production environment checks require nonempty secrets and explicit FRONTEND_URL, but do not enforce production Clerk keys, HTTPS/public origin, or structured database/Redis URLs. Restricted runtime DB role design and isolated migration rehearsals remain outstanding.
- Unfinished upload wiring is visible: frontend posts subjectId to `/admin/curriculum/materials`, whose PDF branch passes the file object as the subject ID. The separate `/subject-materials` route is not used by that frontend. Upload parsing limits, AI output validation/usage accounting, and transactional writes require follow-up. Existing passing tests do not establish this new PDF path works.
- Remaining launch gates: dependency remediation; production domains/HTTPS/Clerk; environment validation; restricted DB role; migration reconciliation and empty/restored-copy rehearsals; payments/mapping/retries/pack purchases and Stripe verification; real AI configuration/budgets/failure handling; curriculum quality/uploads/write atomicity; runtime hardening/headers/logging/shutdown; backup/restore/rollback; full staging browser and integration validation.

## Phase 1 first task: dependency-security triage

Read-only `corepack pnpm audit --json` returned 0 critical, 23 high, 24 moderate, and 6 low findings. Counts represent registry findings, not demonstrated exploitable application paths. The accompanying JSON preserves advisory ranges and dependency paths. No `audit --fix` or dependency update was run.

Prioritized follow-up:

1. Review a narrowly scoped Multer update first. Installed 2.0.2 is pulled by @nestjs/platform-express 10.4.22 and used by FileInterceptor upload routes. Audit ranges identify 2.2.0 as covering the currently reported Multer advisories. Check Nest compatibility and verify malformed/aborted uploads with an isolated test harness before updating the lockfile. This avoids touching working Clerk auth or real data.
2. Assess Next.js 14.2.35 and Clerk 5.7.6 together before a framework change. Audit flags Next.js and transitive @clerk/clerk-react 5.12.0/js-cookie 3.0.5. Several Next.js advisory fixes lie outside the current major; do not treat a major upgrade as a routine patch. A source search found no explicit Server Actions, rewrites, remotePatterns, or Clerk combined authorization checks, but this is not proof of non-exploitability.
3. Address PostCSS 8.4.31 nested under Next.js separately from the direct frontend dependency. Then target development tooling paths (glob, minimatch, picomatch, tmp). Keep each lockfile change narrow and rerun relevant checks/audit.

Sources: [Next.js advisory](https://github.com/advisories/GHSA-h25m-26qc-wcjf), [PostCSS advisory](https://github.com/advisories/GHSA-6g55-p6wh-862q), and the registry advisory URLs in the saved audit. Dependency triage is complete; remediation remains open.

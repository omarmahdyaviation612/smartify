# Next.js runtime remediation — 2026-09-08

Next.js 14.2.35 -> 15.5.21. Clerk remains 5.7.6; React remains 18.3.1. All eight Next.js HIGH findings are removed from the final audit. Release acceptance is NOT complete: the cold-browser test detects repeated Clerk development handshakes on the local HTTP production-mode server. No environment or infrastructure configuration was changed to bypass that failure.

## Advisory inventory and applicability

Every row below matched the initially installed Next.js 14.2.35. Ranges show the branch containing that installation; later-major affected ranges are omitted. All are runtime request-handling issues, not build-only issues. They can matter wherever the corresponding HTTP server path runs, including development servers; the build process itself is not the attack entry point.

| Advisory / title | Vulnerable range containing 14.2.35 | Minimum stable patch | Smartify relevance |
| --- | --- | --- | --- |
| [GHSA-h25m-26qc-wcjf — RSC request deserialization DoS](https://github.com/vercel/next.js/security/advisories/GHSA-h25m-26qc-wcjf) | >=13.0.0 <15.0.8 | 15.0.8; 15.5 branch: 15.5.10 | Relevant: App Router and Clerk-generated Server Action |
| [GHSA-q4gf-8mx6-v5v3 — Server Components DoS](https://github.com/vercel/next.js/security/advisories/GHSA-q4gf-8mx6-v5v3) | >=13.0.0 <15.5.15 | 15.5.15 | Relevant: App Router and Clerk-generated Server Action |
| [GHSA-8h8q-6873-q5fj — Server Components DoS](https://github.com/vercel/next.js/security/advisories/GHSA-8h8q-6873-q5fj) | >=13.0.0 <15.5.16 | 15.5.16 | Relevant: App Router and Clerk-generated Server Action |
| [GHSA-c4j6-fc7j-m34r — WebSocket upgrade SSRF](https://github.com/vercel/next.js/security/advisories/GHSA-c4j6-fc7j-m34r) | >=13.4.13 <15.5.16 | 15.5.16 | Relevant self-hosted built-in Node server; absence of application WebSocket code is not sufficient to exclude it |
| [GHSA-36qx-fr4f-26g5 — Pages Router i18n middleware bypass](https://github.com/vercel/next.js/security/advisories/GHSA-36qx-fr4f-26g5) | >=12.2.0 <15.5.16 | 15.5.16 | Not applicable to inspected configuration: App Router with custom locale middleware, no Pages Router i18n configuration |
| [GHSA-m99w-x7hq-7vfj — App Router Server Actions DoS](https://github.com/vercel/next.js/security/advisories/GHSA-m99w-x7hq-7vfj) | >=13.0.0 <15.5.21 | 15.5.21 | Relevant: Clerk's invalidateCacheAction appears in the generated Server Action manifest even though application source defines no own Server Actions |
| [GHSA-89xv-2m56-2m9x — custom-server Server Action SSRF](https://github.com/vercel/next.js/security/advisories/GHSA-89xv-2m56-2m9x) | >=14.1.1 <15.5.21 | 15.5.21 | Custom-server precondition absent: current startup uses next start; advisory identifies built-in origin pinning from 14.2 onward |
| [GHSA-p9j2-gv94-2wf4 — dynamic destination hostname SSRF](https://github.com/vercel/next.js/security/advisories/GHSA-p9j2-gv94-2wf4) | >=12.0.0 <15.5.21 | 15.5.21 | No external rewrites/redirect rules with request-controlled hostname found |

15.5.21 is the lowest stable version covering all eight, including the applicable Server Action issue. No patched 14.x satisfies those ranges. No jump to 16 was made. Applicability is source/configuration assessment, not an exploit demonstration.

## Compatibility and final changes

- [Next 15 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-15): request params become asynchronous. Production compilation reproduced the old params type failure. Only five locale route components were adapted to await params and use Next's generated string parameter contract. Existing Locale typing is retained after middleware's locale selection.
- Clerk 5.7.6 peer metadata accepts `^13.5.4 || ^14.0.3 || >=15.0.0-rc`. Its synchronous request API use relies on Next 15's compatibility support. The actual build and signed-out route tests work; authenticated end-to-end compatibility remains unverified.
- Current middleware and its synchronous `auth().protect()` call are hash-identical to the beginning of this pass. The response-return fix, locale rules, unauthenticatedUrl, and onboarding guard/draft files remain intact.
- Clerk 6.0.0 was tried because it natively supports async Next request APIs. The documented async middleware and dynamic provider adaptations compiled, but did not resolve the cookie handshake issue. The experiment and every associated source/dependency change were removed; no Clerk 6 changes remain.
- React/React DOM 18.3.1 satisfy the selected Next peer range and are unchanged. Node 24 satisfies Next's engine range.
- pnpm 9.7.0, Turborepo, workspace configuration and transpilePackages configuration are unchanged. Existing ESLint config 14.2.5 still passes; upgrading it would move excluded tooling dependencies, so it was preserved.
- Next's required own dependencies changed: @next/env 14.2.35 -> 15.5.21, @next/swc platform packages 14.2.33 -> 15.5.21, @swc/helpers 0.5.5 -> 0.5.15, styled-jsx 5.1.1 -> 5.1.6. Next now brings optional sharp 0.34.5 and its platform/libvips dependencies. Obsolete Next-only child entries were pruned. No unrelated dependency cluster was upgraded.
- PostCSS remains 8.4.31 under Next, and all pre-existing PostCSS/glob/minimatch/picomatch/tmp package entries are unchanged. No override was added for them.

## Verification results

| Check | Final result |
| --- | --- |
| Frontend lint | PASS; no lint errors/warnings, but CLI deprecation notice |
| Frontend `tsc --noEmit --incremental false` after build | PASS |
| Frontend production build | PASS; 45 static pages generated |
| Backend production build | PASS |
| New routing/prerequisite tests | PASS, 32 tests |
| Browser destination/status/locale checks | PASS for 29 route visits |
| Browser JS/hydration errors and failed HTTP resources | None observed in those 29 visits |
| Signed-out onboarding/dashboard/admin protection | Correct localized sign-in destination in both languages |
| No repeated redirect chains | FAIL: fresh `/` visit had 11 navigation entries including three Clerk handshakes |
| Overall browser/auth release gate | FAIL due to cold-session redirects |
| Live authenticated onboarding/route guard session | NOT RUN; no test login/session was supplied or created |
| Simulated authenticated middleware continuation | PASS for all five onboarding routes in both languages |

The browser visits `/`, `/pricing`, `/curricula`, `/sign-in`, `/sign-up`, plus localized public paths and profile/curriculum/grade-subjects/diagnostic/plan-ready onboarding paths for ar and en, and dashboard/admin for each. Protected pages were tested signed out, so this does not claim their authenticated interiors rendered. Locale-less paths default to Arabic; unit tests separately verify English-cookie routing. No 401 response loop occurred in recorded requests. The cold session does have a repeated 307 handshake sequence, and is deliberately reported as failure even though it eventually reaches HTTP 200.

No checked-in frontend/browser test suite was found before this pass. Added repeatable Node unit tests and a browser smoke runner using the already installed Playwright runtime; no browser-test package was added to the workspace. Initial checks against the stale port-3000 process had asset errors while the build changed; those are not used as final-version results. Final checks used the rebuilt production server on port 3001. The verified existing frontend process on port 3000 was subsequently restarted in its original `next start` mode to avoid leaving stale assets. No deployment/runtime config was edited.

## Clerk cold-session finding

Chrome CDP reports `SameSiteNoneInsecure` rejection for handshake cookies, including __clerk_db_jwt. The observed response sets `SameSite=None` without `Secure` over local HTTP. The server then reports dev-browser-missing and repeats the handshake. Cookie values were not saved; diagnostic evidence contains only names and rejection reasons.

This occurs with both tested Clerk 5.7.6 and 6.0.0 on Next 15. It is not demonstrated to be a new Next regression, nor was a working pre-upgrade cold-session baseline captured. It is nevertheless an unresolved acceptance failure. Production-origin/HTTPS/development-credential configuration is outside this dependency-only pass. No keys, cookie policies, middleware bypasses, or environment settings were changed to suppress it. A configured test session and suitable deployment/test origin are needed for final live authenticated acceptance.

## Final audit and next cluster

Audit HIGH 19 -> 12; moderate 23 -> 12; low 6 -> 4; critical 0 -> 0. There are zero Next.js advisory records after the change. The net HIGH decrease is seven rather than eight because Next 15 adds optional sharp 0.34.5, flagged by [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj), concerning inherited libvips image-processing vulnerabilities. Do not interpret removal of Next records as a clean dependency tree.

| Remaining HIGH root dependency | Affected-version findings |
| --- | ---: |
| glob (lint/Nest CLI) | 2 |
| minimatch (frontend lint) | 3 |
| picomatch (Nest CLI) | 1 |
| tmp (Nest CLI/editor) | 1 |
| @clerk/clerk-react (Clerk) | 1 |
| js-cookie (Clerk shared) | 1 |
| postcss (Next dependency) | 2 |
| sharp/libvips (new optional Next dependency) | 1 |

Recommend the Sharp/libvips cluster next because it is newly introduced on the Next runtime image-processing path. The advisory's minimum package patch is 0.35.0, outside Next's ^0.34.3 optional range; verify compatibility before an override. No Sharp remediation was performed.

New final warnings: next lint is deprecated for removal in Next 16; Clerk logs a repeated-session-refresh warning on cold HTTP sessions; the new Sharp advisory above. The development-key browser warning, deprecated old Clerk packages/ESLint tools, and Node DEP0169 pnpm notice are pre-existing. An Edge MessageEvent warning appeared during the discarded Clerk 6 experiment only and is not in the final build.

## Exact final files changed/added

- apps/frontend/package.json
- pnpm-lock.yaml
- apps/frontend/next-env.d.ts (Next-generated route-type reference)
- apps/frontend/app/[locale]/layout.tsx
- apps/frontend/app/[locale]/page.tsx
- apps/frontend/app/[locale]/pricing/page.tsx
- apps/frontend/app/[locale]/curricula/page.tsx
- apps/frontend/app/[locale]/for-parents/page.tsx
- apps/frontend/tests/auth-routing.cjs (new)
- apps/frontend/tests/browser-smoke.cjs (new)
- docs/dependency-audit-next-after-2026-09-08.json (new)
- docs/next-browser-smoke-2026-09-08.json (new)
- docs/next-clerk-cookie-diagnostic-2026-09-08.json (new)
- docs/next-remediation-2026-09-08.md (new)
- docs/backend-behavior-followups.md (new, separate Multer issue record)

Original reports, earlier Multer work, all existing auth/onboarding fixes, and backend sources are preserved. No migrations, roles, payments, AI, infrastructure configuration, or real user data was changed.

Reproduction: run `node --test apps/frontend/tests/auth-routing.cjs`. For browser tests, set PLAYWRIGHT_MODULE to an existing Playwright installation, TEST_BASE_URL to the running frontend, and TEST_REPORT to a new JSON output path, then run `node apps/frontend/tests/browser-smoke.cjs`. It intentionally exits nonzero for excessive redirect chains.

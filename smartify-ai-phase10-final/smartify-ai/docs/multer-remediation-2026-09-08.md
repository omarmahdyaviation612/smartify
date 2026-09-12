# Targeted Multer remediation — 2026-09-08

Multer 2.0.2 -> 2.2.0. No other package version was upgraded. Production launch remains on hold for unrelated findings and previously identified upload gaps.

## Advisory verification

Installed version was resolved through Node createRequire from @nestjs/platform-express, not inferred from the manifest. Nest adapter 10.4.22 directly pins Multer 2.0.2; Multer is transitive for Smartify. A root pnpm override scoped to `@nestjs/platform-express@10.4.22>multer` selects 2.2.0 without upgrading Nest.

| Advisory | Vulnerable stable range | Minimum fixed stable version | Severity |
| --- | --- | --- | --- |
| [GHSA-xf7r-hgr6-v32p: incomplete cleanup](https://github.com/expressjs/multer/security/advisories/GHSA-xf7r-hgr6-v32p) | <2.1.0 | 2.1.0 | High |
| [GHSA-v52c-386h-88mc: resource exhaustion](https://github.com/expressjs/multer/security/advisories/GHSA-v52c-386h-88mc) | <2.1.0 | 2.1.0 | High |
| [GHSA-5528-5vmv-3xc2: uncontrolled recursion](https://github.com/expressjs/multer/security/advisories/GHSA-5528-5vmv-3xc2) | <2.1.1 | 2.1.1 | High |
| [GHSA-72gw-mp4g-v24j: deeply nested fields](https://github.com/expressjs/multer/security/advisories/GHSA-72gw-mp4g-v24j) | >=1.0.0 <2.2.0 | 2.2.0 plus fieldNestingDepth configuration | High |
| [GHSA-3p4h-7m6x-2hcm: aborted-upload cleanup](https://github.com/expressjs/multer/security/advisories/GHSA-3p4h-7m6x-2hcm) | >=2.0.0-alpha.1 <2.2.0 | 2.2.0 | Moderate |

All five affected the installed 2.0.2. The selected version is the minimum stable version covering all five. The nesting protection is opt-in; both upload interceptors now receive fieldNestingDepth: 0 because their subjectId/topicId inputs are flat. A small intersection type supplies this option missing from Nest 10's older typings. No breaking API migration was required.

## Usage and preserved behavior

The only Multer uses are FileInterceptor("file") on POST /admin/curriculum/materials and /admin/curriculum/subject-materials. Both use memory storage and ClerkAuthGuard/RolesGuard. The service reads buffers and persists content/name metadata, not files at client-supplied filesystem paths. Existing controller tests covered binary text rejection, malformed JSON, and valid JSON; the new HTTP suite exercises real multipart parsing and guards.

Pre-existing limitations remain: the frontend posts PDFs to /materials, whose PDF branch passes a file object as subjectId; PDF MIME labels are trusted at controller boundary; 5 MiB text and 25 MiB PDF checks occur after buffering; the legacy PDF branch bypasses those checks. Tests explicitly record these behaviors rather than claiming they are safe or repaired. Accepted PDF tests verify transport/controller dispatch with PDF-labelled bytes, not successful PDF parsing, AI generation, or database persistence. Service, identity-provider, and database boundaries are mocked; no real data was accessed or modified.

## Validation

- Before update: 20 compatibility assertions passed; security nesting assertion failed (HTTP 201), as did the patched-version assertion.
- After update alone: version assertion passed, nesting assertion still failed. Reading Multer code confirmed the required opt-in setting.
- With setting: all 22 new HTTP assertions passed. Coverage includes accepted PDF dispatch, three non-PDF MIME rejections, MIME spoofing characterization, exact and over-limit 25 MiB PDF/5 MiB text payloads, missing file on both routes, missing subject, unexpected file field, absent boundary, truncated multipart, missing/invalid authorization (401), student role (403), POSIX/Windows filename stripping, memory storage, oversized text field rejection, deep nesting rejection, and continued responsiveness.
- Nest 10 does not map the new LIMIT_FIELD_NESTING error to BadRequestException; the rejection follows its generic HTTP 500 path. This only affects newly rejected nested fields. No broader error-handler change was made. The regression assertion verifies rejection and no service invocation, rather than requiring a specific error status.
- Relevant new suite: 22/22 passed; existing three upload tests also pass in full suite.
- Full backend: 16 suites, 105 tests passed.
- Backend lint: pass, zero errors, one pre-existing unused isActive warning.
- Backend `tsc --noEmit --incremental false`: pass.
- Backend production build: pass.
- Frontend production build: pass, 45 static pages generated.
- `git diff --check`: pass.
- No exhaustive leak/abort stress test or live PDF/AI workflow is claimed.

## Dependency scope and audit

Compared the regenerated lockfile against a snapshot of the already-dirty lockfile. Only Multer changed version. Multer 2.2.0 no longer depends on mkdirp, xtend, or object-assign; orphan mkdirp 0.5.6 and xtend 4.0.2 entries disappeared, while object-assign remains for other dependencies. These are dependency removals caused by Multer itself, not unrelated upgrades. Frozen-lockfile installation skipped lifecycle scripts.

Audit before -> after: critical 0 -> 0; high 23 -> 19; moderate 24 -> 23; low 6 -> 6. No Multer advisories remain. Audit exits nonzero because unrelated findings remain.

Remaining HIGH findings grouped by affected-version instances:

| Root/dependency | Count | Root cause |
| --- | ---: | --- |
| next 14.2.35 | 8 | Server Components/Actions DoS, SSRF and conditional middleware bypass advisories |
| @clerk/clerk-react 5.12.0 | 1 | Combined authorization checks; transitive through Clerk Next integration |
| js-cookie 3.0.5 | 1 | Cookie-attribute/prototype issue under Clerk shared dependency |
| postcss 8.4.31 | 2 | Source-map file disclosure under Next.js |
| glob 10.3.10 and 10.4.5 | 2 | CLI command injection in frontend lint/backend CLI dependencies |
| minimatch 9.0.3 | 3 | ReDoS in frontend lint dependency tree |
| picomatch 4.0.1 | 1 | ReDoS in Nest CLI dependency tree |
| tmp 0.0.33 | 1 | Temporary-path traversal in Nest CLI/editor dependency tree |

There are 18 unique remaining HIGH advisory records and 19 affected-version instances because glob occurs at two versions. These are audit matches, not proof every exploit precondition exists in Smartify.

Recommend Next.js runtime advisories next, starting with a compatibility/exposure review of Next 14.2.35 and Clerk 5.7.6, followed by a narrowly scoped supported-version plan. This pass did not fix that issue.

## Exact files changed in this pass

- package.json: scoped override.
- pnpm-lock.yaml: Multer resolution and obsolete child entries only, preserving prior changes.
- apps/backend/src/admin/curriculum/admin-curriculum.controller.ts: import options and pass them to both existing interceptors; preserve all prior logic.
- apps/backend/src/admin/curriculum/upload-options.ts: new required nesting-limit configuration.
- apps/backend/src/admin/curriculum/upload-http.spec.ts: new isolated HTTP regression suite.
- docs/dependency-audit-multer-after-2026-09-08.json: new raw audit evidence.
- docs/multer-remediation-2026-09-08.md: this report.

Eleven of the thirteen pre-existing modified files remain byte-identical to the takeover snapshot. The controller and lockfile received only the scoped changes described above; no pre-existing changes were reverted. Both original audit/report files are hash-verified unchanged. No migrations, environment validation, payments, AI, infrastructure, or real data were changed.

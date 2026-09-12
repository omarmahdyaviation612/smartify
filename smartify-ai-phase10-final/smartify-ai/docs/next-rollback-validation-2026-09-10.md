# Controlled Next.js rollback — 2026-09-10

Status: dependency rollback and noninteractive validation complete; real HTTPS auth regression awaiting manual development-account login.

- Next.js 15.5.21 -> 14.2.35 (exact pin).
- Clerk retained at installed 5.7.6; no internals or auth application logic changed.
- Sharp removed from resolved lockfile: introduced as Next 15 optional dependency and no other importer requires it.
- pnpm offline frozen-lockfile install with scripts disabled: PASS; resolution skipped.
- Frontend lint PASS; typecheck PASS after removing stale Next 15 generated types; production build PASS (45 static pages); backend build PASS; routing/guard tests 32/32 PASS.
- Isolated real HTTPS POST of Clerk invalidateCacheAction on new build: HTTP 200, no RSC error records, no digest 4175692332. Real sign-in/logout verification remains pending, so stable baseline is not yet formally confirmed.
- Current audit HIGH 16 -> 22, rather than the historical 12 -> 19. Current advisory feed adds findings not present in historical reports. No additional remediation attempted. Audit also reports 2 critical findings both before and after; preserved in raw reports.
- Remaining HIGH findings grouped by installed dependency finding: next 8; glob 2; minimatch 3; picomatch 1; @clerk/clerk-react 1; js-cookie 1; tmp 1; postcss 2; multer 3. Total 22. Next rollback reintroduces 8 HIGH findings; Sharp removal eliminates 2.

Changed existing files relative to the recorded pre-rollback hashes: apps/frontend/package.json, pnpm-lock.yaml, apps/frontend/next-env.d.ts (Next-generated declaration restored for Next 14). All other recorded source/test/report hashes preserved. New reports: next-rollback-before-2026-09-10.json; dependency-audit-rollback-before-2026-09-10.json; dependency-audit-rollback-after-2026-09-10.json; next-rollback-validation-2026-09-10.md. Browser tooling generates .playwright-cli diagnostics. Old generated Next 15 build backup removed after clean Next 14 build succeeded. No real application data modified; no CORS, infrastructure or other dependency remediation.

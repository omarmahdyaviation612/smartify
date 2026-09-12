# Clerk HTTPS decision — 2026-09-09

Next.js 15.5.21 and Clerk 5.7.6 remain unchanged. No application source, configuration, dependency or real application data was changed by this investigation.

## Results

- Real manual Google sign-in: PASS. Returned to https://localhost:3443/ar/free-trial; Clerk loaded and session present.
- Previous repeating redirect: PASS under trusted HTTPS. No SameSiteNoneInsecure rejections in this authenticated capture. Prior HTTP control demonstrates SameSite=None without Secure on __client_uat, __session and __clerk_db_jwt; Chrome rejected them and repeated the development handshake. HTTPS control sets Secure and ends the repetition. This specific loop is a LOCAL HTTP TEST ENVIRONMENT LIMITATION.
- Authenticated navigation: PASS for Arabic and English onboarding/profile (HTTP 200, expected headings, session present), Arabic dashboard (HTTP 200 and session present), and post-login free-trial. Dashboard API content remains blocked by CORS.
- Logout session revocation: PASS. Clerk session absent after logout.
- Signed-out protection: PASS. Arabic/English onboarding/profile and Arabic dashboard redirect to locale-correct sign-in.
- Runtime-clean auth lifecycle: FAIL. During logout from Arabic dashboard, browser reports a Server Components render error. Server logs confirm: Only plain objects, and a few built-ins, can be passed to Client Components from Server Components. Classes or null prototypes are not supported. Digest 4175692332. This also occurred during the earlier HTTPS logout test. No source or dependency modification attempted.

## Exact fetch failure

GET http://localhost:4000/dashboard/summary causes free-trial's Failed to fetch. Navbar additionally requests GET http://localhost:4000/users/me and fails identically. Frontend origin is https://localhost:3443; backend origin is http://localhost:4000. Client attaches Authorization: Bearer (value not recorded) and Content-Type: application/json; no cross-origin cookies. Browser sends OPTIONS preflight. Backend responds 204 with Access-Control-Allow-Origin: http://localhost:3000, Access-Control-Allow-Headers: authorization,content-type and Access-Control-Allow-Credentials: true. Chrome records net::ERR_FAILED with corsErrorStatus.corsError=PreflightAllowOriginMismatch and failedParameter=http://localhost:3000. Actual authenticated GET is blocked by the preflight. Backend is reachable. This is confirmed CORS configuration mismatch, not an observed mixed-content, TLS/certificate or authentication rejection. HTTPS page successfully loads with normal certificate validation. No HTTP backend TLS handshake is involved.

Fix requires aligning the local backend FRONTEND_URL/CORS setting with the HTTPS frontend origin (or a deliberately configured same-origin local API proxy). No source change is inherently required for the existing single-origin CORS configuration. Not applied in this pass. Temporary frontend proxy also produces return URLs with the upstream port 3000 on protected-route redirects; explicit 3443 post-login return was used. That local proxy-origin mismatch is separately recorded in the HTTPS control report.

## Decision

REVERT recommendation for acceptance of this candidate, because the required runtime-clean logout gate fails. This is not a claim that Next.js caused the serialization error: its exact originating object/component is still unisolated, and a framework regression has not been proven. Do not execute a downgrade to the known-vulnerable previous version as a production fix. No version was changed. Retain Clerk 5.7.6 during diagnosis; there is no evidence here justifying a Clerk upgrade. Sharp remains on hold. The remaining blocker is isolating the logout-time RSC serialization error before formally accepting the Next.js candidate. The user's A/B framing applies conclusively to the original cookie loop (A), but cannot exclude this separate runtime issue.

## Evidence and changed files in resumed test

- docs/clerk-final-https-evidence-2026-09-09.json (new, sanitized metadata; no token values)
- docs/clerk-https-decision-2026-09-09.md (this report)
- Tool-generated .playwright-cli diagnostic artifacts and temporary test scripts outside application source.

Earlier HTTP/HTTPS reports and all existing modifications were preserved. Local production frontend and trusted HTTPS proxy were restarted; no settings changed. User test session was signed out as requested after its failed request had been inspected.

# Logout serialization root cause — 2026-09-09

## Confirmed root cause

Clerk 5.7.6 ClientClerkProvider installs window.__unstable__onBeforeSetActive. Auth transitions invoke this hook, which starts invalidateCacheAction(). That server action returns cookies().delete(`__clerk_invalidate_cache_cookie_${Date.now()}`).

Next 14.2.35 MutableRequestCookiesAdapter.wrap().delete() returns undefined. Next 15.5.21 returns the wrapped ResponseCookies instance. An async server action therefore resolves with a class/proxy object under Next 15. React Server Components cannot serialize that return value. The production response carries digest 4175692332 even though the POST status is 200. This is action-return serialization, not session data serialization or a page component receiving a user object.

The action ID 7fe4f059b50fe4fbdbad430c8f9c9f33437d773a6d is registered throughout the current production server-reference manifest. Isolated invocation while already signed out reproduced the same digest; no currentUser(), signed-in user data, redirect destination, backend call or CORS response is needed. Six direct browser action requests across /en/sign-in, /ar and /en/pricing, on HTTP 3000 and trusted HTTPS 3443, all reproduced it. The actual provider hook after a full page navigation to sign-in also reproduced it. Previous actual auth runs captured it during logout from dashboard and onboarding. No fresh actual sign-in was required for this isolation. A complete new authenticated route-by-route logout matrix was not performed; action isolation demonstrates that the failing operation itself is route/protocol independent.

## Exact code path

- apps/frontend/components/Navbar.tsx:58 calls Clerk signOut({ redirectUrl: base }); this is a client component and does not return server data.
- apps/frontend/app/layout.tsx wraps children in ClerkProvider.
- apps/frontend/node_modules/@clerk/nextjs/dist/esm/app-router/client/ClerkProvider.js: __unstable__onBeforeSetActive -> invalidateCacheAction().
- apps/frontend/node_modules/@clerk/nextjs/dist/esm/app-router/server-actions.js: invalidateCacheAction, line 4 returns cookies().delete(...).
- apps/frontend/node_modules/next/dist/server/web/spec-extension/adapters/request-cookies.js: MutableRequestCookiesAdapter.wrap / createCookiesWithMutableAccessCheck return wrappedCookies after delete.
- Next production RSC serializer rejects that object. Inspector stack: app-page.runtime.prod.js:5:44265 (eN), :5:48328 (ez), :5:49036 (eW), :5:35936, then microtask processing. Full captured stack is in the evidence JSON.

## Attribution and comparison

Confirmed Next-version-dependent incompatibility with this Clerk SDK: the changed Next cookie API return exposes Clerk's unsafe server-action return. It is not a Smartify application bug. Existing locally installed 14.2.35 and 15.5.21 modules were exercised against empty in-memory cookie stores to confirm undefined versus non-plain ResponseCookies. No package resolution, lockfile or installed version was changed. This was a targeted module comparison, not an entire application run on Next 14. No evidence supports blaming stale auth state, cache contents, HTTP cookies, currentUser() or the already-understood CORS mismatch.

## Disposition

No fix applied. The narrow dependency-level correction would discard the cookie mutation return (and use the appropriate awaited cookies API); it has not been applied or claimed tested as a logout fix. Upgrading Clerk is prohibited, and the instruction authorizes an application fix only if the cause is application code. No internal-hook override, swallowed error, cookie-security change or node_modules patch was introduced.

Final decision for the unchanged Next 15.5.21 + Clerk 5.7.6 pair: REVERT recommendation, not an executed downgrade. The runtime-clean logout requirement remains FAIL. Signed-out protection previously passed and remains independent of this return-value error. This does not establish that Next 15 must be abandoned in every configuration: a reviewed SDK compatibility correction could retain Next 15, but that is outside the authorized application-only fix condition and has not been validated. Do not deploy a downgrade to the previously vulnerable Next version as a security remediation.

Only new repository files in this turn are this report and clerk-logout-root-cause-evidence-2026-09-09.json, plus tool-generated browser diagnostics. Application source, manifests, lockfile, environment files and prior reports were unchanged. A temporary unchanged-build server with loopback inspector was used to capture the stack, then stopped. No application data was modified. CORS and Sharp were untouched.

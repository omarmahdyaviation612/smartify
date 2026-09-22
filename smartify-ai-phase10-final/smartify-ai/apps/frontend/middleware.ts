import { NextResponse } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";

const SUPPORTED_LOCALES = ["ar", "en"] as const;
type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
const DEFAULT_LOCALE: SupportedLocale = "ar"; // Arabic-first, per product requirement
const LOCALE_COOKIE = "sf_locale";

// Path suffixes (locale stripped) that don't require sign-in.
const PUBLIC_SUFFIXES = ["/", "/pricing", "/curricula", "/for-parents", "/privacy", "/terms"];
const PUBLIC_PREFIXES = ["/sign-in", "/sign-up"];

// Clerk Frontend API manual reverse-proxy (legacy/manual mechanism — the
// built-in `frontendApiProxy` middleware option requires Clerk Core 3 /
// @clerk/nextjs v7+ and Next.js 15+, neither of which this app runs).
// Lets ClerkJS talk to Clerk through our own production domain
// (https://smartify-ai.com/__clerk) instead of the separate
// clerk.smartify-ai.com subdomain, whose own SSL certificate is stuck.
// `https://frontend-api.clerk.dev` is Clerk's own documented, shared
// Frontend API entry point for this exact proxy pattern — the same for
// every Clerk account, not something specific to this project, so it's a
// fixed constant rather than an env var. See:
// https://clerk.com/docs/guides/dashboard/dns-domains/proxy-fapi
const CLERK_PROXY_PATH = "/__clerk";
const CLERK_FRONTEND_API_UPSTREAM = "https://frontend-api.clerk.dev";

function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function isPublicPath(pathWithoutLocale: string): boolean {
  if (PUBLIC_SUFFIXES.includes(pathWithoutLocale)) return true;
  return PUBLIC_PREFIXES.some((p) => pathWithoutLocale === p || pathWithoutLocale.startsWith(`${p}/`));
}

export default clerkMiddleware(
  (auth, req) => {
    const { pathname } = req.nextUrl;

    // Clerk Frontend API proxy traffic — handled BEFORE anything else so
    // locale redirects, auth().protect(), and the /api/ + /webhooks/ bypass
    // below can never intercept or alter it. Never requires sign-in.
    if (pathname === CLERK_PROXY_PATH || pathname.startsWith(`${CLERK_PROXY_PATH}/`)) {
      const upstreamPath = pathname.slice(CLERK_PROXY_PATH.length) || "/";
      const upstreamUrl = new URL(upstreamPath + req.nextUrl.search, CLERK_FRONTEND_API_UPSTREAM);

      const proxyUrl = process.env.NEXT_PUBLIC_CLERK_PROXY_URL || `${req.nextUrl.origin}${CLERK_PROXY_PATH}`;
      const headers = new Headers(req.headers);
      headers.set("Clerk-Proxy-Url", proxyUrl);
      if (process.env.CLERK_SECRET_KEY) headers.set("Clerk-Secret-Key", process.env.CLERK_SECRET_KEY);
      // Preserve an existing chain (its leftmost value is already the real
      // client); only fall back to req.ip when no chain exists at all.
      if (!headers.has("x-forwarded-for") && req.ip) headers.set("x-forwarded-for", req.ip);

      return NextResponse.rewrite(upstreamUrl, { request: { headers } });
    }

    const segments = pathname.split("/").filter(Boolean);
    const firstSegment = segments[0];

    // Webhooks and other API routes bypass locale routing entirely.
    if (pathname.startsWith("/api/") || pathname.startsWith("/webhooks/")) {
      return NextResponse.next();
    }

    // Let Clerk return its authentication headers and redirects to Next.js.
    if (firstSegment && isSupportedLocale(firstSegment)) {
      const withoutLocale = "/" + segments.slice(1).join("/");
      if (!isPublicPath(withoutLocale)) {
        const signInUrl = new URL(`/${firstSegment}/sign-in`, req.url);
        signInUrl.searchParams.set("redirect_url", req.url);
        auth().protect({ unauthenticatedUrl: signInUrl.toString() });
      }
      const response = NextResponse.next();
      response.cookies.set(LOCALE_COOKIE, firstSegment, { maxAge: 60 * 60 * 24 * 365, path: "/" });
      return response;
    }

    // No locale in the URL: prefer a previously-persisted choice, otherwise
    // default to Arabic. Deliberately NOT using Accept-Language — the user
    // must have explicit, predictable control over the interface language.
    const cookieLocale = req.cookies.get(LOCALE_COOKIE)?.value;
    const targetLocale = cookieLocale && isSupportedLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;

    const url = req.nextUrl.clone();
    url.pathname = `/${targetLocale}${pathname === "/" ? "" : pathname}`;
    return NextResponse.redirect(url);
  },
  // Tells Clerk's own auth/handshake flow (auth().protect(), redirects,
  // etc.) that the app is served behind the /__clerk reverse proxy above,
  // so it computes correct URLs — same env var ClerkProvider uses below.
  { proxyUrl: process.env.NEXT_PUBLIC_CLERK_PROXY_URL },
);

export const config = {
  // Existing matcher preserved as-is. /__clerk/(.*) is listed explicitly
  // in addition to it, per Clerk's proxy setup requirement — the broad
  // pattern above already covers most /__clerk requests, but its
  // static-file exclusion (`.*\\..*`) would skip any proxied asset path
  // that happens to contain a dot (e.g. a versioned script URL).
  matcher: ["/((?!_next|.*\\..*).*)", "/__clerk/(.*)"],
};

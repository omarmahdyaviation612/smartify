import { NextRequest, NextResponse } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";

const SUPPORTED_LOCALES = ["ar", "en"] as const;
type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
const DEFAULT_LOCALE: SupportedLocale = "ar"; // Arabic-first, per product requirement
const LOCALE_COOKIE = "sf_locale";

// Path suffixes (locale stripped) that don't require sign-in.
const PUBLIC_SUFFIXES = ["/", "/pricing", "/curricula", "/for-parents"];
const PUBLIC_PREFIXES = ["/sign-in", "/sign-up"];

function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function isPublicPath(pathWithoutLocale: string): boolean {
  if (PUBLIC_SUFFIXES.includes(pathWithoutLocale)) return true;
  return PUBLIC_PREFIXES.some((p) => pathWithoutLocale.startsWith(p));
}

const authMiddleware = clerkMiddleware((auth, req) => {
  const { pathname } = req.nextUrl;
  const segments = pathname.split("/").filter(Boolean);
  const withoutLocale = "/" + segments.slice(1).join("/");
  const normalized = withoutLocale === "/" ? "/" : withoutLocale.replace(/\/$/, "");

  if (!isPublicPath(normalized || "/")) {
    auth().protect();
  }
});

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const segments = pathname.split("/").filter(Boolean);
  const firstSegment = segments[0];

  // Webhooks and other API routes bypass locale routing entirely.
  if (pathname.startsWith("/api/") || pathname.startsWith("/webhooks/")) {
    return NextResponse.next();
  }

  // Already locale-prefixed: persist the choice, then hand off to Clerk auth gating.
  // NOTE: clerkMiddleware's callback form is designed to be the top-level
  // export; composing it inline like this is a pragmatic MVP wiring and
  // should be revisited if Clerk's API for composition changes.
  if (firstSegment && isSupportedLocale(firstSegment)) {
    const res = (authMiddleware as any)(req);
    const response = res instanceof NextResponse ? res : NextResponse.next();
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
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};

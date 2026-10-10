"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useCurrentUser } from "@/lib/use-current-user";
import { useApiClient } from "@/lib/api-client";
import { rememberOnboardingNext } from "@/lib/onboarding-draft";
import type { Locale } from "@/content/marketing";

const PUBLIC_ROUTES = new Set(["/", "/pricing", "/curricula", "/for-parents", "/privacy", "/terms"]);

// Routes a signed-in student without a profile may stay on. Everything else
// (home, dashboard, free trial, billing...) sends them into onboarding.
const ONBOARDING_EXEMPT_ROUTES = new Set(["/pricing", "/curricula", "/for-parents", "/privacy", "/terms", "/welcome"]);
const ONBOARDING_EXEMPT_PREFIXES = ["/onboarding", "/sign-in", "/sign-up", "/parent", "/admin"];

function isPrefixed(suffix: string, prefixes: string[]) {
  return prefixes.some((p) => suffix === p || suffix.startsWith(`${p}/`));
}

/**
 * Keeps parent accounts in the parent portal across student-only routes,
 * and (onboarding drop-off fix, 2026-10-11) forwards signed-in students who
 * never finished onboarding into it instead of letting them land on pages
 * that only work with a profile.
 */
export function ParentRouteGuard({ locale, children }: { locale: Locale; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { apiFetch } = useApiClient();
  const { user, loading } = useCurrentUser();
  const [checkingProfile, setCheckingProfile] = useState(false);
  const suffix = pathname.startsWith(`/${locale}`) ? pathname.slice(locale.length + 1) || "/" : pathname;
  const isParentRoute = suffix === "/parent" || suffix.startsWith("/parent/");
  const isAuthRoute = suffix === "/sign-in" || suffix.startsWith("/sign-in/") || suffix === "/sign-up" || suffix.startsWith("/sign-up/");
  const blocked = !loading && user?.role === "PARENT" && !isParentRoute && !isAuthRoute && !PUBLIC_ROUTES.has(suffix);

  const needsOnboarding =
    !loading &&
    user?.role === "STUDENT" &&
    user.hasStudentProfile === false &&
    !ONBOARDING_EXEMPT_ROUTES.has(suffix) &&
    !isPrefixed(suffix, ONBOARDING_EXEMPT_PREFIXES);

  useEffect(() => {
    if (blocked) router.replace(`/${locale}/parent`);
  }, [blocked, locale, router]);

  useEffect(() => {
    if (!needsOnboarding) return;
    // The cached user can be stale once the student finishes onboarding in
    // this same tab (the layout never remounts), so re-check before moving.
    let cancelled = false;
    setCheckingProfile(true);
    apiFetch<{ role: string; hasStudentProfile?: boolean }>("/users/me")
      .then((me) => {
        if (cancelled) return;
        if (me?.role === "STUDENT" && me.hasStudentProfile === false) {
          if (suffix !== "/") rememberOnboardingNext(suffix);
          router.replace(`/${locale}/onboarding/profile`);
        } else {
          setCheckingProfile(false);
        }
      })
      .catch(() => {
        if (!cancelled) setCheckingProfile(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsOnboarding, suffix, locale]);

  if (blocked) return <div className="p-6 text-center text-neutral-600" role="status">{locale === "ar" ? "جارٍ فتح لوحة ولي الأمر..." : "Opening the parent dashboard..."}</div>;
  if (needsOnboarding && checkingProfile && suffix !== "/") {
    return <div className="p-6 text-center text-neutral-600" role="status">{locale === "ar" ? "جارٍ إكمال إعداد حسابك..." : "Finishing your account setup..."}</div>;
  }
  return <>{children}</>;
}

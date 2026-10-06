"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useCurrentUser } from "@/lib/use-current-user";
import type { Locale } from "@/content/marketing";

const PUBLIC_ROUTES = new Set(["/", "/pricing", "/curricula", "/for-parents", "/privacy", "/terms"]);

/** Keep parent accounts in the parent portal across student-only routes. */
export function ParentRouteGuard({ locale, children }: { locale: Locale; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useCurrentUser();
  const suffix = pathname.startsWith(`/${locale}`) ? pathname.slice(locale.length + 1) || "/" : pathname;
  const isParentRoute = suffix === "/parent" || suffix.startsWith("/parent/");
  const isAuthRoute = suffix === "/sign-in" || suffix.startsWith("/sign-in/") || suffix === "/sign-up" || suffix.startsWith("/sign-up/");
  const blocked = !loading && user?.role === "PARENT" && !isParentRoute && !isAuthRoute && !PUBLIC_ROUTES.has(suffix);

  useEffect(() => {
    if (blocked) router.replace(`/${locale}/parent`);
  }, [blocked, locale, router]);

  if (blocked) return <div className="p-6 text-center text-neutral-600" role="status">{locale === "ar" ? "جارٍ فتح لوحة ولي الأمر..." : "Opening the parent dashboard..."}</div>;
  return <>{children}</>;
}

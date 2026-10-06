"use client";

import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import type { Locale } from "@/content/marketing";
import { useCurrentUser } from "@/lib/use-current-user";

export function StudentDashboardShortcut({ locale }: { locale: Locale }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { user, loading } = useCurrentUser();

  if (!isLoaded || !isSignedIn || loading || user?.role !== "STUDENT") return null;

  return (
    <Link
      href={`/${locale}/dashboard`}
      aria-label={locale === "ar" ? "الذهاب إلى لوحة التحكم" : "Go to dashboard"}
      className="fixed bottom-4 end-4 z-50 inline-flex min-h-12 items-center justify-center rounded-full bg-sf-purple-600 px-5 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-sf-purple-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-purple-600"
    >
      {locale === "ar" ? "لوحة التحكم" : "Dashboard"}
    </Link>
  );
}

"use client";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { useCurrentUser } from "@/lib/use-current-user";
export function StudentSupportShortcut({ locale }: { locale: string }) {
  const { isLoaded, isSignedIn } = useAuth(); const { user, loading } = useCurrentUser();
  if (!isLoaded || !isSignedIn || loading || user?.role !== "STUDENT") return null;
  return <Link href={`/${locale}/support`} className="fixed bottom-4 start-4 z-50 inline-flex min-h-12 items-center justify-center rounded-full border border-sf-purple-600 bg-white px-5 text-sm font-semibold text-sf-purple-600 shadow-lg hover:bg-purple-50">{locale === "ar" ? "الدعم الفني" : "Technical support"}</Link>;
}

"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

export function AdminDashboardLink() {
  const { locale } = useParams<{ locale: string }>();
  return (
    <Link
      href={`/${locale}/admin`}
      className="fixed left-4 top-4 z-40 rounded-full bg-violet-700 px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-violet-800"
      aria-label={locale === "ar" ? "العودة إلى لوحة الإدارة" : "Return to admin dashboard"}
    >
      {locale === "ar" ? "لوحة الإدارة" : "Admin dashboard"}
    </Link>
  );
}

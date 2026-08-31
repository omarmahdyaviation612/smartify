"use client";

import { usePathname, useRouter } from "next/navigation";
import type { Locale } from "@/content/marketing";

const LABELS: Record<Locale, string> = { ar: "العربية", en: "English" };

/** Swaps the locale segment of the current path and persists the choice via the sf_locale cookie (set by middleware on navigation). */
export function LanguageSwitcher({ currentLocale }: { currentLocale: Locale }) {
  const router = useRouter();
  const pathname = usePathname();
  const other: Locale = currentLocale === "ar" ? "en" : "ar";

  function switchTo(locale: Locale) {
    const segments = pathname.split("/").filter(Boolean);
    segments[0] = locale;
    router.push("/" + segments.join("/"));
  }

  return (
    <div className="flex items-center gap-1 rounded-full border border-neutral-200 p-1 text-sm">
      {(["ar", "en"] as Locale[]).map((locale) => (
        <button
          key={locale}
          onClick={() => switchTo(locale)}
          aria-current={locale === currentLocale}
          className={`rounded-full px-3 py-1 transition-colors ${
            locale === currentLocale ? "bg-navy-900 text-white" : "text-neutral-600 hover:bg-neutral-100"
          }`}
        >
          {LABELS[locale]}
        </button>
      ))}
    </div>
  );
}

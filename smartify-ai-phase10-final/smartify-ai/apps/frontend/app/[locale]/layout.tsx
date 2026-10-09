import type { ReactNode } from "react";
import type { Locale } from "@/content/marketing";
import { StudentDashboardShortcut } from "@/components/StudentDashboardShortcut";
import { ParentRouteGuard } from "@/components/ParentRouteGuard";
import { StudentSupportShortcut } from "@/components/StudentSupportShortcut";

export function generateStaticParams() {
  return [{ locale: "ar" }, { locale: "en" }];
}

const DIR_BY_LOCALE: Record<Locale, "rtl" | "ltr"> = { ar: "rtl", en: "ltr" };
const FONT_CLASS_BY_LOCALE: Record<Locale, string> = { ar: "font-arabic", en: "font-sans" };

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const locale = (await params).locale as Locale;
  const dir = DIR_BY_LOCALE[locale] ?? "rtl";
  const fontClass = FONT_CLASS_BY_LOCALE[locale] ?? "font-arabic";

  return (
    <html lang={locale} dir={dir}>
      <body className={`${fontClass} bg-[--sf-bg-page] text-[--sf-text-primary] antialiased`}>
        <ParentRouteGuard locale={locale}>{children}</ParentRouteGuard>
        <StudentDashboardShortcut locale={locale} />
        <StudentSupportShortcut locale={locale} />
      </body>
    </html>
  );
}

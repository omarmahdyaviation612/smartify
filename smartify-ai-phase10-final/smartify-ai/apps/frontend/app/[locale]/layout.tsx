import type { ReactNode } from "react";
import type { Locale } from "@/content/marketing";

export function generateStaticParams() {
  return [{ locale: "ar" }, { locale: "en" }];
}

const DIR_BY_LOCALE: Record<Locale, "rtl" | "ltr"> = { ar: "rtl", en: "ltr" };
const FONT_CLASS_BY_LOCALE: Record<Locale, string> = { ar: "font-arabic", en: "font-sans" };

export default function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: { locale: Locale };
}) {
  const dir = DIR_BY_LOCALE[params.locale] ?? "rtl";
  const fontClass = FONT_CLASS_BY_LOCALE[params.locale] ?? "font-arabic";

  return (
    <html lang={params.locale} dir={dir}>
      <body className={`${fontClass} bg-[--sf-bg-page] text-[--sf-text-primary] antialiased`}>
        {children}
      </body>
    </html>
  );
}

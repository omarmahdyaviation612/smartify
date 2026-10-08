import type { Locale } from "@/content/marketing";

/**
 * Picks the locale-appropriate explanation text for a Question. Arabic UI
 * normally falls back to English when Arabic is missing. Arabic-only subjects
 * pass forceArabic so they never leak English explanations in an English UI.
 */
export function getLocalizedExplanation(
  explanationEn: string | null,
  explanationAr: string | null,
  locale: Locale,
  forceArabic = false,
): string | null {
  if ((locale === "ar" || forceArabic) && explanationAr) return explanationAr;
  if (forceArabic) return null;
  return explanationEn;
}

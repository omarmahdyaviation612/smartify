import type { Locale } from "@/content/marketing";

/**
 * Phase 10F.6: picks the locale-appropriate explanation text for a
 * Question. Arabic prefers explanationAr, but falls back to explanationEn
 * when a Question hasn't been given a reviewed Arabic explanation yet —
 * never renders a blank explanation just because explanationAr is null.
 * English behavior is unchanged: always explanationEn.
 */
export function getLocalizedExplanation(
  explanationEn: string | null,
  explanationAr: string | null,
  locale: Locale,
): string | null {
  if (locale === "ar" && explanationAr) return explanationAr;
  return explanationEn;
}

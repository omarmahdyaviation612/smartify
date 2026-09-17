import type { Locale } from "@/content/marketing";

/**
 * Phase 10F.3: the ONLY translation applied here is a fixed, small map for
 * the two canonical TRUE_FALSE values — never generic/automatic
 * translation. This is display-only: the canonical grading value ("True"/
 * "False") stored in Question.optionsJson/correctAnswerJson and submitted
 * as the answer NEVER changes — callers must keep using the raw `option`
 * string for `value`/`checked`/submitted-answer state, and use this
 * function's return value only for the rendered text/label. Every other
 * option string (numbers, equation sentences like "5 + 2 = 7") passes
 * through unchanged in both locales.
 */
const AR_LABELS: Record<string, string> = {
  True: "صحيح",
  False: "خطأ",
};

export function getQuestionOptionLabel(option: string, locale: Locale): string {
  if (locale === "ar" && option in AR_LABELS) return AR_LABELS[option];
  return option;
}

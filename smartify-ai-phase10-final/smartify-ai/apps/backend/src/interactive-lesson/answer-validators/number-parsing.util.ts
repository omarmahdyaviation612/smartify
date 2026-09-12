const ARABIC_INDIC_DIGITS: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
};

export function normalizeDigits(text: string): string {
  return text.replace(/[٠-٩]/g, (digit) => ARABIC_INDIC_DIGITS[digit] ?? digit);
}

/**
 * Extracts the first standalone integer from free-form student text —
 * handles Arabic-Indic digits and surrounding words/punctuation
 * ("الإجابة هي ٧" -> 7). Returns null when no integer is present, so callers
 * can fall back to AI-based classification rather than guessing.
 */
export function parseNumericAnswer(text: string): number | null {
  const match = normalizeDigits(text).match(/-?\d+/);
  if (!match) return null;
  const value = parseInt(match[0], 10);
  return Number.isFinite(value) ? value : null;
}

const YES_WORDS = ["نعم", "ايوه", "أيوه", "ايوة", "أيوة", "اه", "آه", "صح", "yes", "y", "true"];
// "مش" (a generic negation particle, e.g. "مش فاهم" = "I don't understand")
// is deliberately excluded — too ambiguous alone to safely read as "no".
const NO_WORDS = ["لا", "لأ", "غلط", "خطأ", "no", "n", "false"];

/**
 * Extracts a yes/no judgment from free-form student text, for
 * equality-style checks. Returns null when the reply doesn't clearly match
 * a known affirmative/negative word, so callers fall back rather than
 * guessing.
 */
export function parseYesNoAnswer(text: string): boolean | null {
  const normalized = text.trim().toLowerCase().replace(/[؟?.!,]/g, "");
  if (!normalized) return null;
  if (YES_WORDS.some((word) => normalized === word || normalized.startsWith(`${word} `))) return true;
  if (NO_WORDS.some((word) => normalized === word || normalized.startsWith(`${word} `))) return false;
  return null;
}

const GREATER_WORDS = ["أكبر", "اكبر", "bigger", "greater", "more", "larger"];
const LESSER_WORDS = ["أصغر", "اصغر", "أقل", "اقل", "smaller", "less", "lesser"];

/**
 * A "which is bigger/smaller" comparison, in practice, is answered with a
 * comparative word ("أكبر"/"bigger") far more naturally than a bare yes/no —
 * this is what real live QA showed. Falls back to yes/no (still valid for a
 * question literally phrased "is X greater than Y?"), then to null (falls
 * back further to AI classification) rather than guessing.
 */
export function parseComparativeAnswer(text: string, comparator: "greater" | "less"): boolean | null {
  const normalized = text.trim().toLowerCase().replace(/[؟?.!,]/g, "");
  if (!normalized) return null;
  const matchesAny = (words: string[]) => words.some((word) => normalized === word || normalized.startsWith(`${word} `) || normalized.includes(` ${word}`));
  if (matchesAny(GREATER_WORDS)) return comparator === "greater";
  if (matchesAny(LESSER_WORDS)) return comparator === "less";
  return parseYesNoAnswer(text);
}

/**
 * Prepares already-markdown-stripped Arabic text for text-to-speech by
 * adding diacritics (tashkeel) ONLY where they materially fix a real
 * mispronunciation risk: math symbols, small numbers, and a short list of
 * standalone terms this lesson domain repeats constantly. This is
 * deliberately NOT a full-sentence diacritizer — mechanically diacritizing
 * every word (including verb conjugations and grammatical case endings)
 * risks sounding MORE robotic/Modern-Standard-Arabic, the opposite of the
 * "natural Egyptian teacher" goal — so most of the sentence is left exactly
 * as written and only these known trouble spots are touched.
 *
 * This never changes what the student sees (displayText) — it only shapes
 * the derived speechText sent to TTS. Pure/deterministic: the same input
 * always produces the same output, so the existing per-turn audio cache
 * (keyed off displayText, which never changes for an already-generated
 * turn) stays valid with no extra cache-invalidation logic needed.
 */

const ARABIC_SCRIPT_PATTERN = /[؀-ۿ]/;

export function containsArabicScript(text: string): boolean {
  return ARABIC_SCRIPT_PATTERN.test(text);
}

// Standard MSA number words, correctly diacritized — read the same way in
// Egyptian speech for these small quantities, and used throughout this
// Grade-1 addition pilot's checks/examples (sums and operands up to 20).
const NUMBER_WORDS_DIACRITIZED: Record<string, string> = {
  "0": "صِفْر",
  "1": "واحِد",
  "2": "اِثْنان",
  "3": "ثَلاثة",
  "4": "أَرْبَعة",
  "5": "خَمْسة",
  "6": "سِتّة",
  "7": "سَبْعة",
  "8": "ثَمانِية",
  "9": "تِسْعة",
  "10": "عَشَرة",
  "11": "أَحَد عَشَر",
  "12": "اِثْنا عَشَر",
  "13": "ثَلاثة عَشَر",
  "14": "أَرْبَعة عَشَر",
  "15": "خَمْسة عَشَر",
  "16": "سِتّة عَشَر",
  "17": "سَبْعة عَشَر",
  "18": "ثَمانِية عَشَر",
  "19": "تِسْعة عَشَر",
  "20": "عِشْرون",
};

// Common tutor/math vocabulary this pilot repeats constantly, where a
// missing short vowel or shadda changes the word's clarity when read aloud.
// Matched as WHOLE tokens only (see prepareArabicSpeechText) so this never
// corrupts an unrelated word that merely contains the same letters.
// Deliberately noun/particle forms only — verb conjugations ("نجمع",
// "بنجمع", "هنجمع", "جمعنا"...) vary too much by subject/tense for a naive
// whole-token dictionary to cover consistently, and a half-covered verb
// would only diacritize some of its forms, which is worse than none.
const ARABIC_TERM_DIACRITICS: Record<string, string> = {
  "جمع": "جَمْع",
  "الجمع": "الجَمْع",
  "زائد": "زائِد",
  "يساوي": "يُساوي",
  "مجموع": "مَجْموع",
  "علامة": "عَلامة",
  "مجموعة": "مَجْموعة",
  "مجموعتين": "مَجْموعَتين",
};

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

function normalizeDigits(text: string): string {
  return text.replace(/[٠-٩]/g, (digit) => ARABIC_INDIC_DIGITS[digit] ?? digit);
}

function numberWordForDigits(digits: string): string | null {
  const normalized = normalizeDigits(digits);
  if (!/^-?\d+$/.test(normalized)) return null;
  const value = parseInt(normalized, 10);
  const word = NUMBER_WORDS_DIACRITIZED[String(Math.abs(value))];
  if (!word) return null; // outside the small range covered above — leave the digit as-is rather than guess
  return value < 0 ? `سالِب ${word}` : word;
}

// Single-letter Arabic connectors (و "and", ف "so/then", ب "with/by", ل
// "for/to", ك "like/as") commonly attach directly to a following word with
// no space in normal writing — "و3" really is "و" + "3" ("and 3"), not one
// unparseable token. Split it off so the number underneath still gets
// recognized, then reattach the connector unchanged (Arabic orthography
// keeps these attached, not space-separated).
const ATTACHED_CONNECTOR_PATTERN = /^([وفبلك])(-?[٠-٩\d]+)$/;

function numberWordFor(core: string): string | null {
  const direct = numberWordForDigits(core);
  if (direct) return direct;

  const attached = core.match(ATTACHED_CONNECTOR_PATTERN);
  if (attached) {
    const [, connector, digits] = attached;
    const word = numberWordForDigits(digits);
    if (word) return `${connector}${word}`;
  }

  return null;
}

export function prepareArabicSpeechText(text: string): string {
  if (!containsArabicScript(text)) return text;

  // Math symbols first, with padding spaces, so the token pass below sees
  // them as ordinary standalone words rather than punctuation glued to
  // neighboring digits (e.g. "4+3" -> "4 زائِد 3", not "4زائِد3").
  let working = text.replace(/\+/g, " زائِد ").replace(/=/g, " يُساوي ");

  return working
    .split(/(\s+)/) // keep whitespace runs as their own tokens to preserve exact spacing
    .map((token) => {
      if (token === "" || /^\s+$/.test(token)) return token;
      const match = token.match(/^([^\p{L}\p{N}]*)([\p{L}\p{N}]+)([^\p{L}\p{N}]*)$/u);
      if (!match) return token;
      const [, prefix, core, suffix] = match;
      const numberWord = numberWordFor(core);
      if (numberWord) return `${prefix}${numberWord}${suffix}`;
      const dictHit = ARABIC_TERM_DIACRITICS[core];
      if (dictHit) return `${prefix}${dictHit}${suffix}`;
      return token;
    })
    .join("");
}

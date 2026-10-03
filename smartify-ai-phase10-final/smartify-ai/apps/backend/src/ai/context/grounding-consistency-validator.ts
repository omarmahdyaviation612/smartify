import type { GroundingSlice } from "../../interactive-lesson/unit-grounding/unit-grounding.types";

/**
 * A lightweight, deterministic (no extra AI call) check that generated
 * content, when grounding was supplied, actually stayed anchored to that
 * grounding — NOT a "every sentence must appear in the grounding" rule
 * (that would forbid legitimate teaching enrichment, e.g. a child-friendly
 * analogy the textbook never used). Two narrow things only:
 *
 * 1. No grounding sentence appears copied verbatim into the generated
 *    text — catches accidental/lazy transcription (the copyright-safety
 *    rule the prompt already states, backstopped in code).
 * 2. The generated text references AT LEAST ONE concept/vocabulary term
 *    from the grounding — catches wholesale drift (e.g. a "Parts of a
 *    Plant" Topic generating Solar System content instead).
 *
 * Feeds into the SAME retry loop generateAutoDraft/generateAutoQuestionBatch
 * already have (appended to lastErrors) — no new retry mechanism needed.
 */

const MIN_VERBATIM_CHECK_LENGTH = 40; // short overlaps are too likely to be coincidental generic phrasing to flag
const STOPWORDS = new Set(["the", "a", "an", "of", "and", "in", "on", "to", "for", "with", "is", "are", "rule", "concept"]);

/** Individual, non-trivial words from a concept/term name — a multi-word name like "Zero rule" should match generated text that discusses the underlying idea without repeating that exact phrase. */
function significantWords(phrase: string): string[] {
  return phrase
    .toLowerCase()
    .replace(/[.,!?;:()'"]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * 2026-10-03 (Wave B "Decimals to the Thousandths"): a correct lesson that
 * says "decimal" was rejected against the anchor "decimals" — the substring
 * check already accepts a plural in the text for a singular anchor, but not
 * the reverse. This returns the regular English SINGULAR of a plural anchor
 * word ("decimals" -> "decimal", "properties" -> "property", "matches" ->
 * "match"), or null. Deliberately narrow: ASCII-letter words of 5+ characters
 * only (Arabic and every other script untouched), regular plural endings only,
 * no fuzzy/semantic matching. The variant is matched as a WHOLE word, so a
 * short stem can never hit inside an unrelated longer word.
 */
export function singularVariant(word: string): string | null {
  if (!/^[a-z]{5,}$/.test(word)) return null;
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (/(ches|shes|sses|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (/(ss|us|is)$/.test(word)) return null;
  if (word.endsWith("s")) return word.slice(0, -1);
  return null;
}

/**
 * 2026-10-03 (Wave B word-problem pools): an operation noun anchor's verb
 * family, so a correct explanation saying "subtract 12 from 50" references the
 * anchor "subtraction". General English noun->verb morphology only — no
 * curriculum dictionary — for ASCII words of 6+ letters:
 *   -ication -> -y      multiplication -> multiply (also classify, simplify)
 *   -ision   -> -ide    division -> divide (also decide, collide)
 *   -ction   -> -ct     subtraction -> subtract (also construct, collect)
 *   -ition   -> (drop)  addition -> add — ONLY when the stem ends in a doubled
 *                       consonant; most -ition nouns are irregular
 *                       (partition/part, petition/pet must never match)
 * plus the verb's regular -s/-ed/-ing forms. Every form is matched as a WHOLE
 * word only, so "individual", "subdivision", "multiple(s)" and "additional"
 * never match through this path.
 */
export function verbFamily(word: string): string[] {
  if (!/^[a-z]{6,}$/.test(word)) return [];
  let verb: string | null = null;
  if (word.endsWith("ication")) verb = `${word.slice(0, -7)}y`;
  else if (word.endsWith("ision")) verb = `${word.slice(0, -5)}ide`;
  else if (word.endsWith("ction")) verb = word.slice(0, -3);
  else if (word.endsWith("ition") && /([b-df-hj-np-tv-z])\1$/.test(word.slice(0, -5))) verb = word.slice(0, -5);
  if (!verb || verb.length < 3) return [];
  if (/[^aeiou]y$/.test(verb)) return [verb, `${verb.slice(0, -1)}ies`, `${verb.slice(0, -1)}ied`, `${verb}ing`];
  if (verb.endsWith("e")) return [verb, `${verb}s`, `${verb}d`, `${verb.slice(0, -1)}ing`];
  return [verb, `${verb}s`, `${verb}ed`, `${verb}ing`];
}

const wholeWord = (text: string, form: string) => new RegExp(`(^|[^a-z])${form}([^a-z]|$)`).test(text);

function referencesAnchor(generatedText: string, word: string, wordForms: boolean): boolean {
  if (generatedText.includes(word)) return true;
  const singular = singularVariant(word);
  if (singular && wholeWord(generatedText, singular)) return true;
  return wordForms && verbFamily(word).some((form) => wholeWord(generatedText, form));
}

/**
 * `wordForms` (opt-in, 2026-10-03): also accept an anchor's verb family
 * (verbFamily above). Only the admin Question-authoring paths pass it; lesson
 * validation and the student lazy top-up keep the behavior they had before.
 */
export function checkGroundingConsistency(generatedTexts: string[], groundingSlice: GroundingSlice, opts: { wordForms?: boolean } = {}): string[] {
  const errors: string[] = [];
  const generatedText = generatedTexts.join(" \n ").toLowerCase();

  const groundingSentences = [...groundingSlice.concepts.map((c) => c.description), ...groundingSlice.facts.map((f) => f.fact)].filter(
    (s) => s.length >= MIN_VERBATIM_CHECK_LENGTH,
  );
  for (const sentence of groundingSentences) {
    if (generatedText.includes(sentence.toLowerCase())) {
      errors.push(`Generated content appears to copy a grounding note verbatim ("${sentence.slice(0, 60)}${sentence.length > 60 ? "..." : ""}") — rephrase in your own original words.`);
    }
  }

  const groundingWords = [...groundingSlice.concepts.map((c) => c.name), ...groundingSlice.vocabulary.map((v) => v.term)].flatMap(significantWords);
  if (groundingWords.length > 0 && !groundingWords.some((w) => referencesAnchor(generatedText, w, !!opts.wordForms))) {
    errors.push("Generated content does not reference any concept or term from the supplied grounding — it may have drifted from the intended curriculum scope.");
  }

  return errors;
}

import type { GroundingNotes, GroundingSlice } from "../../interactive-lesson/unit-grounding/unit-grounding.types";

/**
 * A Unit's groundingNotesJson may describe several Topics' worth of
 * content — generating one Topic must never receive the WHOLE Unit's
 * grounding unfiltered (a Science Unit's "Plant parts" Topic must not
 * drag in "Plant Life Cycle" content just because they share a Unit). This
 * is the single, pure, DB/AI-free selection step between "the Unit has
 * grounding" and "this one Topic's generation prompt gets a scoped slice
 * of it" — TOPIC determines immediate teaching scope; UNIT grounding
 * provides curriculum context; nothing here ever crosses a Unit boundary
 * (the caller only ever has ONE Unit's GroundingNotes in hand to begin
 * with, via the Topic's own `unit` relation).
 */

/**
 * Unicode-safe, language-agnostic title normalization. Deliberately NOT a
 * synonym table (2026-09-27): the ONLY thing widened here is orthographic
 * noise that two spellings of the SAME string differ by — case, Unicode
 * combining marks (Arabic harakat/tanwin, Latin accents, any script's
 * diacritics), punctuation/symbol characters, and whitespace runs. It
 * behaves identically for Arabic, English or any other script, and can
 * never map two genuinely different titles onto each other.
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFD")
    // Strip Unicode combining marks (diacritics): U+0300-U+036F covers the
    // Latin set, the U+06xx ranges the Arabic harakat/tanwin/sukun marks.
    .replace(/[̀-ͯؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭ]/g, "")
    .toLowerCase()
    // Any punctuation/symbol character (Unicode-aware), not just the ASCII
    // set the original list covered — Arabic comma/semicolon/question mark,
    // typographic quotes, en/em dashes, brackets and slashes all collapse to
    // a space, so "Unit 3 — Plants (Reading)" and "Unit 3: Plants, reading"
    // normalize identically.
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Deliberately conservative — short/common words would make keyword overlap
// match almost anything, defeating the point of scoping to one Topic.
const STOPWORDS = new Set(["the", "a", "an", "of", "and", "in", "on", "to", "for", "with", "is", "are"]);

function keywordsOf(title: string): Set<string> {
  return new Set(
    normalizeTitle(title)
      .split(" ")
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

function overlapScore(a: Set<string>, b: Set<string>): number {
  let score = 0;
  for (const word of a) if (b.has(word)) score++;
  return score;
}

/**
 * `unitTopicCount`, when supplied, is the total number of Topics under this
 * Topic's own Unit (not a new query result the caller has to fetch
 * specially — every existing caller already has or can trivially include
 * this count alongside the Unit it already loads). It is used ONLY as a
 * narrow, unambiguous fallback (2026-09-26 — see the "Chapter 1" incident:
 * a Unit's sole Topic given a generic, non-descriptive name has zero
 * lexical overlap with its own real, correct grounding, and was wrongly
 * blocked as if unsupported). When normal Topic-scoped selection
 * (topicHints match, then keyword overlap) finds nothing AND this Topic is
 * the ONLY Topic under its Unit, there is no cross-topic contamination
 * risk (unlike a multi-Topic Unit, where a wrong guess could hand one
 * Topic another Topic's unrelated content) — so the Unit's entire
 * grounding is unambiguously "this Topic's" grounding, and is returned
 * instead of null. Every fact/concept returned still comes from the real
 * textbook grounding; this widens WHICH slice of real grounding is
 * supplied, it never permits inventing content outside it.
 *
 * 2026-10-03 (sole-Topic precedence): the sole-Topic rule is now evaluated
 * FIRST, before the topicHints match and keyword overlap. A Unit's only Topic
 * owns the whole Unit unambiguously, so a coincidental one-word title overlap
 * (Wave B "Planet Earth" vs concept "Components of Earth") must not narrow it
 * to a fragment of its own textbook pages. Units with 2+ Topics never reach
 * this branch, so multi-Topic selection is unchanged.
 */
export function selectRelevantGrounding(
  groundingNotesJson: GroundingNotes | null | undefined,
  topicNameEn: string,
  unitTopicCount?: number,
): GroundingSlice | null {
  if (!groundingNotesJson) return null;

  if (unitTopicCount === 1) {
    // Sole Topic under this Unit — the Unit's whole grounding IS this Topic's
    // grounding, unambiguously. Never applied when a Unit has 2+ Topics.
    return {
      matchedViaHint: false,
      matchedVia: "SINGLE_TOPIC_UNIT",
      learningObjectives: groundingNotesJson.learningObjectives,
      concepts: groundingNotesJson.concepts,
      facts: groundingNotesJson.facts,
      vocabulary: groundingNotesJson.vocabulary,
    };
  }

  const normalizedTopic = normalizeTitle(topicNameEn);
  const exactHint = groundingNotesJson.topicHints?.find((h) => normalizeTitle(h.topicTitle) === normalizedTopic);

  if (exactHint) {
    const relevantNames = new Set(exactHint.relevantConcepts.map((c) => c.toLowerCase()));
    return {
      matchedViaHint: true,
      matchedVia: "HINT",
      matchedHintTitle: exactHint.topicTitle,
      learningObjectives: groundingNotesJson.learningObjectives,
      concepts: groundingNotesJson.concepts.filter((c) => relevantNames.has(c.name.toLowerCase()) || exactHint.sourcePages.some((p) => c.sourcePages.includes(p))),
      facts: groundingNotesJson.facts.filter((f) => exactHint.sourcePages.some((p) => f.sourcePages.includes(p))),
      vocabulary: groundingNotesJson.vocabulary.filter((v) => exactHint.sourcePages.some((p) => v.sourcePages.includes(p))),
    };
  }

  // No exact/normalized topicHints match — derive a conservative subset via
  // topic-title keyword overlap against each concept's own name, rather
  // than returning the entire Unit's grounding for every Topic under it.
  const topicKeywords = keywordsOf(topicNameEn);
  const scoredConcepts = groundingNotesJson.concepts
    .map((c) => ({ concept: c, score: overlapScore(topicKeywords, keywordsOf(c.name)) }))
    .filter((s) => s.score > 0);

  if (scoredConcepts.length === 0) {
    // Nothing recognizably related to this Topic's title anywhere in the
    // Unit's grounding, and this Unit has other Topics too — safer to
    // report "no relevant slice" than to guess and hand generation an
    // arbitrary, unrelated subset.
    return null;
  }

  const relevantConcepts = scoredConcepts.map((s) => s.concept);
  const conceptNames = new Set(relevantConcepts.map((c) => c.name.toLowerCase()));
  const relevantPages = new Set(relevantConcepts.flatMap((c) => c.sourcePages));

  return {
    matchedViaHint: false,
    matchedVia: "KEYWORD",
    learningObjectives: groundingNotesJson.learningObjectives,
    concepts: relevantConcepts,
    facts: groundingNotesJson.facts.filter((f) => f.sourcePages.some((p) => relevantPages.has(p))),
    vocabulary: groundingNotesJson.vocabulary.filter((v) => v.sourcePages.some((p) => relevantPages.has(p)) || conceptNames.has(v.term.toLowerCase())),
  };
}

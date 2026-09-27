import type { GroundingNotes, GroundingConcept, GroundingTopicHint } from "../../interactive-lesson/unit-grounding/unit-grounding.types";
import { normalizeTitle } from "./grounding-selector.util";
import { stepsOneToThree, stepFour, type AssignmentTopic } from "./topic-grounding-assignment.service";

/**
 * The PURE candidate-identification function for the Stage 2 bounded
 * validator (2026-09-27). This is deliberately separate from, and stricter
 * than, the free-form AI mapper: it never invents or picks among several
 * plausible candidates — it either finds exactly ONE unambiguous unclaimed
 * concept/hint whose name has strong lexical overlap with the Topic's title,
 * or it returns null. The caller (TopicGroundingValidatorService) may only
 * ask the model to CONFIRM the single candidate this function names; the
 * model is never shown a list to choose from.
 */

export interface SingleCandidate {
  kind: "CONCEPT" | "HINT";
  name: string;
  score: number;
  concept?: GroundingConcept;
  hint?: GroundingTopicHint;
}

/**
 * Whole-title token-set Jaccard overlap on `normalizeTitle()`'d strings —
 * the SAME Unicode-safe, diacritics/punctuation-tolerant normalization the
 * existing keyword-overlap selector already uses (grounding-selector.util.ts),
 * so this behaves identically for Arabic and English titles and never needs
 * a synonym/translation table.
 */
function tokenSet(title: string): Set<string> {
  return new Set(normalizeTitle(title).split(" ").filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * A candidate must clear this Jaccard score to be considered at all — chosen
 * to require that AT LEAST HALF of the combined vocabulary of the Topic
 * title and the candidate name overlaps (e.g. a short, focused title like
 * "Approximation" / "التقريب" against an equally short, focused concept name
 * of the same words clears this easily; a title that merely shares one
 * generic/common word with a candidate does not). This is intentionally
 * strict: a LOWER threshold would let the "4 tied ambiguous concepts" shape
 * (several unclaimed concepts each sharing a little bit of vocabulary with a
 * broad title, e.g. "How Does the World Become More Beautiful?") sneak a
 * weak candidate past the gate; a threshold this high means only a genuinely
 * close, near-restatement match survives.
 */
export const CANDIDATE_MATCH_THRESHOLD = 0.5;

/**
 * Once at least one candidate clears the threshold, the WINNER must also
 * beat the runner-up by at least this margin, or the pool is ambiguous and
 * the function returns null rather than guess. 0.15 was chosen because it is
 * comfortably larger than the score gap produced by two candidates that
 * differ by only one shared/common token (which typically separates scores
 * by less than 0.1 on short titles) while still being small enough that a
 * genuinely dominant single match (e.g. the "التقريب" case, where the
 * candidate is near-identical to the title and no other unclaimed candidate
 * shares meaningful vocabulary with it at all) clears it easily — in that
 * case the runner-up score is typically 0, so the margin is trivially
 * satisfied. The "4 tied ambiguous concepts" fixture is constructed so every
 * candidate scores within this margin of each other and is correctly
 * rejected.
 */
export const CANDIDATE_AMBIGUITY_MARGIN = 0.15;

/**
 * Reuses the exact same "claimed by a sibling" logic Step 5 uses
 * (topic-grounding-assignment.service.ts): a sibling's concept names come
 * from a still-valid prior persisted assignment when available, otherwise
 * from freshly recomputing that sibling's own Steps 1-4 result. Hint titles
 * are likewise collected from a freshly recomputed sibling assignment (prior
 * persisted assignments only carry concept names today, mirroring Step 5's
 * own limitation — see loadPriorAssignments in the assignment service).
 */
function unclaimedPool(
  notes: GroundingNotes,
  topic: AssignmentTopic,
  siblings: AssignmentTopic[],
  priorAssignments?: Map<string, string[]>,
): { unclaimedConcepts: GroundingConcept[]; unclaimedHints: GroundingTopicHint[] } {
  const all = siblings.some((s) => s.id === topic.id) ? siblings : [...siblings, topic];

  const claimedConceptNames = new Set<string>();
  const claimedHintTitles = new Set<string>();

  for (const sib of all) {
    if (sib.id === topic.id) continue;
    const prior = priorAssignments?.get(sib.id);
    if (prior && prior.length > 0) {
      for (const name of prior) claimedConceptNames.add(name.toLowerCase());
      continue;
    }
    const sibAssignment = stepsOneToThree(notes, sib, all.length) ?? stepFour(notes, sib);
    if (sibAssignment) {
      for (const name of sibAssignment.matchedConceptNames) claimedConceptNames.add(name.toLowerCase());
      for (const title of sibAssignment.matchedHintTitles ?? []) claimedHintTitles.add(title.toLowerCase());
    }
  }

  return {
    unclaimedConcepts: notes.concepts.filter((c) => !claimedConceptNames.has(c.name.toLowerCase())),
    unclaimedHints: (notes.topicHints ?? []).filter((h) => !claimedHintTitles.has(h.topicTitle.toLowerCase())),
  };
}

/**
 * Returns the single, unambiguous unclaimed concept-or-hint candidate for
 * this Topic, or null when there are zero, tied, or otherwise ambiguous
 * candidates. NEVER guesses — see the module doc comment.
 */
export function identifySingleCandidate(
  notes: GroundingNotes | null | undefined,
  topic: AssignmentTopic,
  siblings: AssignmentTopic[],
  priorAssignments?: Map<string, string[]>,
): SingleCandidate | null {
  if (!notes) return null;

  const { unclaimedConcepts, unclaimedHints } = unclaimedPool(notes, topic, siblings, priorAssignments);
  const topicTokens = tokenSet(topic.nameEn);
  if (topicTokens.size === 0) return null;

  const scored: SingleCandidate[] = [
    ...unclaimedConcepts.map((c) => ({ kind: "CONCEPT" as const, name: c.name, score: jaccard(topicTokens, tokenSet(c.name)), concept: c })),
    ...unclaimedHints.map((h) => ({ kind: "HINT" as const, name: h.topicTitle, score: jaccard(topicTokens, tokenSet(h.topicTitle)), hint: h })),
  ].filter((s) => s.score > 0);

  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (best.score < CANDIDATE_MATCH_THRESHOLD) return null;

  const second = scored[1];
  if (second && best.score - second.score < CANDIDATE_AMBIGUITY_MARGIN) return null;

  return best;
}

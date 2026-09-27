import type { SizedPage } from "../../ai/vision-request-sizing";
import type { GroundingNotes, RawGroundingNotes } from "./unit-grounding.types";

/**
 * Page-provenance hotfix (2026-09-25). The model is validated (see
 * unit-grounding-validator.ts) against `sourceImageIndex` — a 1-based
 * ordinal into `pages`, the exact set of images actually sent for this
 * chunk — never an absolute page number. This is the one place that
 * ordinal is deterministically translated to a REAL PDF page number,
 * using `pages[index - 1].page` (established with certainty by the PDF
 * renderer's own guaranteed-ascending output — see
 * UnitGroundingService.prepareNextGroundingChunk). The model's own
 * belief about page numbers is never consulted or trusted.
 *
 * Called only AFTER validateGroundingNotes() has already confirmed every
 * sourceImageIndex is a valid 1..pages.length ordinal — `pages[i - 1]` is
 * therefore always defined here.
 *
 * Preserves per-item provenance exactly: an item citing image 2 of a
 * 2-page chunk gets [pages[1].page], not the whole chunk's page range —
 * never collapsed/clamped to "the whole chunk".
 */
function remapIndexes(indexes: number[], pages: SizedPage[]): number[] {
  return indexes.map((index) => pages[index - 1].page);
}

export function remapSourceImageIndexToPages(raw: RawGroundingNotes, pages: SizedPage[]): GroundingNotes {
  return {
    unitTitle: raw.unitTitle,
    gradeLevel: raw.gradeLevel,
    subject: raw.subject,
    learningObjectives: raw.learningObjectives,
    concepts: raw.concepts.map((c) => ({
      name: c.name,
      description: c.description,
      importance: c.importance,
      sourcePages: remapIndexes(c.sourceImageIndex, pages),
    })),
    facts: raw.facts.map((f) => ({
      fact: f.fact,
      importance: f.importance,
      sourcePages: remapIndexes(f.sourceImageIndex, pages),
    })),
    vocabulary: raw.vocabulary.map((v) => ({
      term: v.term,
      meaning: v.meaning,
      sourcePages: remapIndexes(v.sourceImageIndex, pages),
    })),
    skills: raw.skills,
    // topicHints.sourceImageIndex is optional (not required/validated by
    // validateGroundingNotes today, matching its pre-existing behavior) —
    // absent or empty maps to an empty sourcePages array, never a guess.
    topicHints: raw.topicHints.map((h) => ({
      topicTitle: h.topicTitle,
      relevantConcepts: h.relevantConcepts,
      sourcePages: remapIndexes(h.sourceImageIndex ?? [], pages),
    })),
    scopeNotes: raw.scopeNotes,
  };
}

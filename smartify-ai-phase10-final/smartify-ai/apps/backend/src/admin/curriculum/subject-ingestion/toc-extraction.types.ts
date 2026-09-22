/**
 * Admin New Subject + Textbook Ingestion V1 (2026-09-20) — shared shapes
 * between TocExtractionService (produces a candidate structure from AI
 * vision extraction) and toc-extraction-validator (validates it) and
 * AdminCurriculumService (persists an admin-edited version of it).
 *
 * sourcePageStart/sourcePageEnd on a Topic are candidate-only — Topic has
 * no page-range columns in the current schema (only Unit does), so these
 * exist purely to help an admin sanity-check/edit a Unit's own page range
 * during preview; they are never persisted.
 */
export interface TocTopicCandidate {
  nameEn: string;
  nameAr: string;
  sourcePageStart?: number;
  sourcePageEnd?: number;
}

export interface TocUnitCandidate {
  nameEn: string;
  nameAr: string;
  sourcePageStart: number;
  sourcePageEnd: number;
  topics: TocTopicCandidate[];
}

export interface TocExtractionResult {
  units: TocUnitCandidate[];
}

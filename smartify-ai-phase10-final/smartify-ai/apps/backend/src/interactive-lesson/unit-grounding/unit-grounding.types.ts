/**
 * The shape of Unit.groundingNotesJson — real, original, non-verbatim
 * structured curriculum notes derived (once, offline, per Unit) from the
 * real source textbook's own pages. NEVER textbook prose, exercises,
 * illustrations, or tables — see UnitGroundingService's extraction prompt
 * for the copyright rules that produce this shape. `sourcePages` fields
 * are kept for internal provenance/debugging only and must never reach a
 * student.
 */
export interface GroundingConcept {
  name: string;
  description: string;
  sourcePages: number[];
  importance: "core" | "supporting";
}

export interface GroundingFact {
  fact: string;
  sourcePages: number[];
  importance: "core" | "supporting";
}

export interface GroundingVocabularyTerm {
  term: string;
  meaning: string;
  sourcePages: number[];
}

export interface GroundingTopicHint {
  topicTitle: string;
  relevantConcepts: string[];
  sourcePages: number[];
}

export interface GroundingNotes {
  unitTitle: string;
  gradeLevel: string;
  subject: string;
  learningObjectives: string[];
  concepts: GroundingConcept[];
  facts: GroundingFact[];
  vocabulary: GroundingVocabularyTerm[];
  skills: string[];
  topicHints: GroundingTopicHint[];
  scopeNotes: string[];
}

/**
 * The Topic-scoped subset of a Unit's GroundingNotes actually injected into
 * one generation prompt — never the whole Unit's grounding (see
 * grounding-selector.util.ts). `matchedViaHint` records whether selection
 * found an exact/normalized topicHints match or fell back to a broader
 * keyword-overlap subset, purely for logging/debugging — it never changes
 * generation behavior.
 */
export interface GroundingSlice {
  learningObjectives: string[];
  concepts: GroundingConcept[];
  facts: GroundingFact[];
  vocabulary: GroundingVocabularyTerm[];
  matchedViaHint: boolean;
}

/**
 * Page-provenance hotfix (2026-09-25): the extraction model is never
 * asked for an absolute PDF page number — it has no reliable way to know
 * one (a textbook's own printed pagination routinely differs from the
 * PDF's physical page index once front matter is accounted for, and the
 * production incident on unit cmucxcubj00eh2qd5kfwohz11 was exactly this
 * — the model was echoing a printed page number outside the requested
 * PDF-index range). Instead the model reports which of the images it was
 * actually shown a given item came from — a 1-based ordinal into the
 * exact set of images sent for this chunk, always unambiguous regardless
 * of the textbook's own pagination. `RawGrounding*` mirrors the
 * `Grounding*` types above field-for-field, with `sourceImageIndex`
 * (ordinal) in place of `sourcePages` (real page number) — this is ONLY
 * the shape validated directly off the model's raw JSON. See
 * unit-grounding-page-remap.util.ts's remapSourceImageIndexToPages(),
 * which deterministically (never trusting the model) converts ordinals
 * back to real page numbers using the same pages[] array the renderer
 * itself produced, before anything is persisted. The final persisted
 * Unit.groundingNotesJson shape (GroundingNotes, above) is completely
 * unchanged — RawGroundingNotes never reaches storage.
 */
export interface RawGroundingConcept {
  name: string;
  description: string;
  sourceImageIndex: number[];
  importance: "core" | "supporting";
}

export interface RawGroundingFact {
  fact: string;
  sourceImageIndex: number[];
  importance: "core" | "supporting";
}

export interface RawGroundingVocabularyTerm {
  term: string;
  meaning: string;
  sourceImageIndex: number[];
}

export interface RawGroundingTopicHint {
  topicTitle: string;
  relevantConcepts: string[];
  sourceImageIndex?: number[];
}

export interface RawGroundingNotes {
  unitTitle: string;
  gradeLevel: string;
  subject: string;
  learningObjectives: string[];
  concepts: RawGroundingConcept[];
  facts: RawGroundingFact[];
  vocabulary: RawGroundingVocabularyTerm[];
  skills: string[];
  topicHints: RawGroundingTopicHint[];
  scopeNotes: string[];
}

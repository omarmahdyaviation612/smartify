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

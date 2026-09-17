/**
 * The input contract for the (Phase 10E: architecture-only, never actually
 * invoked with a real provider) Question Bank generation pipeline.
 * `learningFocus` is a TOPIC/OBJECTIVE MAP entry only — it must never carry
 * textbook prose, exercises, or a specific question copied/paraphrased from
 * a source. Mirrors LessonGenerationInput's own "map, not source text"
 * contract (see lesson-draft.types.ts).
 */
export interface QuestionGenerationInput {
  /** The existing, non-placeholder Topic this draft would assess. */
  targetTopicId: string;
  /** Requested QuestionType — validated against MVP-ready types before any draft is persisted (see question-draft-validator.ts). */
  type: string;
  difficulty: string;
  /** What subskill this one question should assess, e.g. "identify the start/add/total in a one-step addition story" — never a full question, never textbook wording. */
  learningFocus: string;
  preferredLang: "ar" | "en";
  studentAgeRange: string;
}

/** Curriculum/grade/subject/unit/topic names resolved live from the DB — never hand-typed. */
export interface ResolvedTopicContext {
  curriculumNameEn: string;
  gradeNameEn: string;
  subjectNameEn: string;
  unitNameEn: string;
  topicNameEn: string;
}

/**
 * The shape a generation attempt (real AI response, once wired up in a
 * later phase) must produce, and the shape QuestionDraft's own DB row
 * mirrors. `promptAr`/`explanationAr` are intentionally ABSENT here — the
 * AI is never asked for Arabic content, since it is never trusted without
 * human review (see QuestionDraft.promptAr's doc comment in schema.prisma).
 */
export interface RawQuestionDraftShape {
  topicId: string;
  type: string;
  difficulty: string;
  promptEn: string;
  optionsJson?: string[] | null;
  correctAnswerJson: unknown;
  explanationEn?: string | null;
}

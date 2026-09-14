/**
 * The input contract for the lesson content-generation pipeline (Phase 5/6).
 * Deliberately a TOPIC / LEARNING-OBJECTIVE MAP only — it must never carry
 * textbook prose, exercises, page text, or a source PDF path.
 *
 * Phase 6: curriculum/grade/subject/unit names are NO LONGER hand-typed
 * here — the generator resolves them live from the existing Curriculum ->
 * Grade -> Subject -> Unit DB relations via `targetUnitId` (see
 * resolveUnitContext() in lesson-draft-generator.service.ts). Only the NEW
 * topic identity and its original Smartify learning objectives — which
 * genuinely don't exist in the DB yet — are still provided directly.
 */
export interface LessonGenerationInput {
  /** The existing Unit this draft targets — the single source of truth for curriculum/grade/subject/unit context, and what this draft would publish under later, if approved. */
  targetUnitId: string;
  topicNameEn: string;
  topicNameAr: string;
  /** Original Smartify-authored objectives — never textbook sentences. */
  learningObjectives: string[];
  preferredLang: "ar" | "en";
  studentAgeRange: string;
}

/** Curriculum/grade/subject/unit names resolved live from the DB — never hand-typed. */
export interface ResolvedUnitContext {
  curriculumNameEn: string;
  gradeNameEn: string;
  subjectNameEn: string;
  unitNameEn: string;
}

/**
 * Phase 10B: the shape LessonDraft.learningObjectivesJson actually stores.
 * `objectiveEn` comes from LessonGenerationInput.learningObjectives (never
 * AI-authored — see that field's own doc comment). `objectiveAr` starts
 * `null` for every objective on every newly-generated draft, regardless of
 * what the caller supplies — the AI is never trusted to produce it, and a
 * human reviewer must explicitly supply it via
 * LessonPublishService.reviewObjectives() before LessonPublishService.
 * approve() will accept the draft. This replaces the old hardcoded
 * REVIEWED_OBJECTIVE_TRANSLATIONS allow-list, which required a source-code
 * change for every new objective and could never scale past a handful of
 * lessons.
 */
export interface BilingualObjective {
  objectiveEn: string;
  objectiveAr: string | null;
}

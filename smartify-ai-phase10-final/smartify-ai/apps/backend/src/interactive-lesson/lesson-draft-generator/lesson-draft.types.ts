/**
 * The input contract for the lesson content-generation pipeline (Phase 5).
 * Deliberately a TOPIC / LEARNING-OBJECTIVE MAP only — it must never carry
 * textbook prose, exercises, page text, or a source PDF path. Every field
 * here comes from the existing curriculum hierarchy (Curriculum -> Grade ->
 * Subject -> Unit -> Topic) or from ORIGINAL Smartify-authored
 * learningObjectives, exactly like the Phase 2/4 pilot seed scripts.
 */
export interface LessonGenerationInput {
  curriculumNameEn: string;
  gradeNameEn: string;
  subjectNameEn: string;
  unitNameEn: string;
  topicNameEn: string;
  topicNameAr: string;
  /** Original Smartify-authored objectives — never textbook sentences. */
  learningObjectives: string[];
  preferredLang: "ar" | "en";
  studentAgeRange: string;
  /** The existing Unit this draft would publish under later, if approved — informational only. */
  targetUnitId?: string;
}

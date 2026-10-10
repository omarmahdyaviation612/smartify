// Bumped only when buildAutoLessonGenerationPrompt's grounded-generation
// instructions change in a way that would make previously-generated
// TEXTBOOK_GROUNDED content stale — never touched by ungrounded generation.
// Kept in its own dependency-free module so scripts (regenerate-topic-content)
// can compare against it without loading the Nest generator service.
//
// v2 (2026-10-10): concept-coverage planning — every grounding concept must be
// taught (lesson-concept-coverage.util.ts). v1 lessons may cover only part of
// the Topic and are listed by `pnpm content:regenerate --list-outdated`.
export const AUTO_LESSON_GENERATION_PROMPT_VERSION = "auto-lesson-v2";

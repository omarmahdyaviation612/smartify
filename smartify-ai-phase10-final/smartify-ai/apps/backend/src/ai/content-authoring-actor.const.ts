/**
 * The one SUPER_ADMIN account used to attribute every content-authoring
 * AI spend (lesson/question draft generation, and now grounding
 * extraction) — never a real student's id, regardless of whether the
 * generation was triggered by an offline admin script or lazily by a
 * real student's live request. Single source of truth: previously
 * duplicated as a local const in each one-off script; now shared so a
 * live-request trigger path (UnitGroundingService.ensureUnitGrounded,
 * called from LessonDraftGeneratorService.ensureTopicHasLesson) uses the
 * exact same id as the scripts.
 */
export const CONTENT_AUTHORING_ACTOR_ID = "cmtz6270z0000u9c5h6ua0y67";

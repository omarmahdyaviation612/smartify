// Read-only curriculum status dashboard (2026-09-20) — derives a Topic's
// DISPLAY status from the actual data combination, never from
// generationSource alone. Historical Topics published through the old,
// pre-2026-09-19 human-reviewed pipeline (LessonPublishService.publish())
// have teachingStepsJson set but generationSource left NULL (that field is
// only ever written by autoPublishIntoTopic()) — treating NULL as "never
// generated" would misreport 41 real, live, published Topics as missing
// content. This is display logic only; nothing here reads or writes the
// database.
export type TopicDisplayStatus = "NEVER_GENERATED" | "TEXTBOOK_GROUNDED" | "LEGACY_TITLE_ONLY" | "HISTORICAL_GENERATED";

export function deriveTopicStatus(hasTeachingSteps: boolean, generationSource: string | null): TopicDisplayStatus {
  if (!hasTeachingSteps) return "NEVER_GENERATED";
  if (generationSource === "TEXTBOOK_GROUNDED") return "TEXTBOOK_GROUNDED";
  if (generationSource === "LEGACY_TITLE_ONLY") return "LEGACY_TITLE_ONLY";
  return "HISTORICAL_GENERATED";
}

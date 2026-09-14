import { BadRequestException } from "@nestjs/common";
import type { BilingualObjective } from "./lesson-draft.types";

/**
 * Wraps freshly-authored English objectives (from LessonGenerationInput —
 * always human-authored curriculum-map content, never AI output) into the
 * bilingual shape LessonDraft.learningObjectivesJson stores. `objectiveAr`
 * always starts null, regardless of caller input — see
 * BilingualObjective's doc comment for why.
 */
export function toUnreviewedBilingualObjectives(objectivesEn: string[]): BilingualObjective[] {
  return objectivesEn.map((objectiveEn) => ({ objectiveEn, objectiveAr: null }));
}

/**
 * Reads a LessonDraft.learningObjectivesJson value back out as
 * BilingualObjective[]. A pre-Phase-10B draft (only ever the one already-
 * published "Addition with Zero" row) stored a plain string[] instead —
 * never crash on that shape, just treat every entry as an unreviewed
 * objective with no Arabic yet, exactly like a fresh draft. This function
 * is never actually reached for that specific row in practice (it's
 * already "published", so approve()/reviewObjectives() — the only two
 * callers — are unreachable for it, gated by their own status checks) but
 * stays defensive rather than assuming that will always remain true.
 */
export function parseBilingualObjectives(raw: unknown): BilingualObjective[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    if (typeof entry === "string") return { objectiveEn: entry, objectiveAr: null };
    const obj = entry as Partial<BilingualObjective>;
    return {
      objectiveEn: typeof obj.objectiveEn === "string" ? obj.objectiveEn : "",
      objectiveAr: typeof obj.objectiveAr === "string" && obj.objectiveAr.trim() ? obj.objectiveAr : null,
    };
  });
}

/** True only when every objective has a non-empty, human-reviewed Arabic translation. */
export function allObjectivesReviewed(objectives: BilingualObjective[]): boolean {
  return objectives.length > 0 && objectives.every((o) => typeof o.objectiveAr === "string" && o.objectiveAr.trim().length > 0);
}

/**
 * Applies a human reviewer's Arabic translations onto a draft's existing
 * objectives. Matched by exact objectiveEn text — a reviewer can only ever
 * supply the Arabic half of an objective the generator already proposed,
 * never smuggle in a different or additional objective through this path.
 * Throws (fixing nothing) if any submitted translation doesn't match an
 * existing objective, or supplies an empty Arabic string.
 */
export function applyReviewedTranslations(
  current: BilingualObjective[],
  translations: Array<{ objectiveEn: string; objectiveAr: string }>,
): BilingualObjective[] {
  if (translations.length === 0) {
    throw new BadRequestException("At least one reviewed objective translation is required.");
  }
  const byEn = new Map(current.map((o) => [o.objectiveEn, o]));
  for (const t of translations) {
    if (!byEn.has(t.objectiveEn)) {
      throw new BadRequestException(`"${t.objectiveEn}" is not one of this draft's existing objectives.`);
    }
    if (!t.objectiveAr || !t.objectiveAr.trim()) {
      throw new BadRequestException(`A non-empty Arabic translation is required for "${t.objectiveEn}".`);
    }
  }
  const translationByEn = new Map(translations.map((t) => [t.objectiveEn, t.objectiveAr.trim()]));
  return current.map((o) => (translationByEn.has(o.objectiveEn) ? { ...o, objectiveAr: translationByEn.get(o.objectiveEn)! } : o));
}

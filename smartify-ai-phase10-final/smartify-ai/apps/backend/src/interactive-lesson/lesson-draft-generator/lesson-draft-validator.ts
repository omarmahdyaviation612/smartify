import type { TeachingStep, TeachingStepType } from "../interactive-lesson.types";

/**
 * Structural validation for AI-generated lesson drafts (Phase 5). Raw AI
 * JSON is NEVER trusted directly — this is the one gate between a model's
 * output and anything being persisted as a draft. Mirrors the exact shape
 * the Interactive Lesson engine already reads (interactive-lesson.types.ts)
 * so a validated draft is guaranteed compatible with that generic engine
 * with no translation step needed later.
 */

const VALID_STEP_TYPES: TeachingStepType[] = ["INTRO", "EXPLAIN", "EXAMPLE", "CHECK", "REVIEW", "COMPLETE"];
const VALID_CHECK_TYPES = ["conceptual", "applied"];
const VALID_VISUAL_TYPES = ["VISUALIZE_LEARNING", "QUIZ", "COMIC", "VERSUS", "CYCLE"];
const ALLOWED_STEP_KEYS = new Set(["id", "type", "order", "objective", "conceptKey", "concepts", "checkType", "required", "visual"]);
const ALLOWED_VISUAL_KEYS = new Set(["type", "status", "prompt", "url"]);
const MIN_STEPS = 4;
const MAX_STEPS = 10;
/** Hard ceiling for grounded auto lessons whose limit scales with concept count (see maxStepsForConceptCount). */
export const ABSOLUTE_MAX_STEPS = 30;

export interface LessonDraftValidationResult {
  valid: boolean;
  steps?: TeachingStep[];
  errors: string[];
}

export function validateLessonDraft(raw: unknown, expected: { topicNameEn: string; maxSteps?: number }): LessonDraftValidationResult {
  const maxSteps = Math.min(Math.max(expected.maxSteps ?? MAX_STEPS, MAX_STEPS), ABSOLUTE_MAX_STEPS);
  const errors: string[] = [];

  if (!raw || typeof raw !== "object") {
    return { valid: false, errors: ["Response is not a JSON object."] };
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.topicNameEn !== "string" || !obj.topicNameEn.trim()) {
    errors.push("Missing or empty topicNameEn.");
  } else if (obj.topicNameEn.trim().toLowerCase() !== expected.topicNameEn.trim().toLowerCase()) {
    errors.push(`topicNameEn mismatch: expected "${expected.topicNameEn}", got "${obj.topicNameEn}".`);
  }

  if (!Array.isArray(obj.steps)) {
    errors.push("Missing steps array.");
    return { valid: false, errors };
  }
  const rawSteps = obj.steps as unknown[];

  if (rawSteps.length < MIN_STEPS || rawSteps.length > maxSteps) {
    errors.push(`Step count ${rawSteps.length} outside allowed range [${MIN_STEPS}, ${maxSteps}].`);
  }

  const seenIds = new Set<string>();
  const steps: TeachingStep[] = [];
  let hasTeachingStep = false;
  let hasCheck = false;

  rawSteps.forEach((rawStep, index) => {
    if (!rawStep || typeof rawStep !== "object") {
      errors.push(`Step at index ${index} is not an object.`);
      return;
    }
    const step = rawStep as Record<string, unknown>;

    const unexpectedKeys = Object.keys(step).filter((k) => !ALLOWED_STEP_KEYS.has(k));
    if (unexpectedKeys.length > 0) {
      errors.push(`Step at index ${index} has unexpected fields: ${unexpectedKeys.join(", ")}.`);
    }

    if (typeof step.id !== "string" || !step.id.trim()) {
      errors.push(`Step at index ${index} has an invalid id.`);
    } else if (seenIds.has(step.id)) {
      errors.push(`Duplicate step id "${step.id}".`);
    } else {
      seenIds.add(step.id);
    }

    if (typeof step.type !== "string" || !VALID_STEP_TYPES.includes(step.type as TeachingStepType)) {
      errors.push(`Step at index ${index} has an unsupported type "${String(step.type)}".`);
    } else {
      if (step.type === "EXPLAIN" || step.type === "EXAMPLE") hasTeachingStep = true;
      if (step.type === "CHECK") hasCheck = true;
    }

    if (typeof step.order !== "number" || step.order !== index + 1) {
      errors.push(`Step at index ${index} has order ${JSON.stringify(step.order)}, expected ${index + 1} (matching array position).`);
    }

    if (typeof step.objective !== "string" || !step.objective.trim()) {
      errors.push(`Step at index ${index} has an empty objective.`);
    }

    if (step.conceptKey !== undefined && (typeof step.conceptKey !== "string" || !step.conceptKey.trim())) {
      errors.push(`Step at index ${index} has an invalid conceptKey.`);
    }

    if (
      step.concepts !== undefined &&
      (!Array.isArray(step.concepts) || step.concepts.some((c) => typeof c !== "string" || !c.trim()))
    ) {
      errors.push(`Step at index ${index} has an invalid concepts field (must be an array of non-empty concept names).`);
    }

    if (step.checkType !== undefined && !VALID_CHECK_TYPES.includes(step.checkType as string)) {
      errors.push(`Step at index ${index} has an unsupported checkType "${String(step.checkType)}".`);
    }

    if (step.required !== undefined && typeof step.required !== "boolean") {
      errors.push(`Step at index ${index} has a non-boolean required field.`);
    }

    if (step.visual !== undefined) {
      if (!step.visual || typeof step.visual !== "object") {
        errors.push(`Step at index ${index} has an invalid visual field.`);
      } else {
        const visual = step.visual as Record<string, unknown>;
        const unexpectedVisualKeys = Object.keys(visual).filter((k) => !ALLOWED_VISUAL_KEYS.has(k));
        if (unexpectedVisualKeys.length > 0) {
          errors.push(`Step at index ${index} visual has unexpected fields: ${unexpectedVisualKeys.join(", ")}.`);
        }
        if (typeof visual.type !== "string" || !VALID_VISUAL_TYPES.includes(visual.type)) {
          errors.push(`Step at index ${index} visual has an unsupported type.`);
        }
        // Safety net: a draft must never claim an image already exists —
        // Phase 5 is content-planning only, no image generation call is
        // ever made here.
        if (visual.status !== "NOT_GENERATED") {
          errors.push(`Step at index ${index} visual status must be "NOT_GENERATED" at draft stage, got ${JSON.stringify(visual.status)}.`);
        }
        if (typeof visual.prompt !== "string" || !visual.prompt.trim()) {
          errors.push(`Step at index ${index} visual is missing a prompt.`);
        }
        if (visual.url !== null) {
          errors.push(`Step at index ${index} visual url must be null at draft stage.`);
        }
      }
    }

    steps.push(step as unknown as TeachingStep);
  });

  if (!hasTeachingStep) errors.push("Draft has no EXPLAIN/EXAMPLE (teaching) step.");
  if (!hasCheck) errors.push("Draft has no CHECK step.");

  if (rawSteps.length > 0) {
    const last = rawSteps[rawSteps.length - 1] as Record<string, unknown> | undefined;
    if (!last || last.type !== "COMPLETE") {
      errors.push("The last step must be of type COMPLETE.");
    }
  }

  return { valid: errors.length === 0, steps: errors.length === 0 ? steps : undefined, errors };
}

const MIN_AUTO_OBJECTIVES = 2;
const MAX_AUTO_OBJECTIVES = 6;

export interface AutoLessonValidationResult {
  valid: boolean;
  steps?: TeachingStep[];
  objectives?: Array<{ objectiveEn: string; objectiveAr: string }>;
  errors: string[];
}

/**
 * Launch-speed lazy-generation path (2026-09-18): same step validation as
 * validateLessonDraft above, plus validation of the AI-proposed bilingual
 * `learningObjectives` array (a field the human-reviewed pipeline never
 * lets the AI supply — see BilingualObjective's doc comment). Kept as a
 * separate function rather than a flag on validateLessonDraft so the
 * original, heavily-relied-on validator's behavior can never be
 * accidentally changed by this addition.
 */
export function validateAutoLessonDraft(raw: unknown, expected: { topicNameEn: string; maxSteps?: number }): AutoLessonValidationResult {
  const stepResult = validateLessonDraft(raw, expected);
  const errors = [...stepResult.errors];

  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawObjectives = obj.learningObjectives;

  let objectives: Array<{ objectiveEn: string; objectiveAr: string }> | undefined;
  if (!Array.isArray(rawObjectives)) {
    errors.push("Missing learningObjectives array.");
  } else if (rawObjectives.length < MIN_AUTO_OBJECTIVES || rawObjectives.length > MAX_AUTO_OBJECTIVES) {
    errors.push(`learningObjectives count ${rawObjectives.length} outside allowed range [${MIN_AUTO_OBJECTIVES}, ${MAX_AUTO_OBJECTIVES}].`);
  } else {
    const parsed: Array<{ objectiveEn: string; objectiveAr: string }> = [];
    rawObjectives.forEach((entry, index) => {
      if (!entry || typeof entry !== "object") {
        errors.push(`learningObjectives[${index}] is not an object.`);
        return;
      }
      const e = entry as Record<string, unknown>;
      const objectiveEn = typeof e.objectiveEn === "string" ? e.objectiveEn.trim() : "";
      const objectiveAr = typeof e.objectiveAr === "string" ? e.objectiveAr.trim() : "";
      if (!objectiveEn) errors.push(`learningObjectives[${index}] is missing a non-empty objectiveEn.`);
      if (!objectiveAr) errors.push(`learningObjectives[${index}] is missing a non-empty objectiveAr.`);
      if (objectiveEn && objectiveAr) parsed.push({ objectiveEn, objectiveAr });
    });
    if (errors.length === 0) objectives = parsed;
  }

  return {
    valid: errors.length === 0,
    steps: errors.length === 0 ? stepResult.steps : undefined,
    objectives: errors.length === 0 ? objectives : undefined,
    errors,
  };
}

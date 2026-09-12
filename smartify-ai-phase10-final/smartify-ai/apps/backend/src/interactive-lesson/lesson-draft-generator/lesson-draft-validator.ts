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
const ALLOWED_STEP_KEYS = new Set(["id", "type", "order", "objective", "conceptKey", "checkType", "required", "visual"]);
const ALLOWED_VISUAL_KEYS = new Set(["type", "status", "prompt", "url"]);
const MIN_STEPS = 4;
const MAX_STEPS = 10;

export interface LessonDraftValidationResult {
  valid: boolean;
  steps?: TeachingStep[];
  errors: string[];
}

export function validateLessonDraft(raw: unknown, expected: { topicNameEn: string }): LessonDraftValidationResult {
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

  if (rawSteps.length < MIN_STEPS || rawSteps.length > MAX_STEPS) {
    errors.push(`Step count ${rawSteps.length} outside allowed range [${MIN_STEPS}, ${MAX_STEPS}].`);
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

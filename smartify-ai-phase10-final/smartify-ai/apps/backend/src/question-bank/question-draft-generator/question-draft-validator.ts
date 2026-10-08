/**
 * Phase 10E: deterministic structural/content validator for the Question
 * Bank draft pipeline. Raw AI JSON (once a real generator is wired up in a
 * later phase) is NEVER trusted directly, and neither is an already-
 * persisted draft at approve() time — this is the one gate between
 * QuestionDraft content and a real, gradeable Question row.
 *
 * CANONICAL EXACT-MATCH ANSWER CONTRACT (Section O): Practice, Quiz, and
 * Diagnostic all grade with the exact same primitive —
 * `JSON.stringify(question.correctAnswerJson) === JSON.stringify(submittedAnswer)`
 * — with zero normalization (no trim, no case-fold, no synonym matching).
 * A Question type is only "MVP-ready" here if that primitive can reliably
 * grade it AND the current frontend actually renders an input capable of
 * producing a matching answer. Checking the three student-facing pages
 * (practice/page.tsx, quizzes/page.tsx, onboarding/diagnostic/page.tsx)
 * shows they ALL render only `optionsJson.map(...) -> <input type="radio">`
 * — there is no free-text, true/false-toggle, matching, or multi-step input
 * anywhere in the runtime today. That is a fact about the current build,
 * not a guess, and it is why only MULTIPLE_CHOICE and TRUE_FALSE are
 * MVP-ready:
 *   - MULTIPLE_CHOICE: correctAnswerJson is a single string that exactly
 *     equals one entry of optionsJson (>= 3 options, no duplicates).
 *   - TRUE_FALSE: modeled as a constrained 2-option MULTIPLE_CHOICE
 *     (optionsJson has exactly 2 unique strings, e.g. ["True","False"] or
 *     ["صح","خطأ"]) so it reuses the exact same radio-option UI and
 *     exact-match grading path honestly, rather than inventing a dedicated
 *     boolean input the runtime doesn't have.
 * SHORT_ANSWER, FILL_BLANK, MATCHING, and STEP_PROBLEM are flagged NOT
 * READY FOR MVP — free-text/multi-step grading against unnormalized
 * exact-match would be unreliable, and there is no input UI for them at
 * all today. Making one of these "work" here would mean inventing
 * behavior the runtime cannot actually deliver — exactly what this
 * validator must not do.
 */

const MVP_READY_TYPES = new Set(["MULTIPLE_CHOICE", "TRUE_FALSE"]);
const ALL_KNOWN_TYPES = new Set(["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "FILL_BLANK", "MATCHING", "STEP_PROBLEM"]);
const VALID_DIFFICULTIES = new Set(["EASY", "MEDIUM", "HARD"]);
// A true multiple-choice question needs enough distractors to be a real
// choice, not a disguised true/false — 3 matches the existing placeholder
// seed data's own convention.
const MIN_MCQ_OPTIONS = 3;

export interface QuestionDraftValidationContext {
  /** Resolved live from the DB by the caller — this function stays a pure, deterministic, DB-free validator (same convention as validateLessonDraft). */
  topicExists: boolean;
  /** true if the target Topic has no non-placeholder Lesson — the same relational signal LessonPublishService/Question already use, never a name-string check. */
  topicIsPlaceholder: boolean;
  /**
   * false during initial AI-generation structural validation (before any
   * human review — promptAr/explanationEn are not required yet, matching
   * "AI-generated Arabic/content is never auto-trusted"). true at
   * approve() time, when required human-reviewed content must be present.
   */
  requireReviewedContent: boolean;
  /** Lazy-published question batches need Arabic choice labels for Arabic-first subjects. */
  requireArabicOptions?: boolean;
}

export interface QuestionDraftValidationResult {
  valid: boolean;
  errors: string[];
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export function validateQuestionDraft(raw: unknown, context: QuestionDraftValidationContext): QuestionDraftValidationResult {
  const errors: string[] = [];

  if (!raw || typeof raw !== "object") {
    return { valid: false, errors: ["Draft is not a JSON object."] };
  }
  const draft = raw as Record<string, unknown>;

  // ---- GENERAL ----
  if (!context.topicExists) {
    errors.push("Target Topic does not exist.");
  } else if (context.topicIsPlaceholder) {
    errors.push("Target Topic is a placeholder Topic (has no non-placeholder Lesson) and cannot receive a publishable Question draft.");
  }

  const type = typeof draft.type === "string" ? draft.type : undefined;
  if (!type || !ALL_KNOWN_TYPES.has(type)) {
    errors.push(`Unsupported QuestionType "${String(draft.type)}".`);
  } else if (!MVP_READY_TYPES.has(type)) {
    errors.push(`QuestionType "${type}" is NOT READY FOR MVP — the current runtime has no input UI and no reliable exact-match grading path for it. Only MULTIPLE_CHOICE and TRUE_FALSE are supported today.`);
  }

  const difficulty = typeof draft.difficulty === "string" ? draft.difficulty : undefined;
  if (!difficulty || !VALID_DIFFICULTIES.has(difficulty)) {
    errors.push(`Unsupported Difficulty "${String(draft.difficulty)}".`);
  }

  if (!isNonEmptyString(draft.promptEn)) {
    errors.push("Missing or empty promptEn.");
  }

  if (draft.correctAnswerJson === undefined || draft.correctAnswerJson === null) {
    errors.push("Missing correctAnswerJson.");
  } else {
    try {
      JSON.stringify(draft.correctAnswerJson);
    } catch {
      errors.push("correctAnswerJson is not structurally valid JSON.");
    }
  }

  if (context.requireArabicOptions && (typeof draft.promptAr !== "string" || !/\p{Script=Arabic}/u.test(draft.promptAr))) {
    errors.push("Automatically published question batches must include a real Arabic promptAr.");
  }

  if (context.requireReviewedContent) {
    if (!isNonEmptyString(draft.promptAr)) {
      errors.push("Missing or empty human-reviewed promptAr — required bilingual prompts.");
    }
    // MVP policy (Section D): explanationEn is required because Practice
    // and Quiz both surface it directly to the student as post-answer
    // feedback (see practice/page.tsx, quizzes/page.tsx). explanationAr is
    // NOT required — the frontend does not render it anywhere today, so
    // gating on it would block real content for a field nothing reads yet.
    if (!isNonEmptyString(draft.explanationEn)) {
      errors.push("Missing or empty human-reviewed explanationEn.");
    }
  }

  // Type-specific checks only make sense once we know the type is at least
  // recognized and MVP-ready — an unsupported type already failed above,
  // and piling on fabricated option/answer errors for it would obscure the
  // real problem rather than "fail safely".
  if (type && MVP_READY_TYPES.has(type)) {
    validateOptionsAndAnswer(draft, type, errors, context.requireArabicOptions === true);
  }

  return { valid: errors.length === 0, errors };
}

function validateOptionsAndAnswer(draft: Record<string, unknown>, type: string, errors: string[], requireArabicOptions: boolean) {
  const rawOptions = draft.optionsJson;
  if (!Array.isArray(rawOptions)) {
    errors.push("optionsJson must be an array for MULTIPLE_CHOICE/TRUE_FALSE.");
    return;
  }
  if (!rawOptions.every(isNonEmptyString)) {
    errors.push("All options must be non-empty strings.");
    return;
  }
  const options = rawOptions as string[];

  const rawOptionsAr = draft.optionsAr;
  if (requireArabicOptions && !Array.isArray(rawOptionsAr)) {
    errors.push("optionsAr must be an Arabic string array for automatically published question batches.");
  } else if (rawOptionsAr !== undefined && rawOptionsAr !== null) {
    if (!Array.isArray(rawOptionsAr) || !rawOptionsAr.every((option) => isNonEmptyString(option) &&
      (/\p{Script=Arabic}/u.test(option) || /^[\d٠-٩۰-۹\s.,%+\-]+$/u.test(option)))) {
      errors.push("All optionsAr entries must be non-empty strings.");
    } else if (rawOptionsAr.length !== options.length) {
      errors.push(`optionsAr must have the same number of entries as optionsJson (${options.length}).`);
    }
  }

  const seen = new Set<string>();
  const duplicates = options.filter((o) => (seen.has(o) ? true : (seen.add(o), false)));
  if (duplicates.length > 0) {
    errors.push(`Duplicate options: ${[...new Set(duplicates)].join(", ")}.`);
  }

  if (type === "MULTIPLE_CHOICE" && options.length < MIN_MCQ_OPTIONS) {
    errors.push(`MULTIPLE_CHOICE requires at least ${MIN_MCQ_OPTIONS} options, got ${options.length}.`);
  }
  if (type === "TRUE_FALSE" && options.length !== 2) {
    errors.push(`TRUE_FALSE must have exactly 2 options, got ${options.length}.`);
  }

  if (typeof draft.correctAnswerJson !== "string") {
    errors.push(`correctAnswerJson must be a single string matching one option for ${type}.`);
  } else if (!options.includes(draft.correctAnswerJson)) {
    errors.push(`correctAnswerJson "${draft.correctAnswerJson}" does not exactly match any option.`);
  }
}

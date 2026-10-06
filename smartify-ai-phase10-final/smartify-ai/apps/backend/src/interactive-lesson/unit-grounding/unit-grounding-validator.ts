import type { RawGroundingNotes } from "./unit-grounding.types";

/**
 * Structural validation for the offline grounding-extraction model's
 * output. Mirrors lesson-draft-validator.ts's exact philosophy: raw AI
 * JSON is never trusted directly — this is the one gate between the
 * extraction model's response and anything being persisted as
 * Unit.groundingNotesJson. "Prefer extraction failed over storing bad
 * curriculum data that will contaminate every downstream Topic" (per the
 * spec that drove this feature) — so this is deliberately conservative:
 * on any doubt, reject rather than accept.
 */

const MIN_CORE_ITEMS = 1; // at least one real concept/objective — never an empty extraction
const MAX_ITEM_TEXT_LENGTH = 400; // a "not verbatim-copied" guard — a genuine original summary sentence is short; a suspiciously long single field suggests transcription

export interface GroundingValidationResult {
  valid: boolean;
  notes?: RawGroundingNotes;
  errors: string[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

// Page-provenance hotfix (2026-09-25): the model is never validated
// against an absolute page number — see unit-grounding.types.ts's
// RawGroundingNotes doc comment for why. `imageCount` is the exact
// number of images actually sent for this chunk; a valid
// sourceImageIndex is a non-empty array of 1-based integers, each
// referring to one of those images. Deliberately strict — 0, negatives,
// non-integers, out-of-range, and empty arrays are all rejected outright,
// never clamped or coerced, matching this validator's existing
// "prefer extraction failed over storing bad data" philosophy.
function isImageIndexArray(value: unknown, imageCount: number): value is number[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((v) => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= imageCount);
}

/**
 * The model may report the subject in the book's own language. A reported
 * subject is accepted only for THIS Subject's stored identity: the existing
 * English rule (case-insensitive substring of the English name's first word),
 * or an exact whitespace-normalized match of the stored Arabic name. The only
 * Arabic alias is a single leading definite article "ال" on either side
 * (observed: stored "الرياضيات", reported "رياضيات"). No fuzzy matching, no
 * translation; a missing nameAr keeps English-only behavior.
 */
export function subjectMatchesExpected(reported: string, subjectNameEn: string, subjectNameAr?: string | null): boolean {
  if (reported.toLowerCase().includes(subjectNameEn.toLowerCase().split(" ")[0])) return true;
  if (!subjectNameAr || !subjectNameAr.trim()) return false;
  const norm = (s: string) => s.trim().replace(/\s+/g, " ");
  const withoutArticle = (s: string) => (s.startsWith("ال") ? s.slice(2) : s);
  const r = norm(reported), a = norm(subjectNameAr);
  return r === a || (withoutArticle(r) === withoutArticle(a) && withoutArticle(a).length > 0);
}

export function validateGroundingNotes(
  raw: unknown,
  expected: { unitNameEn: string; subjectNameEn: string; subjectNameAr?: string | null; imageCount: number },
): GroundingValidationResult {
  const errors: string[] = [];

  if (!raw || typeof raw !== "object") {
    return { valid: false, errors: ["Response is not a JSON object."] };
  }
  const obj = raw as Record<string, unknown>;

  // Sanity-check the model actually extracted THIS unit/subject, not a
  // hallucinated/unrelated one — loose (case-insensitive substring, not
  // exact match, since the model paraphrases titles) rather than strict,
  // matching the "conservative but not brittle" philosophy elsewhere in
  // this validator.
  if (typeof obj.subject !== "string" || !obj.subject.trim()) {
    errors.push("Missing subject.");
  } else if (!subjectMatchesExpected(obj.subject, expected.subjectNameEn, expected.subjectNameAr)) {
    errors.push(`subject "${obj.subject}" does not appear to match expected subject "${expected.subjectNameEn}" — possible unrelated-subject leakage.`);
  }

  if (typeof obj.unitTitle !== "string" || !obj.unitTitle.trim()) {
    errors.push("Missing unitTitle.");
  }

  const checkTextArrayField = (
    fieldName: string,
    value: unknown,
    extractText: (item: unknown) => string | undefined,
    requirePages: boolean,
  ) => {
    if (!Array.isArray(value)) {
      errors.push(`Missing ${fieldName} array.`);
      return;
    }
    value.forEach((item, index) => {
      const text = extractText(item);
      if (text === undefined) {
        errors.push(`${fieldName}[${index}] is missing its text field.`);
        return;
      }
      if (text.length > MAX_ITEM_TEXT_LENGTH) {
        errors.push(`${fieldName}[${index}] is implausibly long (${text.length} chars) — possible verbatim textbook copying, rejected.`);
      }
      if (requirePages && item && typeof item === "object") {
        const sourceImageIndex = (item as Record<string, unknown>).sourceImageIndex;
        if (!isImageIndexArray(sourceImageIndex, expected.imageCount)) {
          errors.push(`${fieldName}[${index}].sourceImageIndex is missing, empty, or references an image outside the sent range 1-${expected.imageCount}.`);
        }
      }
    });
  };

  if (!Array.isArray(obj.learningObjectives) || obj.learningObjectives.length < MIN_CORE_ITEMS) {
    errors.push("learningObjectives must be a non-empty array.");
  } else if (!isStringArray(obj.learningObjectives)) {
    errors.push("learningObjectives must be an array of strings.");
  } else {
    obj.learningObjectives.forEach((o, i) => {
      if (o.length > MAX_ITEM_TEXT_LENGTH) errors.push(`learningObjectives[${i}] is implausibly long — possible verbatim textbook copying, rejected.`);
    });
  }

  if (!Array.isArray(obj.concepts) || obj.concepts.length < MIN_CORE_ITEMS) {
    errors.push("concepts must be a non-empty array — this is the primary curriculum-grounding content.");
  } else {
    checkTextArrayField("concepts", obj.concepts, (item) => (item && typeof item === "object" ? (item as Record<string, unknown>).description as string | undefined : undefined), true);
  }

  checkTextArrayField("facts", obj.facts ?? [], (item) => (item && typeof item === "object" ? (item as Record<string, unknown>).fact as string | undefined : undefined), true);
  checkTextArrayField("vocabulary", obj.vocabulary ?? [], (item) => (item && typeof item === "object" ? (item as Record<string, unknown>).meaning as string | undefined : undefined), true);

  if (obj.skills !== undefined && !isStringArray(obj.skills)) errors.push("skills must be an array of strings.");
  if (obj.scopeNotes !== undefined && !isStringArray(obj.scopeNotes)) errors.push("scopeNotes must be an array of strings.");

  if (obj.topicHints !== undefined) {
    if (!Array.isArray(obj.topicHints)) {
      errors.push("topicHints must be an array.");
    } else {
      obj.topicHints.forEach((hint, index) => {
        if (!hint || typeof hint !== "object") {
          errors.push(`topicHints[${index}] is not an object.`);
          return;
        }
        const h = hint as Record<string, unknown>;
        if (typeof h.topicTitle !== "string" || !h.topicTitle.trim()) errors.push(`topicHints[${index}] is missing topicTitle.`);
        if (!isStringArray(h.relevantConcepts)) errors.push(`topicHints[${index}].relevantConcepts must be an array of strings.`);
      });
    }
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    errors: [],
    notes: {
      unitTitle: obj.unitTitle as string,
      gradeLevel: typeof obj.gradeLevel === "string" ? obj.gradeLevel : "",
      subject: obj.subject as string,
      learningObjectives: obj.learningObjectives as string[],
      concepts: obj.concepts as RawGroundingNotes["concepts"],
      facts: (obj.facts ?? []) as RawGroundingNotes["facts"],
      vocabulary: (obj.vocabulary ?? []) as RawGroundingNotes["vocabulary"],
      skills: (obj.skills ?? []) as string[],
      topicHints: (obj.topicHints ?? []) as RawGroundingNotes["topicHints"],
      scopeNotes: (obj.scopeNotes ?? []) as string[],
    },
  };
}

import type { TocExtractionResult, TocTopicCandidate, TocUnitCandidate } from "./toc-extraction.types";

/**
 * Structural validation for the TOC-extraction model's output. Mirrors
 * unit-grounding-validator.ts's exact philosophy: raw AI JSON is never
 * trusted directly — this is the one gate between the extraction model's
 * response and anything shown to an admin as a preview (and, at
 * confirmation time, the SAME gate is re-run server-side against the
 * admin-edited payload, so a tampered/corrupted client request can never
 * reach the database either). "Prefer extraction failed over showing a
 * garbled preview" — on any doubt, reject rather than accept.
 */

const MAX_NAME_LENGTH = 200; // mirrors updateSubjectSchema's own cap

export interface TocValidationResult {
  valid: boolean;
  result?: TocExtractionResult;
  errors: string[];
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function isValidName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_NAME_LENGTH;
}

function isValidPage(value: unknown, bounds: { min: number; max: number }): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= bounds.min && value <= bounds.max;
}

function validateTopic(raw: unknown, index: number, unitIndex: number, bounds: { min: number; max: number }, errors: string[]): TocTopicCandidate | null {
  if (!raw || typeof raw !== "object") {
    errors.push(`units[${unitIndex}].topics[${index}] is not an object.`);
    return null;
  }
  const t = raw as Record<string, unknown>;
  let ok = true;
  if (!isValidName(t.nameEn)) {
    errors.push(`units[${unitIndex}].topics[${index}].nameEn is missing, empty, or too long.`);
    ok = false;
  }
  if (!isValidName(t.nameAr)) {
    errors.push(`units[${unitIndex}].topics[${index}].nameAr is missing, empty, or too long.`);
    ok = false;
  }
  let sourcePageStart: number | undefined;
  let sourcePageEnd: number | undefined;
  if (t.sourcePageStart !== undefined || t.sourcePageEnd !== undefined) {
    if (!isValidPage(t.sourcePageStart, bounds) || !isValidPage(t.sourcePageEnd, bounds) || (t.sourcePageStart as number) > (t.sourcePageEnd as number)) {
      errors.push(`units[${unitIndex}].topics[${index}] has an invalid page range.`);
      ok = false;
    } else {
      sourcePageStart = t.sourcePageStart as number;
      sourcePageEnd = t.sourcePageEnd as number;
    }
  }
  if (!ok) return null;
  return { nameEn: (t.nameEn as string).trim(), nameAr: (t.nameAr as string).trim(), sourcePageStart, sourcePageEnd };
}

function validateUnit(raw: unknown, index: number, bounds: { min: number; max: number }, errors: string[]): TocUnitCandidate | null {
  if (!raw || typeof raw !== "object") {
    errors.push(`units[${index}] is not an object.`);
    return null;
  }
  const u = raw as Record<string, unknown>;
  let ok = true;

  if (!isValidName(u.nameEn)) {
    errors.push(`units[${index}].nameEn is missing, empty, or too long.`);
    ok = false;
  }
  if (!isValidName(u.nameAr)) {
    errors.push(`units[${index}].nameAr is missing, empty, or too long.`);
    ok = false;
  }
  if (!isValidPage(u.sourcePageStart, bounds) || !isValidPage(u.sourcePageEnd, bounds)) {
    errors.push(`units[${index}] has a missing or out-of-range page number (must be between ${bounds.min} and ${bounds.max}).`);
    ok = false;
  } else if ((u.sourcePageStart as number) > (u.sourcePageEnd as number)) {
    errors.push(`units[${index}].sourcePageStart (${u.sourcePageStart}) is after sourcePageEnd (${u.sourcePageEnd}).`);
    ok = false;
  }

  if (!Array.isArray(u.topics) || u.topics.length === 0) {
    errors.push(`units[${index}] must have at least one topic.`);
    ok = false;
  }

  if (!ok) {
    // Still validate topics for feedback completeness, but this unit is rejected regardless.
    if (Array.isArray(u.topics)) u.topics.forEach((t, i) => validateTopic(t, i, index, bounds, errors));
    return null;
  }

  const topics: TocTopicCandidate[] = [];
  const seenTopicNames = new Set<string>();
  let topicsOk = true;
  (u.topics as unknown[]).forEach((t, i) => {
    const validated = validateTopic(t, i, index, bounds, errors);
    if (!validated) {
      topicsOk = false;
      return;
    }
    const key = normalizeName(validated.nameEn);
    if (seenTopicNames.has(key)) {
      errors.push(`units[${index}].topics[${i}] ("${validated.nameEn}") duplicates another topic in the same unit.`);
      topicsOk = false;
      return;
    }
    seenTopicNames.add(key);
    topics.push(validated);
  });
  if (!topicsOk) return null;

  return {
    nameEn: (u.nameEn as string).trim(),
    nameAr: (u.nameAr as string).trim(),
    sourcePageStart: u.sourcePageStart as number,
    sourcePageEnd: u.sourcePageEnd as number,
    topics,
  };
}

export function validateTocExtraction(raw: unknown, expected: { pageBounds: { min: number; max: number } }): TocValidationResult {
  const errors: string[] = [];

  if (!raw || typeof raw !== "object") {
    return { valid: false, errors: ["Response is not a JSON object."] };
  }
  const obj = raw as Record<string, unknown>;

  if (!Array.isArray(obj.units)) {
    return { valid: false, errors: ["Missing units array."] };
  }
  if (obj.units.length === 0) {
    // Not a structural error — a legitimate "no TOC found in these pages"
    // signal. The caller decides whether to try another page window.
    return { valid: true, errors: [], result: { units: [] } };
  }

  const units: TocUnitCandidate[] = [];
  let unitsOk = true;
  let prevStart = -Infinity;
  const seenUnitNames = new Set<string>();

  obj.units.forEach((rawUnit, i) => {
    const validated = validateUnit(rawUnit, i, expected.pageBounds, errors);
    if (!validated) {
      unitsOk = false;
      return;
    }
    if (validated.sourcePageStart < prevStart) {
      errors.push(`units[${i}] ("${validated.nameEn}") is out of page order relative to the previous unit.`);
      unitsOk = false;
      return;
    }
    prevStart = validated.sourcePageStart;
    const key = normalizeName(validated.nameEn);
    if (seenUnitNames.has(key)) {
      errors.push(`units[${i}] ("${validated.nameEn}") duplicates another unit's name.`);
      unitsOk = false;
      return;
    }
    seenUnitNames.add(key);
    units.push(validated);
  });

  if (!unitsOk || errors.length > 0) return { valid: false, errors };
  return { valid: true, errors: [], result: { units } };
}

/**
 * Extra Book full-book structure-scan fallback (2026-09-20) — validates
 * ONE chunk's raw heading-detection JSON. Deliberately a much smaller
 * surface than toc-extraction-validator.ts: a chunk only ever reports
 * "these titles start on these PDF pages within the pages I was just
 * shown" — never a full Unit/Topic tree (that's assembled afterward, in
 * TocExtractionService, from every chunk's headings combined, and the
 * ASSEMBLED result is re-validated through the existing
 * validateTocExtraction — see spec section 8). "Prefer a rejected chunk
 * over a garbled heading" — same conservative philosophy as every other
 * validator in this codebase.
 */

const MAX_TITLE_LENGTH = 200; // mirrors toc-extraction-validator's own cap

export interface HeadingDetection {
  titleEn: string;
  titleAr: string;
  pdfPage: number;
}

export interface FullBookScanChunkValidationResult {
  valid: boolean;
  headings?: HeadingDetection[];
  errors: string[];
}

function isValidTitle(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_TITLE_LENGTH;
}

export function validateFullBookScanChunk(raw: unknown, expected: { pageBounds: { min: number; max: number } }): FullBookScanChunkValidationResult {
  if (!raw || typeof raw !== "object") {
    return { valid: false, errors: ["Response is not a JSON object."] };
  }
  const obj = raw as Record<string, unknown>;

  if (!Array.isArray(obj.headings)) {
    return { valid: false, errors: ["Missing headings array."] };
  }
  if (obj.headings.length === 0) {
    // Legitimate "nothing new starts in these pages" signal (e.g. mid-chapter continuation pages) — not an error.
    return { valid: true, errors: [], headings: [] };
  }

  const errors: string[] = [];
  const headings: HeadingDetection[] = [];

  obj.headings.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") {
      errors.push(`headings[${index}] is not an object.`);
      return;
    }
    const h = raw as Record<string, unknown>;
    let ok = true;
    if (!isValidTitle(h.titleEn)) {
      errors.push(`headings[${index}].titleEn is missing, empty, or too long.`);
      ok = false;
    }
    if (!isValidTitle(h.titleAr)) {
      errors.push(`headings[${index}].titleAr is missing, empty, or too long.`);
      ok = false;
    }
    if (typeof h.pdfPage !== "number" || !Number.isInteger(h.pdfPage) || h.pdfPage < expected.pageBounds.min || h.pdfPage > expected.pageBounds.max) {
      errors.push(`headings[${index}].pdfPage is missing or outside the scanned range (${expected.pageBounds.min}-${expected.pageBounds.max}).`);
      ok = false;
    }
    if (!ok) return;
    headings.push({ titleEn: (h.titleEn as string).trim(), titleAr: (h.titleAr as string).trim(), pdfPage: h.pdfPage as number });
  });

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, errors: [], headings };
}

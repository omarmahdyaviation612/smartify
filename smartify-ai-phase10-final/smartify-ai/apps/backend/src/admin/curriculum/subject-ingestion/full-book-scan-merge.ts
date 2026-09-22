import type { HeadingDetection } from "./full-book-scan-validator";
import type { TocExtractionResult } from "./toc-extraction.types";

/**
 * Extra Book full-book structure-scan fallback (2026-09-20) — turns the
 * flat list of chapter/section-start detections gathered across every
 * scanned chunk (see TocExtractionService.fullBookStructureScan) into the
 * same Unit/Topic shape a fast TOC extraction would have produced.
 *
 * Each detected section becomes its own UNIT (a chapter is Unit-sized
 * content, exactly like a normal textbook's TOC-derived Units), with
 * exactly ONE Topic mirroring the Unit's own title — the same "no visible
 * sub-sections" convention buildTocExtractionPrompt already uses ("If the
 * TOC lists a chapter with no visible sub-sections, create one Topic for
 * it using the same title as the Unit"). This fallback does not attempt
 * to detect finer-grained sub-topics within a chapter — out of scope.
 *
 * Deduplication: collapses ADJACENT (in page order) detections whose
 * title normalizes the same — the exact pattern of a running header/
 * footer repeated across consecutive pages/chunks despite the prompt's
 * own instruction not to re-report it. A title that legitimately repeats
 * much later (separated by other distinct sections) is NOT collapsed —
 * that would hide a real, if unusually named, section.
 *
 * Page ranges are inferred purely from consecutive detected start pages:
 * Unit[i].sourcePageEnd = Unit[i+1].sourcePageStart - 1, and the LAST
 * Unit's sourcePageEnd = pdfPageCount (the real, independently-derived
 * page count — never a guess).
 */
export function mergeHeadingsIntoUnits(headings: HeadingDetection[], pdfPageCount: number): TocExtractionResult {
  const sorted = [...headings].sort((a, b) => a.pdfPage - b.pdfPage);

  const deduped: HeadingDetection[] = [];
  for (const heading of sorted) {
    const prev = deduped[deduped.length - 1];
    const normalized = heading.titleEn.trim().toLowerCase();
    if (prev && prev.titleEn.trim().toLowerCase() === normalized) continue; // adjacent duplicate — running header, keep the earlier (first) occurrence
    deduped.push(heading);
  }

  const units = deduped.map((heading, index) => {
    const sourcePageStart = heading.pdfPage;
    const sourcePageEnd = index < deduped.length - 1 ? deduped[index + 1].pdfPage - 1 : pdfPageCount;
    return {
      nameEn: heading.titleEn,
      nameAr: heading.titleAr,
      sourcePageStart,
      sourcePageEnd,
      topics: [{ nameEn: heading.titleEn, nameAr: heading.titleAr }],
    };
  });

  return { units };
}

import { validateFullBookScanChunk } from "./full-book-scan-validator";

const BOUNDS = { pageBounds: { min: 21, max: 32 } };

describe("validateFullBookScanChunk", () => {
  it("accepts a well-formed heading list", () => {
    const result = validateFullBookScanChunk({ headings: [{ titleEn: "Chapter 3", titleAr: "الفصل 3", pdfPage: 24 }] }, BOUNDS);
    expect(result.valid).toBe(true);
    expect(result.headings).toEqual([{ titleEn: "Chapter 3", titleAr: "الفصل 3", pdfPage: 24 }]);
  });

  it("treats an empty headings array as valid (nothing new starts in this chunk)", () => {
    const result = validateFullBookScanChunk({ headings: [] }, BOUNDS);
    expect(result.valid).toBe(true);
    expect(result.headings).toEqual([]);
  });

  it("rejects a non-object response", () => {
    expect(validateFullBookScanChunk("nope", BOUNDS).valid).toBe(false);
    expect(validateFullBookScanChunk(null, BOUNDS).valid).toBe(false);
  });

  it("rejects a missing headings field", () => {
    const result = validateFullBookScanChunk({}, BOUNDS);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/Missing headings array/);
  });

  it("rejects a heading with an empty or missing titleEn/titleAr", () => {
    expect(validateFullBookScanChunk({ headings: [{ titleEn: "", titleAr: "x", pdfPage: 24 }] }, BOUNDS).valid).toBe(false);
    expect(validateFullBookScanChunk({ headings: [{ titleAr: "x", pdfPage: 24 }] }, BOUNDS).valid).toBe(false);
  });

  it("rejects a heading whose pdfPage is outside the given chunk bounds — this is the fallback's OWN chunk range, not the whole document", () => {
    expect(validateFullBookScanChunk({ headings: [{ titleEn: "T", titleAr: "ت", pdfPage: 5 }] }, BOUNDS).valid).toBe(false);
    expect(validateFullBookScanChunk({ headings: [{ titleEn: "T", titleAr: "ت", pdfPage: 40 }] }, BOUNDS).valid).toBe(false);
  });

  it("rejects a non-integer or missing pdfPage", () => {
    expect(validateFullBookScanChunk({ headings: [{ titleEn: "T", titleAr: "ت", pdfPage: 24.5 }] }, BOUNDS).valid).toBe(false);
    expect(validateFullBookScanChunk({ headings: [{ titleEn: "T", titleAr: "ت" }] }, BOUNDS).valid).toBe(false);
  });

  it("accepts multiple valid headings in one chunk", () => {
    const result = validateFullBookScanChunk(
      { headings: [{ titleEn: "A", titleAr: "أ", pdfPage: 22 }, { titleEn: "B", titleAr: "ب", pdfPage: 28 }] },
      BOUNDS,
    );
    expect(result.valid).toBe(true);
    expect(result.headings).toHaveLength(2);
  });
});

import { validateTocExtraction } from "./toc-extraction-validator";

const BOUNDS = { pageBounds: { min: 1, max: 300 } };

function validUnit(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    nameEn: "Plant parts",
    nameAr: "أجزاء النبات",
    sourcePageStart: 10,
    sourcePageEnd: 20,
    topics: [{ nameEn: "Roots", nameAr: "الجذور" }],
    ...overrides,
  };
}

describe("validateTocExtraction", () => {
  it("accepts a well-formed structure with multiple units and topics", () => {
    const raw = {
      units: [
        validUnit({ nameEn: "Unit 1", sourcePageStart: 10, sourcePageEnd: 20 }),
        validUnit({
          nameEn: "Unit 2",
          sourcePageStart: 21,
          sourcePageEnd: 35,
          topics: [
            { nameEn: "Topic A", nameAr: "أ" },
            { nameEn: "Topic B", nameAr: "ب", sourcePageStart: 25, sourcePageEnd: 30 },
          ],
        }),
      ],
    };
    const result = validateTocExtraction(raw, BOUNDS);
    expect(result.valid).toBe(true);
    expect(result.result?.units).toHaveLength(2);
    expect(result.result?.units[1].topics).toHaveLength(2);
    expect(result.result?.units[1].topics[1].sourcePageStart).toBe(25);
  });

  it("treats a genuinely empty units array as valid (no TOC found in this window) — not a structural error", () => {
    const result = validateTocExtraction({ units: [] }, BOUNDS);
    expect(result.valid).toBe(true);
    expect(result.result?.units).toEqual([]);
  });

  it("rejects a non-object response", () => {
    expect(validateTocExtraction("not an object", BOUNDS).valid).toBe(false);
    expect(validateTocExtraction(null, BOUNDS).valid).toBe(false);
    expect(validateTocExtraction([1, 2, 3], BOUNDS).valid).toBe(false);
  });

  it("rejects a missing units field", () => {
    const result = validateTocExtraction({ foo: "bar" }, BOUNDS);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/Missing units array/);
  });

  it("rejects a unit with an empty nameEn or nameAr", () => {
    expect(validateTocExtraction({ units: [validUnit({ nameEn: "" })] }, BOUNDS).valid).toBe(false);
    expect(validateTocExtraction({ units: [validUnit({ nameAr: "" })] }, BOUNDS).valid).toBe(false);
  });

  it("rejects a unit with an implausibly long name", () => {
    const result = validateTocExtraction({ units: [validUnit({ nameEn: "x".repeat(201) })] }, BOUNDS);
    expect(result.valid).toBe(false);
  });

  it("rejects a unit with no topics", () => {
    const result = validateTocExtraction({ units: [validUnit({ topics: [] })] }, BOUNDS);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/at least one topic/);
  });

  it("rejects a unit with a non-positive or non-integer page number", () => {
    expect(validateTocExtraction({ units: [validUnit({ sourcePageStart: 0 })] }, BOUNDS).valid).toBe(false);
    expect(validateTocExtraction({ units: [validUnit({ sourcePageStart: 1.5 })] }, BOUNDS).valid).toBe(false);
    expect(validateTocExtraction({ units: [validUnit({ sourcePageStart: -3 })] }, BOUNDS).valid).toBe(false);
  });

  it("rejects a unit whose page range is out of the given bounds", () => {
    const result = validateTocExtraction({ units: [validUnit({ sourcePageEnd: 500 })] }, { pageBounds: { min: 1, max: 300 } });
    expect(result.valid).toBe(false);
  });

  it("rejects a unit whose start page is after its end page", () => {
    const result = validateTocExtraction({ units: [validUnit({ sourcePageStart: 30, sourcePageEnd: 10 })] }, BOUNDS);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/after sourcePageEnd/);
  });

  it("rejects units that are out of page order", () => {
    const raw = {
      units: [
        validUnit({ nameEn: "Unit 1", sourcePageStart: 50, sourcePageEnd: 60 }),
        validUnit({ nameEn: "Unit 2", sourcePageStart: 10, sourcePageEnd: 20 }),
      ],
    };
    const result = validateTocExtraction(raw, BOUNDS);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/out of page order/);
  });

  it("rejects duplicate unit names (case/whitespace-insensitive)", () => {
    const raw = {
      units: [
        validUnit({ nameEn: "Plant Parts", sourcePageStart: 10, sourcePageEnd: 20 }),
        validUnit({ nameEn: "  plant parts  ", sourcePageStart: 21, sourcePageEnd: 30 }),
      ],
    };
    const result = validateTocExtraction(raw, BOUNDS);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/duplicates another unit/);
  });

  it("rejects duplicate topic names within the same unit", () => {
    const raw = {
      units: [
        validUnit({
          topics: [
            { nameEn: "Roots", nameAr: "الجذور" },
            { nameEn: "roots", nameAr: "الجذور 2" },
          ],
        }),
      ],
    };
    const result = validateTocExtraction(raw, BOUNDS);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/duplicates another topic/);
  });

  it("allows the SAME topic name to repeat across DIFFERENT units", () => {
    const raw = {
      units: [
        validUnit({ nameEn: "Unit 1", sourcePageStart: 10, sourcePageEnd: 20, topics: [{ nameEn: "Introduction", nameAr: "مقدمة" }] }),
        validUnit({ nameEn: "Unit 2", sourcePageStart: 21, sourcePageEnd: 30, topics: [{ nameEn: "Introduction", nameAr: "مقدمة" }] }),
      ],
    };
    const result = validateTocExtraction(raw, BOUNDS);
    expect(result.valid).toBe(true);
  });

  it("rejects a topic with an invalid optional page range", () => {
    const raw = { units: [validUnit({ topics: [{ nameEn: "Roots", nameAr: "الجذور", sourcePageStart: 15, sourcePageEnd: 12 }] })] };
    const result = validateTocExtraction(raw, BOUNDS);
    expect(result.valid).toBe(false);
  });

  it("accepts a topic with no page-range fields at all (optional)", () => {
    const raw = { units: [validUnit({ topics: [{ nameEn: "Roots", nameAr: "الجذور" }] })] };
    const result = validateTocExtraction(raw, BOUNDS);
    expect(result.valid).toBe(true);
    expect(result.result?.units[0].topics[0].sourcePageStart).toBeUndefined();
  });
});

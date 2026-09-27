import { validateGroundingNotes } from "./unit-grounding-validator";

function validNotes(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    unitTitle: "Plant parts",
    gradeLevel: "Year 5",
    subject: "Science",
    learningObjectives: ["Identify the main parts of a plant."],
    concepts: [{ name: "Roots", description: "Roots absorb water and nutrients from the soil.", sourceImageIndex: [1], importance: "core" }],
    facts: [{ fact: "Most plants have roots, a stem, leaves, and flowers.", sourceImageIndex: [2], importance: "core" }],
    vocabulary: [{ term: "Root", meaning: "The part of a plant that grows underground.", sourceImageIndex: [1] }],
    skills: ["Label a diagram of a plant."],
    topicHints: [{ topicTitle: "Plant parts", relevantConcepts: ["Roots"], sourceImageIndex: [1] }],
    scopeNotes: [],
    ...overrides,
  };
}

// Page-provenance hotfix (2026-09-25): `imageCount` is the exact number
// of images actually sent for this chunk — the validator bounds
// sourceImageIndex against 1..imageCount, never against a page range.
const expected = { unitNameEn: "Plant parts", subjectNameEn: "Science", imageCount: 2 };

describe("validateGroundingNotes", () => {
  it("accepts a well-formed extraction", () => {
    const result = validateGroundingNotes(validNotes(), expected);
    expect(result.valid).toBe(true);
    expect(result.notes?.concepts).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it("fails safely on malformed/non-object output", () => {
    expect(validateGroundingNotes("not json", expected).valid).toBe(false);
    expect(validateGroundingNotes(null, expected).valid).toBe(false);
    expect(validateGroundingNotes(undefined, expected).valid).toBe(false);
  });

  it("rejects an empty concepts array — this is the primary grounding content", () => {
    const result = validateGroundingNotes(validNotes({ concepts: [] }), expected);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("concepts must be a non-empty array"))).toBe(true);
  });

  it("rejects an empty learningObjectives array", () => {
    const result = validateGroundingNotes(validNotes({ learningObjectives: [] }), expected);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("learningObjectives"))).toBe(true);
  });

  it("rejects a sourceImageIndex value outside the sent image range — catches the model inventing/misreading a page number as an image index", () => {
    const notes = validNotes({ concepts: [{ name: "Roots", description: "Roots absorb water.", sourceImageIndex: [999], importance: "core" }] });
    const result = validateGroundingNotes(notes, expected);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("outside the sent range"))).toBe(true);
  });

  /**
   * Page-provenance hotfix (2026-09-25) — the exact production symptom:
   * the model reads a printed textbook page number (e.g. "12") off the
   * page image and reports it as sourceImageIndex instead of the ordinal
   * it was actually told ("Image 1"/"Image 2"). For a 2-image chunk this
   * must be rejected outright — 12 is never a valid ordinal here,
   * regardless of what's visibly printed on the page.
   */
  it("rejects a printed textbook page number (e.g. 12) merely because it appears on Image 1/2 — it is not a valid ordinal for a 2-image chunk", () => {
    const notes = validNotes({ concepts: [{ name: "Roots", description: "Roots absorb water.", sourceImageIndex: [12], importance: "core" }] });
    const result = validateGroundingNotes(notes, expected);
    expect(result.valid).toBe(false);
  });

  it("rejects sourceImageIndex: 0 — ordinals are 1-based, never 0", () => {
    const notes = validNotes({ concepts: [{ name: "Roots", description: "Roots absorb water.", sourceImageIndex: [0], importance: "core" }] });
    expect(validateGroundingNotes(notes, expected).valid).toBe(false);
  });

  it("rejects a negative sourceImageIndex", () => {
    const notes = validNotes({ concepts: [{ name: "Roots", description: "Roots absorb water.", sourceImageIndex: [-1], importance: "core" }] });
    expect(validateGroundingNotes(notes, expected).valid).toBe(false);
  });

  it("rejects a non-integer sourceImageIndex", () => {
    const notes = validNotes({ concepts: [{ name: "Roots", description: "Roots absorb water.", sourceImageIndex: [1.5], importance: "core" }] });
    expect(validateGroundingNotes(notes, expected).valid).toBe(false);
  });

  it("rejects an empty sourceImageIndex array — never silently treated as 'no provenance'", () => {
    const notes = validNotes({ concepts: [{ name: "Roots", description: "Roots absorb water.", sourceImageIndex: [], importance: "core" }] });
    expect(validateGroundingNotes(notes, expected).valid).toBe(false);
  });

  it("rejects a missing sourceImageIndex field entirely", () => {
    const notes = validNotes({ concepts: [{ name: "Roots", description: "Roots absorb water.", importance: "core" }] });
    expect(validateGroundingNotes(notes, expected).valid).toBe(false);
  });

  it("accepts every valid ordinal in a larger (5-image) chunk", () => {
    const wideExpected = { ...expected, imageCount: 5 };
    const notes = validNotes({ concepts: [{ name: "Roots", description: "Roots absorb water.", sourceImageIndex: [1, 3, 5], importance: "core" }] });
    expect(validateGroundingNotes(notes, wideExpected).valid).toBe(true);
  });

  it("rejects an implausibly long single field — a 'not verbatim-copied' guard against real textbook transcription", () => {
    const notes = validNotes({ concepts: [{ name: "Roots", description: "R".repeat(500), sourceImageIndex: [1], importance: "core" }] });
    const result = validateGroundingNotes(notes, expected);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("implausibly long"))).toBe(true);
  });

  it("rejects unrelated-subject leakage — a Science unit's extraction claiming to be Mathematics", () => {
    const result = validateGroundingNotes(validNotes({ subject: "Mathematics" }), expected);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("possible unrelated-subject leakage"))).toBe(true);
  });

  it("accepts subject wording that reasonably varies (case, articles) without flagging leakage", () => {
    const result = validateGroundingNotes(validNotes({ subject: "science" }), expected);
    expect(result.valid).toBe(true);
  });

  it("treats missing optional arrays (facts/vocabulary/skills/scopeNotes/topicHints) as empty rather than a hard failure", () => {
    const notes = validNotes();
    delete (notes as any).facts;
    delete (notes as any).vocabulary;
    delete (notes as any).skills;
    delete (notes as any).scopeNotes;
    delete (notes as any).topicHints;
    const result = validateGroundingNotes(notes, expected);
    expect(result.valid).toBe(true);
    expect(result.notes?.facts).toEqual([]);
  });
});

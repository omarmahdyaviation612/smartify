import { validateGroundingNotes } from "./unit-grounding-validator";

function validNotes(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    unitTitle: "Plant parts",
    gradeLevel: "Year 5",
    subject: "Science",
    learningObjectives: ["Identify the main parts of a plant."],
    concepts: [{ name: "Roots", description: "Roots absorb water and nutrients from the soil.", sourcePages: [8], importance: "core" }],
    facts: [{ fact: "Most plants have roots, a stem, leaves, and flowers.", sourcePages: [9], importance: "core" }],
    vocabulary: [{ term: "Root", meaning: "The part of a plant that grows underground.", sourcePages: [8] }],
    skills: ["Label a diagram of a plant."],
    topicHints: [{ topicTitle: "Plant parts", relevantConcepts: ["Roots"], sourcePages: [8] }],
    scopeNotes: [],
    ...overrides,
  };
}

const expected = { unitNameEn: "Plant parts", subjectNameEn: "Science", requestedPageRange: { start: 8, end: 17 } };

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

  it("rejects a sourcePages value outside the requested page range — catches the model inventing/misreading a page number", () => {
    const notes = validNotes({ concepts: [{ name: "Roots", description: "Roots absorb water.", sourcePages: [999], importance: "core" }] });
    const result = validateGroundingNotes(notes, expected);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("outside the requested range"))).toBe(true);
  });

  it("rejects an implausibly long single field — a 'not verbatim-copied' guard against real textbook transcription", () => {
    const notes = validNotes({ concepts: [{ name: "Roots", description: "R".repeat(500), sourcePages: [8], importance: "core" }] });
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

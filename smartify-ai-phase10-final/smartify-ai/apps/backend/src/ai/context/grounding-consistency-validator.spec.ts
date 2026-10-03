import { checkGroundingConsistency, singularVariant, verbFamily } from "./grounding-consistency-validator";
import type { GroundingSlice } from "../../interactive-lesson/unit-grounding/unit-grounding.types";

const slice: GroundingSlice = {
  matchedViaHint: true,
  learningObjectives: ["Identify the main parts of a plant."],
  concepts: [{ name: "Roots", description: "Roots absorb water and nutrients from the soil for the plant to use.", sourcePages: [8], importance: "core" }],
  facts: [],
  vocabulary: [{ term: "Root", meaning: "The underground part of a plant.", sourcePages: [8] }],
};

describe("checkGroundingConsistency", () => {
  it("passes generated content that references a grounding concept/term without copying it verbatim", () => {
    const errors = checkGroundingConsistency(["Let's learn about roots and why plants need them to drink water!"], slice);
    expect(errors).toEqual([]);
  });

  it("permits a reasonable analogy/enrichment absent from the grounding, as long as SOME grounding term is referenced somewhere", () => {
    const errors = checkGroundingConsistency(
      ["Roots are like drinking straws for a plant — they pull water up from the soil.", "What does a root do for a plant?"],
      slice,
    );
    expect(errors).toEqual([]);
  });

  it("flags verbatim copying of a grounding sentence — a real bug this guards against", () => {
    const errors = checkGroundingConsistency(["Roots absorb water and nutrients from the soil for the plant to use."], slice);
    expect(errors.some((e) => e.includes("verbatim"))).toBe(true);
  });

  it("flags wholesale drift — generated content unrelated to any grounding concept/term (e.g. a Science topic that generated Solar System content instead)", () => {
    const errors = checkGroundingConsistency(["Let's learn about the planets in our solar system!"], slice);
    expect(errors.some((e) => e.includes("does not reference any concept"))).toBe(true);
  });

  it("never flags anything when the grounding slice itself has no concepts/vocabulary to check against", () => {
    const emptySlice: GroundingSlice = { matchedViaHint: false, learningObjectives: [], concepts: [], facts: [], vocabulary: [] };
    const errors = checkGroundingConsistency(["Anything at all."], emptySlice);
    expect(errors).toEqual([]);
  });
});

describe("checkGroundingConsistency — conservative English plural anchors (2026-10-03)", () => {
  const anchorSlice = (names: string[], terms: string[] = []): GroundingSlice => ({
    matchedViaHint: false,
    learningObjectives: [],
    concepts: names.map((name) => ({ name, description: "", sourcePages: [1], importance: "core" as const })),
    facts: [],
    vocabulary: terms.map((term) => ({ term, meaning: "", sourcePages: [1] })),
  });
  const DRIFT = "does not reference any concept";

  // The real production case: Grade 5 Maths "Decimals to the Thousandths" — slice = concept "Decimals",
  // vocabulary "Fraction"/"Decimals"; the stored, on-topic lesson plan never says "decimals" or "fraction".
  const decimalsSlice = anchorSlice(["Decimals"], ["Fraction", "Decimals", "Fraction"]);
  const decimalsPlan = [
    "Introduce the topic of decimal numbers and their place values, focusing on the thousandths place.",
    "Explain the concept of place value in decimal numbers, emphasizing the significance of each digit, especially in the thousandths.",
    "Check student understanding of place value in decimal numbers through a conceptual question.",
    "Provide examples of adding and subtracting decimal numbers, demonstrating alignment of decimal points.",
    "Assess student ability to add and subtract decimal numbers with a practical exercise.",
    "Summarize the key points about decimal place value and operations, including rounding techniques.",
    "Conclude the lesson and encourage students to practice rounding decimal numbers.",
  ];

  it("accepts the production Decimals lesson plan that uses the singular 'decimal'", () => {
    expect(checkGroundingConsistency(decimalsPlan, decimalsSlice)).toEqual([]);
  });

  it.each([
    ["Operations", "Practise each operation step by step."],
    ["Methods", "Choose a method to solve the problem."],
    ["Properties", "Use the commutative property of addition."],
    ["Matches", "Find the match for each picture."],
    ["Boxes", "Draw a box around the answer."],
    ["Classes", "Sort the animals into one class."],
    ["Phases", "Describe one phase of the Moon."],
  ])("plural anchor %s accepts its regular singular as a whole word", (anchor, text) => {
    expect(checkGroundingConsistency([text], anchorSlice([anchor]))).toEqual([]);
  });

  it("the singular variant must be a WHOLE word — never a fragment of an unrelated longer word", () => {
    // "units" -> "unit" must not match inside "community"; "rates" -> "rate" must not match inside "separate".
    expect(checkGroundingConsistency(["Our community works together."], anchorSlice(["Units"])).some((e) => e.includes(DRIFT))).toBe(true);
    expect(checkGroundingConsistency(["Keep the groups separate."], anchorSlice(["Rates"])).some((e) => e.includes(DRIFT))).toBe(true);
  });

  it("unrelated content still fails", () => {
    expect(checkGroundingConsistency(["Let's learn about the planets in our solar system!"], decimalsSlice).some((e) => e.includes(DRIFT))).toBe(true);
    expect(checkGroundingConsistency(["Count the apples and add them together."], anchorSlice(["Fractions"])).some((e) => e.includes(DRIFT))).toBe(true);
  });

  it("no fuzzy matching: a different word sharing a prefix does not count", () => {
    // "decimals" -> "decimal" only; "decimate" / "decimeter" are not references.
    expect(checkGroundingConsistency(["The storm will decimate the crops.", "Measure in decimeters."], anchorSlice(["Decimals"])).some((e) => e.includes(DRIFT))).toBe(true);
  });

  it("verbatim-copy protection is unchanged", () => {
    const s = { ...decimalsSlice, facts: [{ fact: "A decimal point separates the whole number part from the fractional part.", sourcePages: [1], importance: "core" as const }] };
    const errors = checkGroundingConsistency(["A decimal point separates the whole number part from the fractional part."], s);
    expect(errors.some((e) => e.includes("verbatim"))).toBe(true);
  });

  it("existing substring behavior is unchanged (singular anchor still accepts plural text)", () => {
    expect(checkGroundingConsistency(["We study many fractions today."], anchorSlice(["Fraction"]))).toEqual([]);
  });

  it("singularVariant is limited to regular English plurals of ASCII words with 5+ letters", () => {
    expect(singularVariant("decimals")).toBe("decimal");
    expect(singularVariant("operations")).toBe("operation");
    expect(singularVariant("methods")).toBe("method");
    expect(singularVariant("properties")).toBe("property");
    expect(singularVariant("matches")).toBe("match");
    expect(singularVariant("classes")).toBe("class");
    expect(singularVariant("houses")).toBe("house");
    // never: non-plurals, short words, non-ASCII scripts
    for (const w of ["analysis", "status", "glass", "decimal", "sums", "maps", "صفات", "zakat", "élèves"]) expect(singularVariant(w)).toBeNull();
  });
});

describe("checkGroundingConsistency — opt-in English verb-family word forms (2026-10-03)", () => {
  const anchorSlice = (names: string[]): GroundingSlice => ({ matchedViaHint: false, learningObjectives: [], concepts: names.map((name) => ({ name, description: "", sourcePages: [1], importance: "core" as const })), facts: [], vocabulary: [] });
  const DRIFT = "does not reference any concept";
  const passes = (text: string, anchor: string, wordForms = true) => !checkGroundingConsistency([text], anchorSlice([anchor]), { wordForms }).some((e) => e.includes(DRIFT));

  it.each([
    ["Addition", ["Add 15 and 27.", "Tom adds the apples.", "The marbles were added together.", "Adding 5 gives 50.", "addition", "Two additions."]],
    ["Subtraction", ["Subtract 12 from 50.", "She subtracts the sold books.", "First 75 is subtracted.", "Subtracting gives 125.", "subtraction", "Two subtractions."]],
    ["Multiplication", ["Multiply 75 by 3.", "He multiplies the cost.", "The cost multiplied by 3.", "Multiplying gives 225.", "multiplication", "multiplications"]],
    ["Division", ["Divide 40 by 8.", "She divides the sweets.", "The cake is divided equally.", "Dividing gives 5.", "division", "divisions"]],
  ])("13-16: %s matches every form of its family", (anchor, texts) => {
    for (const t of texts as string[]) expect(passes(t, anchor)).toBe(true);
  });

  it("17: existing singular/plural behavior is unchanged with and without word forms", () => {
    for (const wf of [true, false]) {
      expect(passes("Read the decimal number.", "Decimals", wf)).toBe(true);
      expect(passes("We study many fractions today.", "Fraction", wf)).toBe(true);
      expect(passes("Use the commutative property.", "Properties", wf)).toBe(true);
    }
  });

  it("18/20/21: look-alikes never match (individual, multiple, multiples)", () => {
    expect(passes("Each individual student reads.", "Division")).toBe(false);
    expect(passes("Choose the multiple choice answer.", "Multiplication")).toBe(false);
    expect(passes("List the multiples of 5.", "Multiplication")).toBe(false);
  });

  it("19/22: the NEW word-form path never matches subdivision/additional (only the unchanged legacy substring rule does)", () => {
    for (const w of ["subdivision", "additional", "individual", "multiple", "multiples", "addend", "address", "dividend", "divisible"]) {
      for (const anchor of ["division", "addition", "multiplication", "subtraction"]) expect(verbFamily(anchor)).not.toContain(w);
    }
    // documented legacy behavior (substring), unchanged by this change and identical with/without word forms:
    expect(passes("A subdivision of land.", "Division", false)).toBe(true);
    expect(passes("An additional cost.", "Addition", false)).toBe(true);
  });

  it("23: unrelated educational text still fails", () => {
    expect(passes("Plants need sunlight and water to grow.", "Subtraction")).toBe(false);
    expect(passes("The Nile is the longest river in Egypt.", "Addition")).toBe(false);
  });

  it("24: general morphology only — no Topic/curriculum dictionary; irregular -ition nouns never yield short false verbs", () => {
    expect(verbFamily("classification")).toEqual(["classify", "classifies", "classified", "classifying"]);
    expect(verbFamily("decision")).toEqual(["decide", "decides", "decided", "deciding"]);
    expect(verbFamily("construction")).toEqual(["construct", "constructs", "constructed", "constructing"]);
    expect(verbFamily("addition")).toEqual(["add", "adds", "added", "adding"]);
    for (const w of ["partition", "petition", "position", "definition", "condition", "fraction", "decimals", "value", "add", "صفات", "multi-step"]) {
      if (w === "fraction") expect(verbFamily(w)).toEqual(["fract", "fracts", "fracted", "fracting"]); // harmless non-words, matched as whole words only
      else expect(verbFamily(w)).toEqual([]);
    }
  });

  it("default (no option) behavior is exactly the pre-change matcher: verb forms do NOT match", () => {
    expect(passes("Add 15 and 27.", "Addition", false)).toBe(false);
    expect(passes("Subtract 12 from 50.", "Subtraction", false)).toBe(false);
  });
});

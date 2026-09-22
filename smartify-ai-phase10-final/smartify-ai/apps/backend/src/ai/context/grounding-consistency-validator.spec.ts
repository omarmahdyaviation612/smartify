import { checkGroundingConsistency } from "./grounding-consistency-validator";
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

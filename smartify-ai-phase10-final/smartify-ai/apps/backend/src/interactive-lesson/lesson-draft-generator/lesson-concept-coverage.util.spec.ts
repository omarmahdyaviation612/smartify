import type { TeachingStep } from "../interactive-lesson.types";
import type { GroundingSlice } from "../unit-grounding/unit-grounding.types";
import { ensureConceptCoverage, findUncoveredConcepts, maxStepsForConceptCount } from "./lesson-concept-coverage.util";
import { validateLessonDraft } from "./lesson-draft-validator";

const concept = (name: string) => ({ name, description: `${name} description`, sourcePages: [1], importance: "core" as const });
const slice = (names: string[]): GroundingSlice => ({ learningObjectives: [], concepts: names.map(concept), facts: [], vocabulary: [], matchedViaHint: false });

const baseSteps = (): TeachingStep[] => [
  { id: "s1", type: "INTRO", order: 1, objective: "Intro" },
  { id: "s2", type: "EXPLAIN", order: 2, objective: "Explain the mouth", concepts: ["The Mouth"] },
  { id: "s3", type: "CHECK", order: 3, objective: "Check", checkType: "conceptual", concepts: ["The Mouth"] },
  { id: "s4", type: "REVIEW", order: 4, objective: "Review" },
  { id: "s5", type: "COMPLETE", order: 5, objective: "Done" },
];

describe("lesson concept coverage", () => {
  it("reports concepts no EXPLAIN/EXAMPLE step teaches (case/space-insensitive)", () => {
    const steps = baseSteps();
    steps[1].concepts = ["the  mouth"];
    expect(findUncoveredConcepts(steps, slice(["The Mouth", "Stomach", "Small intestine"]))).toEqual(["Stomach", "Small intestine"]);
  });

  it("a CHECK step alone does not count as teaching a concept", () => {
    const steps = baseSteps();
    steps[1].concepts = [];
    expect(findUncoveredConcepts(steps, slice(["The Mouth"]))).toEqual(["The Mouth"]);
  });

  it("inserts an EXPLAIN step per missing concept plus a CHECK, before REVIEW, and renumbers", () => {
    const { steps, insertedConcepts } = ensureConceptCoverage(baseSteps(), slice(["The Mouth", "Stomach", "Small intestine"]));
    expect(insertedConcepts).toEqual(["Stomach", "Small intestine"]);
    expect(steps.map((s) => s.type)).toEqual(["INTRO", "EXPLAIN", "CHECK", "EXPLAIN", "EXPLAIN", "CHECK", "REVIEW", "COMPLETE"]);
    expect(steps.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    expect(findUncoveredConcepts(steps, slice(["The Mouth", "Stomach", "Small intestine"]))).toEqual([]);
    // still passes the engine's structural validator
    expect(validateLessonDraft({ topicNameEn: "Digestion", steps }, { topicNameEn: "Digestion" }).valid).toBe(true);
  });

  it("rewrites claimed names to the slice spelling and drops unknown names", () => {
    const steps = baseSteps();
    steps[1].concepts = ["the mouth", "Invented concept"];
    const result = ensureConceptCoverage(steps, slice(["The Mouth"]));
    expect(result.insertedConcepts).toEqual([]);
    expect(result.steps[1].concepts).toEqual(["The Mouth"]);
  });

  it("is a no-op without grounding", () => {
    const steps = baseSteps();
    expect(ensureConceptCoverage(steps, null)).toEqual({ steps, insertedConcepts: [] });
  });

  it("scales the step limit with concept count, bounded to [10, 30]", () => {
    expect(maxStepsForConceptCount(1)).toBe(10);
    expect(maxStepsForConceptCount(6)).toBe(18);
    expect(maxStepsForConceptCount(40)).toBe(30);
  });

  it("validator accepts more than 10 steps only when a larger maxSteps is given", () => {
    const steps: TeachingStep[] = [
      { id: "s1", type: "INTRO", order: 1, objective: "Intro" },
      ...Array.from({ length: 10 }, (_, i) => ({ id: `e${i}`, type: "EXPLAIN" as const, order: i + 2, objective: "Explain", concepts: [`C${i}`] })),
      { id: "c1", type: "CHECK", order: 12, objective: "Check", checkType: "conceptual" },
      { id: "z", type: "COMPLETE", order: 13, objective: "Done" },
    ];
    expect(validateLessonDraft({ topicNameEn: "T", steps }, { topicNameEn: "T" }).valid).toBe(false);
    expect(validateLessonDraft({ topicNameEn: "T", steps }, { topicNameEn: "T", maxSteps: 18 }).valid).toBe(true);
  });

  it("validator rejects a malformed concepts field", () => {
    const steps = baseSteps() as any[];
    steps[1].concepts = "The Mouth";
    expect(validateLessonDraft({ topicNameEn: "T", steps }, { topicNameEn: "T" }).errors.join(" ")).toContain("invalid concepts field");
  });
});

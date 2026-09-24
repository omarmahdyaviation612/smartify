import { buildAdaptiveMathTeachingPlan } from "./adaptive-math-teaching.util";

describe("buildAdaptiveMathTeachingPlan", () => {
  it("starts with the curriculum method when there is no difficulty signal", () => {
    expect(buildAdaptiveMathTeachingPlan("Mathematics", [])).toMatchObject({ stage: "CURRICULUM_FIRST", method: null, difficultySignals: 0 });
  });

  it.each([
    "I don't understand.",
    "Can you explain that another way?",
    "أنا مش فاهم",
    "ممكن تشرحها بطريقة تانية؟",
  ])("treats %p as a first-difficulty signal", (content) => {
    expect(buildAdaptiveMathTeachingPlan("Mathematics", [{ role: "user", content }])).toMatchObject({ stage: "SIMPLIFY", difficultySignals: 1 });
  });

  it("uses a different representation after repeated incorrect answers, excluding a method that already failed", () => {
    const plan = buildAdaptiveMathTeachingPlan("Mathematics", [
      { role: "assistant", content: "Use a number line. Start at 7 and move back 3." },
      { role: "user", content: "3" },
      { role: "assistant", content: "Not quite. Try again." },
      { role: "user", content: "2" },
      { role: "assistant", content: "That is not correct. Here is another hint." },
    ]);
    if (!plan) throw new Error("Mathematics plan must exist");
    expect(plan).toMatchObject({ stage: "ALTERNATIVE_REPRESENTATION", difficultySignals: 2 });
    expect(plan.method).not.toBe("number line");
    expect(plan.avoidMethods).toContain("number line");
  });

  it("uses a very small concrete example and bridges back after repeated difficulty", () => {
    const plan = buildAdaptiveMathTeachingPlan("Mathematics", [
      { role: "user", content: "I don't understand" },
      { role: "assistant", content: "Try this hint." },
      { role: "user", content: "Still confused, please explain again" },
      { role: "assistant", content: "Not quite. Try again." },
      { role: "user", content: "I still don't get it" },
    ]);
    expect(plan).toMatchObject({ stage: "CONCRETE_BRIDGE", method: "very small concrete example" });
  });

  it("does not apply mathematics adaptation to another subject", () => {
    expect(buildAdaptiveMathTeachingPlan("Science", [{ role: "user", content: "I don't understand" }])).toBeNull();
  });
});

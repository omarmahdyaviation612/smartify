import { validateLessonDraft } from "./lesson-draft-validator";

function validDraft(overrides: Partial<{ steps: any[] }> = {}) {
  return {
    topicNameEn: "Addition with Zero",
    steps: overrides.steps ?? [
      { id: "s1", type: "INTRO", order: 1, objective: "Greet briefly and frame today's idea.", conceptKey: "greeting_framing" },
      { id: "s2", type: "EXPLAIN", order: 2, objective: "Explain that adding zero leaves a number unchanged.", conceptKey: "zero_rule" },
      { id: "s3", type: "CHECK", order: 3, objective: "Check the student understands the zero rule conceptually.", conceptKey: "zero_rule", checkType: "conceptual" },
      { id: "s4", type: "EXAMPLE", order: 4, objective: "Show one new applied example of adding zero.", conceptKey: "zero_rule" },
      { id: "s5", type: "CHECK", order: 5, objective: "Check the student can apply the zero rule themselves.", conceptKey: "zero_rule", checkType: "applied" },
      { id: "s6", type: "REVIEW", order: 6, objective: "Briefly recap the zero rule." },
      { id: "s7", type: "COMPLETE", order: 7, objective: "Acknowledge completion." },
    ],
  };
}

describe("validateLessonDraft", () => {
  it("1. accepts a valid generated draft", () => {
    const result = validateLessonDraft(validDraft(), { topicNameEn: "Addition with Zero" });
    expect(result.valid).toBe(true);
    expect(result.steps).toHaveLength(7);
    expect(result.errors).toEqual([]);
  });

  it("2. fails safely on malformed/non-object output", () => {
    expect(validateLessonDraft("not json", { topicNameEn: "x" }).valid).toBe(false);
    expect(validateLessonDraft(null, { topicNameEn: "x" }).valid).toBe(false);
    expect(validateLessonDraft(undefined, { topicNameEn: "x" }).valid).toBe(false);
    expect(validateLessonDraft(42, { topicNameEn: "x" }).valid).toBe(false);
  });

  it("3. rejects an unsupported step type", () => {
    const draft = validDraft();
    draft.steps[1] = { ...draft.steps[1], type: "MONOLOGUE" };
    const result = validateLessonDraft(draft, { topicNameEn: draft.topicNameEn });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("unsupported type"))).toBe(true);
  });

  it("4. rejects duplicate step IDs", () => {
    const draft = validDraft();
    draft.steps[1] = { ...draft.steps[1], id: "s1" };
    const result = validateLessonDraft(draft, { topicNameEn: draft.topicNameEn });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Duplicate step id"))).toBe(true);
  });

  it("5. rejects invalid ordering (order not matching array position)", () => {
    const draft = validDraft();
    draft.steps[2] = { ...draft.steps[2], order: 99 };
    const result = validateLessonDraft(draft, { topicNameEn: draft.topicNameEn });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("expected 3"))).toBe(true);
  });

  it("6. rejects a draft where COMPLETE is not last", () => {
    const draft = validDraft();
    const complete = draft.steps.pop();
    draft.steps.splice(2, 0, complete);
    // re-fix order fields would normally be needed too, but we only care that the "last step" check independently fires
    const result = validateLessonDraft(draft, { topicNameEn: draft.topicNameEn });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("must be of type COMPLETE"))).toBe(true);
  });

  it("7. rejects a lesson with no CHECK step", () => {
    const draft = validDraft({
      steps: [
        { id: "s1", type: "INTRO", order: 1, objective: "Greet." },
        { id: "s2", type: "EXPLAIN", order: 2, objective: "Explain." },
        { id: "s3", type: "EXAMPLE", order: 3, objective: "Example." },
        { id: "s4", type: "REVIEW", order: 4, objective: "Review." },
        { id: "s5", type: "COMPLETE", order: 5, objective: "Done." },
      ],
    });
    const result = validateLessonDraft(draft, { topicNameEn: draft.topicNameEn });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("no CHECK step"))).toBe(true);
  });

  it("8. rejects a mismatched topic identity", () => {
    const draft = validDraft();
    const result = validateLessonDraft(draft, { topicNameEn: "Some Other Topic" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("topicNameEn mismatch"))).toBe(true);
  });

  it("9. rejects unsafe/unexpected structure (extra dangerous fields, wrong types)", () => {
    const draft = validDraft();
    (draft.steps[1] as any).__proto__polluted = true; // eslint-disable-line no-proto
    (draft.steps[1] as any).unexpectedField = "should not be here";
    const result = validateLessonDraft(draft, { topicNameEn: draft.topicNameEn });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("unexpected fields"))).toBe(true);
  });

  it("rejects a draft with no teaching (EXPLAIN/EXAMPLE) step", () => {
    const draft = validDraft({
      steps: [
        { id: "s1", type: "INTRO", order: 1, objective: "Greet." },
        { id: "s2", type: "CHECK", order: 2, objective: "Check.", checkType: "conceptual" },
        { id: "s3", type: "REVIEW", order: 3, objective: "Review." },
        { id: "s4", type: "COMPLETE", order: 4, objective: "Done." },
      ],
    });
    const result = validateLessonDraft(draft, { topicNameEn: draft.topicNameEn });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("no EXPLAIN/EXAMPLE"))).toBe(true);
  });

  it("rejects a step count outside the reasonable bounds", () => {
    const tooFew = validDraft({ steps: [{ id: "s1", type: "COMPLETE", order: 1, objective: "Done." }] });
    expect(validateLessonDraft(tooFew, { topicNameEn: tooFew.topicNameEn }).valid).toBe(false);
  });

  it("rejects an empty objective", () => {
    const draft = validDraft();
    draft.steps[1] = { ...draft.steps[1], objective: "   " };
    const result = validateLessonDraft(draft, { topicNameEn: draft.topicNameEn });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("empty objective"))).toBe(true);
  });

  it("rejects an unsupported checkType value", () => {
    const draft = validDraft();
    draft.steps[2] = { ...draft.steps[2], checkType: "trivia" };
    const result = validateLessonDraft(draft, { topicNameEn: draft.topicNameEn });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("unsupported checkType"))).toBe(true);
  });

  it("rejects a visual claiming GENERATED status or a non-null url at draft stage", () => {
    const draft = validDraft();
    draft.steps[3] = {
      ...draft.steps[3],
      visual: { type: "VISUALIZE_LEARNING", status: "GENERATED", prompt: "a prompt", url: "https://example.com/fake.png" },
    };
    const result = validateLessonDraft(draft, { topicNameEn: draft.topicNameEn });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('must be "NOT_GENERATED"'))).toBe(true);
    expect(result.errors.some((e) => e.includes("url must be null"))).toBe(true);
  });

  it("accepts a valid NOT_GENERATED visual plan", () => {
    const draft = validDraft();
    draft.steps[3] = {
      ...draft.steps[3],
      visual: { type: "VISUALIZE_LEARNING", status: "NOT_GENERATED", prompt: "a safe original prompt", url: null },
    };
    const result = validateLessonDraft(draft, { topicNameEn: draft.topicNameEn });
    expect(result.valid).toBe(true);
  });
});

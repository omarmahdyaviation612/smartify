import { validateQuestionDraft } from "./question-draft-validator";

const VALID_TOPIC_CONTEXT = { topicExists: true, topicIsPlaceholder: false, requireReviewedContent: true };

const VALID_MCQ = {
  type: "MULTIPLE_CHOICE",
  difficulty: "EASY",
  promptEn: "What is 2 + 2?",
  promptAr: "كم يساوي 2 + 2؟",
  optionsJson: ["3", "4", "5"],
  correctAnswerJson: "4",
  explanationEn: "2 + 2 makes 4 because you combine two groups of two.",
};

const VALID_TRUE_FALSE = {
  type: "TRUE_FALSE",
  difficulty: "EASY",
  promptEn: "5 is greater than 3.",
  promptAr: "5 أكبر من 3.",
  optionsJson: ["True", "False"],
  correctAnswerJson: "True",
  explanationEn: "5 comes after 3 when counting up, so it is greater.",
};

describe("validateQuestionDraft — GENERAL", () => {
  it("test 1: a valid, fully human-reviewed MCQ draft validates", () => {
    const result = validateQuestionDraft(VALID_MCQ, VALID_TOPIC_CONTEXT);
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("a valid, fully human-reviewed TRUE_FALSE draft validates", () => {
    const result = validateQuestionDraft(VALID_TRUE_FALSE, VALID_TOPIC_CONTEXT);
    expect(result.valid).toBe(true);
  });

  it("test 2: missing Arabic prompt fails when reviewed content is required", () => {
    const result = validateQuestionDraft({ ...VALID_MCQ, promptAr: null }, VALID_TOPIC_CONTEXT);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /promptAr/.test(e))).toBe(true);
  });

  it("does not require promptAr during structural (pre-review) generation validation", () => {
    const result = validateQuestionDraft({ ...VALID_MCQ, promptAr: undefined }, { ...VALID_TOPIC_CONTEXT, requireReviewedContent: false });
    expect(result.valid).toBe(true);
  });

  it("test 3: missing required answer fails", () => {
    const { correctAnswerJson, ...withoutAnswer } = VALID_MCQ;
    const result = validateQuestionDraft(withoutAnswer, VALID_TOPIC_CONTEXT);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /correctAnswerJson/.test(e))).toBe(true);
  });

  it("test 7: an unsupported/not-runtime-safe QuestionType fails safely, without crashing", () => {
    for (const type of ["SHORT_ANSWER", "FILL_BLANK", "MATCHING", "STEP_PROBLEM"]) {
      const result = validateQuestionDraft({ ...VALID_MCQ, type }, VALID_TOPIC_CONTEXT);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /NOT READY FOR MVP/.test(e))).toBe(true);
    }
  });

  it("fails safely (no crash) for a completely unknown type string", () => {
    const result = validateQuestionDraft({ ...VALID_MCQ, type: "ESSAY" }, VALID_TOPIC_CONTEXT);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /Unsupported QuestionType/.test(e))).toBe(true);
  });

  it("test 8: a placeholder Topic cannot receive a publishable draft", () => {
    const result = validateQuestionDraft(VALID_MCQ, { ...VALID_TOPIC_CONTEXT, topicIsPlaceholder: true });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /placeholder Topic/.test(e))).toBe(true);
  });

  it("fails when the Topic does not exist at all", () => {
    const result = validateQuestionDraft(VALID_MCQ, { ...VALID_TOPIC_CONTEXT, topicExists: false });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /does not exist/.test(e))).toBe(true);
  });

  it("rejects an unsupported difficulty value", () => {
    const result = validateQuestionDraft({ ...VALID_MCQ, difficulty: "IMPOSSIBLE" }, VALID_TOPIC_CONTEXT);
    expect(result.valid).toBe(false);
  });

  it("rejects an empty/whitespace-only promptEn", () => {
    const result = validateQuestionDraft({ ...VALID_MCQ, promptEn: "   " }, VALID_TOPIC_CONTEXT);
    expect(result.valid).toBe(false);
  });

  it("requires explanationEn when reviewed content is required (MVP policy: Practice/Quiz surface it directly to students)", () => {
    const result = validateQuestionDraft({ ...VALID_MCQ, explanationEn: null }, VALID_TOPIC_CONTEXT);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /explanationEn/.test(e))).toBe(true);
  });

  it("does not require explanationAr even when reviewed content is required — the frontend does not render it today", () => {
    const result = validateQuestionDraft({ ...VALID_MCQ, explanationAr: null }, VALID_TOPIC_CONTEXT);
    expect(result.valid).toBe(true);
  });

  it("fails safely on a non-object input rather than throwing", () => {
    expect(() => validateQuestionDraft(null, VALID_TOPIC_CONTEXT)).not.toThrow();
    expect(validateQuestionDraft(null, VALID_TOPIC_CONTEXT).valid).toBe(false);
    expect(validateQuestionDraft("a string", VALID_TOPIC_CONTEXT).valid).toBe(false);
  });
});

describe("validateQuestionDraft — MULTIPLE_CHOICE", () => {
  it("test 4: too few options fails", () => {
    const result = validateQuestionDraft({ ...VALID_MCQ, optionsJson: ["3", "4"] }, VALID_TOPIC_CONTEXT);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /at least 3 options/.test(e))).toBe(true);
  });

  it("test 5: duplicate MCQ options fail", () => {
    const result = validateQuestionDraft({ ...VALID_MCQ, optionsJson: ["4", "4", "5"] }, VALID_TOPIC_CONTEXT);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /Duplicate options/.test(e))).toBe(true);
  });

  it("test 6: correct answer not present in options fails", () => {
    const result = validateQuestionDraft({ ...VALID_MCQ, correctAnswerJson: "7" }, VALID_TOPIC_CONTEXT);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /does not exactly match any option/.test(e))).toBe(true);
  });

  it("rejects optionsJson that isn't an array", () => {
    const result = validateQuestionDraft({ ...VALID_MCQ, optionsJson: "4" }, VALID_TOPIC_CONTEXT);
    expect(result.valid).toBe(false);
  });

  it("rejects an empty-string option", () => {
    const result = validateQuestionDraft({ ...VALID_MCQ, optionsJson: ["3", "", "5"] }, VALID_TOPIC_CONTEXT);
    expect(result.valid).toBe(false);
  });

  it("rejects a non-string correctAnswerJson for MCQ (exact-match grading requires a single string)", () => {
    const result = validateQuestionDraft({ ...VALID_MCQ, correctAnswerJson: 4 }, VALID_TOPIC_CONTEXT);
    expect(result.valid).toBe(false);
  });
});

describe("validateQuestionDraft — TRUE_FALSE", () => {
  it("requires exactly 2 options", () => {
    const result = validateQuestionDraft({ ...VALID_TRUE_FALSE, optionsJson: ["True", "False", "Maybe"] }, VALID_TOPIC_CONTEXT);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /exactly 2 options/.test(e))).toBe(true);
  });

  it("rejects a correct answer that doesn't match either option", () => {
    const result = validateQuestionDraft({ ...VALID_TRUE_FALSE, correctAnswerJson: "Maybe" }, VALID_TOPIC_CONTEXT);
    expect(result.valid).toBe(false);
  });
});

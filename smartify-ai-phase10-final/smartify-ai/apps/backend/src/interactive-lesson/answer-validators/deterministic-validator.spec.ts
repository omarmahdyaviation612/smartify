import { tryDeterministicValidate, describeExpectedAnswer } from "./deterministic-validator";

describe("tryDeterministicValidate", () => {
  it("marks a correct addition answer as correct", () => {
    const result = tryDeterministicValidate({ op: "add", operands: [4, 3] }, "7");
    expect(result).toEqual({ correct: true, expected: 7, studentValue: 7 });
  });

  it("marks an incorrect addition answer as incorrect (the exact 4+3=6 misgrading found in live QA)", () => {
    const result = tryDeterministicValidate({ op: "add", operands: [4, 3] }, "6");
    expect(result).toEqual({ correct: false, expected: 7, studentValue: 6 });
  });

  it("normalizes whitespace and surrounding words around the number", () => {
    const result = tryDeterministicValidate({ op: "add", operands: [4, 3] }, "  الإجابة هي 7  ");
    expect(result?.correct).toBe(true);
  });

  it("normalizes Arabic-Indic digits", () => {
    const result = tryDeterministicValidate({ op: "add", operands: [4, 3] }, "٧");
    expect(result).toEqual({ correct: true, expected: 7, studentValue: 7 });
  });

  it("normalizes Arabic-Indic digits for an incorrect answer too", () => {
    const result = tryDeterministicValidate({ op: "add", operands: [4, 3] }, "٦");
    expect(result?.correct).toBe(false);
  });

  it("validates subtraction", () => {
    expect(tryDeterministicValidate({ op: "subtract", operands: [9, 4] }, "5")?.correct).toBe(true);
    expect(tryDeterministicValidate({ op: "subtract", operands: [9, 4] }, "4")?.correct).toBe(false);
  });

  it("validates equality checks via yes/no", () => {
    expect(tryDeterministicValidate({ op: "equals", operands: [5, 5] }, "نعم")?.correct).toBe(true);
    expect(tryDeterministicValidate({ op: "equals", operands: [5, 5] }, "لا")?.correct).toBe(false);
    expect(tryDeterministicValidate({ op: "equals", operands: [5, 6] }, "لا")?.correct).toBe(true);
  });

  it("validates comparison checks via yes/no", () => {
    expect(tryDeterministicValidate({ op: "compare", operands: [7, 3], comparator: "greater" }, "yes")?.correct).toBe(true);
    expect(tryDeterministicValidate({ op: "compare", operands: [7, 3], comparator: "less" }, "yes")?.correct).toBe(false);
  });

  it("validates comparison checks via a natural comparative word, not just yes/no (the exact live-QA gap found: 'is 5 bigger than 4?' answered with 'أكبر')", () => {
    expect(tryDeterministicValidate({ op: "compare", operands: [5, 4], comparator: "greater" }, "أكبر من 4، لأن 3+2=5")?.correct).toBe(true);
    expect(tryDeterministicValidate({ op: "compare", operands: [5, 4], comparator: "greater" }, "أصغر")?.correct).toBe(false);
    expect(tryDeterministicValidate({ op: "compare", operands: [3, 9], comparator: "less" }, "smaller")?.correct).toBe(true);
    expect(tryDeterministicValidate({ op: "compare", operands: [3, 9], comparator: "less" }, "bigger")?.correct).toBe(false);
  });

  it("returns null (falls back safely) when the expression is missing", () => {
    expect(tryDeterministicValidate(null, "7")).toBeNull();
    expect(tryDeterministicValidate(undefined, "7")).toBeNull();
  });

  it("returns null (falls back safely) when a numeric op's message has no parseable number", () => {
    expect(tryDeterministicValidate({ op: "add", operands: [4, 3] }, "يعني إيه علامة = ؟")).toBeNull();
  });

  it("returns null (falls back safely) when a yes/no op's message isn't a recognizable yes/no", () => {
    expect(tryDeterministicValidate({ op: "equals", operands: [5, 5] }, "مش فاهم")).toBeNull();
  });

  it("cannot be overridden by conflicting free text elsewhere in the message — the parsed number alone decides", () => {
    // Even if the student's sentence talks around a different number, the
    // first clean integer found is what gets graded — deterministic, not
    // influenced by any AI interpretation of intent.
    const result = tryDeterministicValidate({ op: "add", operands: [4, 3] }, "أعتقد إن الإجابة 7 مش متأكد");
    expect(result).toEqual({ correct: true, expected: 7, studentValue: 7 });
  });
});

describe("describeExpectedAnswer", () => {
  it("describes add/subtract as the numeric result", () => {
    expect(describeExpectedAnswer({ op: "add", operands: [4, 3] })).toBe("7");
    expect(describeExpectedAnswer({ op: "subtract", operands: [9, 4] })).toBe("5");
  });

  it("describes equals/compare as yes/no", () => {
    expect(describeExpectedAnswer({ op: "equals", operands: [5, 5] })).toBe("yes");
    expect(describeExpectedAnswer({ op: "equals", operands: [5, 6] })).toBe("no");
    expect(describeExpectedAnswer({ op: "compare", operands: [7, 3], comparator: "greater" })).toBe("yes");
  });
});

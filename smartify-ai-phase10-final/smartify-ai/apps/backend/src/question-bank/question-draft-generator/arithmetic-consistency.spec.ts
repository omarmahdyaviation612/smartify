import { checkArithmeticConsistency, parseNumber } from "./arithmetic-consistency";
import { QuestionDraftGeneratorService } from "./question-draft-generator.service";
import { gateAssignment, gateUnit } from "../../ai/context/topic-content-gate.fixtures.testspec";
import { evaluateTopicGroundingGate } from "../../ai/context/topic-content-provenance.util";

const MC = (promptEn: string, correctAnswerJson: string, optionsJson: string[], explanationEn: string) => ({ type: "MULTIPLE_CHOICE", promptEn, correctAnswerJson, optionsJson, explanationEn });
const TF = (promptEn: string, correctAnswerJson: string, explanationEn = "") => ({ type: "TRUE_FALSE", promptEn, correctAnswerJson, optionsJson: ["True", "False"], explanationEn });
const status = (q: any) => checkArithmeticConsistency(q).status;
const codes = (q: any) => checkArithmeticConsistency(q).findings.map((f) => f.code);

// Exact production failures (stored text).
const Q1 = MC("A school has 120 students. 45 are girls, and the rest are boys. If 15 more boys join the school, how many boys are there now?", "80", ["75", "80", "85"], "First, subtract the number of girls from the total number of students. 120 minus 45 equals 75 boys. Then, add 15 boys who joined. 75 plus 15 equals 80 boys.");
const Q2 = MC("Which pair of numbers makes 10?", "5 and 4", ["5 and 4", "3 and 6", "1 and 8"], "5 and 4 add up to 10 because 5 plus 4 equals 10.");

describe("arithmetic-consistency V1 — confirmed production failures", () => {
  it("Q1 (Grade 4 word problem, explanation 75 + 15 = 80) is INVALID", () => {
    expect(status(Q1)).toBe("INVALID");
    expect(codes(Q1)).toEqual(["EXPLANATION_ARITHMETIC_MISMATCH"]);
  });
  it("Q2 (pair makes 10, no option sums to 10) is INVALID", () => {
    expect(status(Q2)).toBe("INVALID");
    expect(codes(Q2).sort()).toEqual(["EXPLANATION_ARITHMETIC_MISMATCH", "MARKED_ANSWER_MISMATCH", "NO_CORRECT_OPTION"]);
  });
  it("corrected equivalents are VALID", () => {
    expect(status(MC(Q1.promptEn, "90", ["80", "90", "95"], "120 minus 45 equals 75 boys. Then add 15 boys who joined. 75 plus 15 equals 90 boys."))).toBe("VALID");
    expect(status(MC("Which pair of numbers makes 10?", "6 and 4", ["6 and 4", "3 and 6", "1 and 8"], "6 and 4 make 10 because 6 plus 4 equals 10."))).toBe("VALID");
  });
});

describe("arithmetic-consistency V1 — explicit claims", () => {
  it.each([
    ["75 + 15 = 90", "VALID"], ["75 + 15 = 80", "INVALID"], ["50 - 12 = 38", "VALID"], ["60 - 15 + 5 = 50", "VALID"],
    ["25 - 10 - 5 = 10", "VALID"], ["5 + 5 + 5 = 15", "VALID"], ["3 + 4 × 2 = 11", "VALID"], ["12 ÷ 4 = 3", "VALID"], ["12 ÷ 4 = 4", "INVALID"],
    ["75 times 3 equals 225", "VALID"], ["200 minus 75 equals 125", "VALID"], ["6 x 7 = 42", "VALID"], ["6 * 7 = 41", "INVALID"],
  ])("explanation %s => %s", (claim, expected) => {
    expect(status(MC("Solve the story.", "x", ["x", "y", "z"], `Work it out: ${claim}.`))).toBe(expected);
  });

  it("5,324 is five thousand three hundred twenty-four, never 5 and 324", () => {
    expect(parseNumber("5,324")).toEqual({ n: 5324n, d: 1n });
    expect(status(MC("What is 5,000 + 300 + 20 + 4 in expanded form?", "5,324", ["5,324", "5,320", "5,340"], "In expanded form, 5,000 + 300 + 20 + 4 equals 5,324."))).toBe("VALID");
  });
  it("decimals use exact arithmetic (0.1 + 0.2 = 0.3 is VALID; 0.1 + 0.2 = 0.4 is INVALID)", () => {
    expect(status(MC("Add.", "a", ["a", "b", "c"], "0.1 + 0.2 = 0.3."))).toBe("VALID");
    expect(status(MC("Add.", "a", ["a", "b", "c"], "0.1 + 0.2 = 0.4."))).toBe("INVALID");
    expect(status(MC("What is 2.75 + 1.5?", "4.25", ["4.25", "4.2", "3.25"], ""))).toBe("VALID");
  });
  it("rounded and remainder statements are UNKNOWN, never INVALID", () => {
    expect(status(MC("Share.", "a", ["a", "b", "c"], "10 ÷ 3 = 3.33."))).toBe("UNKNOWN");
    expect(status(MC("Share.", "a", ["a", "b", "c"], "13 ÷ 4 = 3 remainder 1."))).toBe("UNKNOWN");
    expect(status(MC("Multiply.", "a", ["a", "b", "c"], "2.5 × 1.25 = 3.13."))).toBe("UNKNOWN");
  });
  it("negated, hypothetical or estimated claims are UNKNOWN", () => {
    for (const e of ["75 + 15 = 80 is wrong; the sum is larger.", "Some students think 7 + 5 = 13.", "48 + 37 is about 90, so 48 + 37 = 90 roughly.", "It is not true that 6 + 6 = 13.", "If you mistakenly add, 50 + 12 = 61."]) {
      expect(status(MC("Q?", "a", ["a", "b", "c"], e))).toBe("UNKNOWN");
    }
  });
  it("non-maximal chains, algebra, fractions, percentages, negatives and units are UNKNOWN", () => {
    for (const e of ["(4 + 5) + 2 = 12.", "x + 5 = 12, so x = 7.", "1/2 + 1/4 = 3/4.", "50% of 80 = 30.", "5 - 8 = -3.", "2x = 10.", "5 cm + 3 cm = 9 cm.", "3² = 10.", "2:30 + 0:15 = 2:50."]) {
      expect(status(MC("Q?", "a", ["a", "b", "c"], e))).toBe("UNKNOWN");
    }
  });
});

describe("arithmetic-consistency V1 — answers and options", () => {
  it("direct computation: marked answer must equal the value and a correct option must exist", () => {
    expect(status(MC("What is the sum of 15 and 27?", "42", ["42", "32", "22"], ""))).toBe("VALID");
    expect(codes(MC("What is the sum of 15 and 27?", "32", ["42", "32", "22"], ""))).toEqual(["MARKED_ANSWER_MISMATCH"]);
    expect(codes(MC("What is 50 - 12?", "40", ["40", "39", "37"], "")).sort()).toEqual(["MARKED_ANSWER_MISMATCH", "NO_CORRECT_OPTION"]);
    expect(status(MC("What is 75 × 3?", "225 pounds", ["225 pounds", "150 pounds", "100 pounds"], ""))).toBe("VALID");
    expect(status(MC("What is the difference between 50 and 12?", "38", ["38", "62", "28"], ""))).toBe("VALID");
  });
  it("value-changing unit words are never read as bare numbers (UNKNOWN, not INVALID)", () => {
    expect(status(MC("What is 4 × 100?", "4 hundreds", ["4 hundreds", "4 tens", "4 ones"], ""))).toBe("UNKNOWN");
  });
  it("TRUE_FALSE that is exactly one claim: the marked truth value is verified", () => {
    expect(status(TF("True or False: 7 + 5 = 12", "True"))).toBe("VALID");
    expect(status(TF("8 + 7 = 16. True or False?", "False"))).toBe("VALID");
    expect(codes(TF("True or False: 7 + 5 = 12", "False"))).toEqual(["MARKED_ANSWER_MISMATCH"]);
    expect(status(TF("The sum of 5 and 4 is 9. True or False?", "True"))).toBe("UNKNOWN");
  });
});

describe("arithmetic-consistency V1 — UNKNOWN is the default", () => {
  it("ambiguous prose, non-math and unsupported math are UNKNOWN", () => {
    expect(status(MC("A bookstore had some books and sold a few. How many are left?", "a few", ["a few", "many", "none"], "Fewer books remain after selling."))).toBe("UNKNOWN");
    expect(status(MC("Which organ pumps blood?", "Heart", ["Heart", "Lung", "Liver"], "The heart pumps blood around the body."))).toBe("UNKNOWN");
    expect(status(MC("What is the square root of 49?", "7", ["7", "6", "8"], "Because 7 squared gives 49."))).toBe("UNKNOWN");
    expect(status(MC("Which is greater, 3/4 or 2/3?", "3/4", ["3/4", "2/3", "equal"], "Compare using a common denominator."))).toBe("UNKNOWN");
  });
  it("the three earlier scanner false positives are not rejected", () => {
    expect(status(MC("You have a box with 25 candies. You give 10 to your friend and eat 5. How many candies are left?", "10", ["10", "15", "5"], "25 minus 10 minus 5 equals 10 candies left."))).toBe("VALID");
    expect(status(MC("What is the value of three 5 cent coins?", "15 cents", ["10 cents", "15 cents", "5 cents"], "Three 5 cent coins add up to 15 cents in total (5 + 5 + 5 = 15)."))).toBe("VALID");
    expect(status(MC("What is 5,000 + 300 + 20 + 4 in expanded form?", "5,324", ["5,324", "5,320", "5,340"], "In expanded form, 5,000 + 300 + 20 + 4 equals 5,324."))).not.toBe("INVALID");
  });
});

describe("arithmetic guard in generation", () => {
  const NOTES = { learningObjectives: ["Add."], concepts: [{ name: "Addition", description: "Adding numbers together.", sourcePages: [10], importance: "core" }], facts: [], vocabulary: [], skills: [], topicHints: [], scopeNotes: [] };
  const live = { id: "t", nameEn: "Addition", nameAr: "الجمع", groundingAssignment: gateAssignment({ matchedConceptNames: ["Addition"] }), topicSourceEvidence: [], unit: { ...gateUnit({ groundingNotesJson: NOTES }), nameEn: "U", subject: { nameEn: "Mathematics", grade: { nameEn: "Grade 4", curriculum: { nameEn: "EG" } } }, _count: { topics: 3 } }, lessons: [{ isPlaceholder: false, objectives: [] }] };
  const full = (q: any) => ({ difficulty: "EASY", promptAr: "س", explanationAr: "ل", ...q });
  const GOOD = full(MC("Sami has 15 apples and buys 7 more. How many apples now?", "22", ["21", "22", "23"], "Add 15 and 7 together. 15 plus 7 equals 22."));
  const BAD = full(Q1);
  function harness(batch: any[]) {
    const generate = jest.fn().mockResolvedValue({ content: JSON.stringify({ questions: batch }), inputTokens: 5, outputTokens: 5 });
    const usage = { assertWithinBudget: jest.fn(), estimateMaxChatCostUsd: jest.fn().mockResolvedValue(0.01), reserveBudget: jest.fn().mockResolvedValue({ ok: true, reservationId: "r" }), reconcileBudget: jest.fn().mockResolvedValue(undefined), releaseBudget: jest.fn().mockResolvedValue(undefined) };
    const prisma = { client: { topic: { findUnique: jest.fn().mockResolvedValue(live) }, question: { findMany: jest.fn().mockResolvedValue([]) }, questionDraft: { create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: `qd-${Math.random()}`, ...data })) }, aIUsage: { create: jest.fn().mockResolvedValue(undefined) } } } as any;
    const svc = new QuestionDraftGeneratorService(prisma, { getActiveProvider: jest.fn().mockResolvedValue({ provider: { generate }, providerKey: "openai", model: "m" }), getCostRates: jest.fn().mockResolvedValue({ costPerInputToken: 0, costPerOutputToken: 0 }) } as any, { buildAutoQuestionBatchGenerationPrompt: jest.fn().mockReturnValue("p") } as any, usage as any, { autoPublish: jest.fn() } as any, { ensureTopicHasLesson: jest.fn() } as any);
    return { svc, prisma };
  }
  const gate = () => { const g = evaluateTopicGroundingGate(live as any); if (g.state !== "READY") throw new Error(); return g; };

  it("normal regeneration drops a provably wrong Question exactly like an invalid one, keeping the valid ones", async () => {
    const h = harness([GOOD, BAD]);
    const r = await h.svc.generateAutoQuestionBatch("t", 2, "actor", undefined, { againstCurrentPool: true });
    expect(r.drafts.map((d: any) => d.promptEn)).toEqual([GOOD.promptEn]);
    expect(r.rejectedCount).toBe(1);
  });
  it("staged replacement applies the same guard", async () => {
    const h = harness([GOOD, BAD]);
    const r = await h.svc.generateAutoQuestionBatch("t", 2, "actor", { gate: gate(), acceptedPool: [] });
    expect(r.drafts.map((d: any) => d.promptEn)).toEqual([GOOD.promptEn]);
  });
  it("a batch of only wrong Questions fails validation and writes nothing", async () => {
    const h = harness([BAD]);
    await expect(h.svc.generateAutoQuestionBatch("t", 1, "actor", undefined, { againstCurrentPool: true })).rejects.toThrow(/failed validation/);
    expect(h.prisma.client.questionDraft.create).not.toHaveBeenCalled();
  });
  it("UNKNOWN Questions are kept (the guard never rejects what it cannot prove)", async () => {
    const unknown = full(MC("A farmer has some apples and picks more. Which word means adding?", "Add", ["Add", "Take", "Split"], "To add means to put together."));
    const h = harness([unknown]);
    expect((await h.svc.generateAutoQuestionBatch("t", 1, "actor", undefined, { againstCurrentPool: true })).drafts).toHaveLength(1);
  });
});

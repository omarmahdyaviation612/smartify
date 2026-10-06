/**
 * Arithmetic correctness guard V1.1 — result consistency (2026-10-03).
 * Fixtures are the EXACT stored production texts: three wrong CURRENT
 * Questions V1 missed, and the seven diagnostic false positives that must
 * never become INVALID.
 */
import { checkArithmeticConsistency } from "./arithmetic-consistency";

const MC = (promptEn: string, correctAnswerJson: string, optionsJson: string[], explanationEn: string) => ({ type: "MULTIPLE_CHOICE", promptEn, correctAnswerJson, optionsJson, explanationEn });
const run = (q: any) => checkArithmeticConsistency(q);
const status = (q: any) => run(q).status;
const codes = (q: any) => run(q).findings.map((f) => f.code).sort();

// ---- confirmed production failures (exact text) ----
const Q1_PROMPT = "If you have a composite shape made of three rectangles: one with dimensions 2 cm x 3 cm, another with dimensions 4 cm x 5 cm, and a third with dimensions 1 cm x 2 cm, what is the total perimeter of the composite shape?";
const Q1_EXPL = "To find the total perimeter, you add the perimeter of all rectangles. The perimeters are 10 cm, 18 cm, and 6 cm respectively, giving a total of 10 + 18 + 6 = 34 cm.";
const Q1 = MC(Q1_PROMPT, "28 cm", ["28 cm", "32 cm", "24 cm"], Q1_EXPL);
const Q2_PROMPT = "If a composite shape is made up of a rectangle that is 5 units long and 3 units wide, and a square that is 2 units on each side, what is the total area of the composite shape?";
const Q2_EXPL = "The area of the rectangle is 5 multiplied by 3, which equals 15. The area of the square is 2 multiplied by 2, which equals 4. Adding them together gives us 15 plus 4, totaling 23 square units.";
const Q2 = MC(Q2_PROMPT, "23 square units", ["23 square units", "15 square units", "10 square units"], Q2_EXPL);
const Q3_PROMPT = "Estimate 1450 + 375 by rounding each number. What is the estimated sum?";
const Q3_EXPL = "1450 rounds to 1500 and 375 rounds to 400, so 1500 + 400 = 1900.";
const Q3 = MC(Q3_PROMPT, "1800", ["1800", "2000", "1500"], Q3_EXPL);

describe("V1.1 — confirmed production failures", () => {
  it("Q1 composite perimeter: explanation concludes 34 cm, marked 28 cm, 34 not an option => INVALID", () => {
    expect(status(Q1)).toBe("INVALID");
    expect(codes(Q1)).toEqual(["EXPLANATION_RESULT_MISMATCH", "NO_CORRECT_OPTION"]);
  });
  it("Q2 composite area: '15 plus 4, totaling 23' => INVALID (claim mismatch)", () => {
    expect(status(Q2)).toBe("INVALID");
    expect(codes(Q2)).toContain("EXPLANATION_ARITHMETIC_MISMATCH");
  });
  it("Q3 rounding: final '1500 + 400 = 1900' after rounding, marked 1800, 1900 not an option => INVALID", () => {
    expect(status(Q3)).toBe("INVALID");
    expect(codes(Q3)).toEqual(["EXPLANATION_RESULT_MISMATCH", "NO_CORRECT_OPTION"]);
  });
  it("corrected equivalents are not INVALID", () => {
    expect(status(MC(Q1_PROMPT, "34 cm", ["34 cm", "32 cm", "24 cm"], Q1_EXPL))).toBe("VALID");
    expect(status(MC(Q2_PROMPT, "19 square units", ["19 square units", "15 square units", "10 square units"], Q2_EXPL.replace("totaling 23", "totaling 19")))).toBe("VALID");
    expect(status(MC(Q3_PROMPT, "1900", ["1800", "1900", "1500"], Q3_EXPL))).toBe("VALID");
  });
});

describe("V1.1 — explicit connectors and final results", () => {
  const plain = (e: string, a = "x", o = ["x", "y", "z"]) => MC("Solve the story.", a, o, e);
  it.each([
    ["15 plus 4, totaling 19.", "VALID"], ["15 plus 4, totaling 23.", "INVALID"], ["15 plus 4 totals 19.", "VALID"], ["15 plus 4 gives 19.", "VALID"],
    ["15 plus 4 results in 20.", "INVALID"], ["7 + 5 is 12.", "VALID"], ["7 + 5 is 13.", "INVALID"], ["Add them: 6 + 2, giving a total of 8.", "VALID"],
  ])("claim %s => %s", (e, expected) => expect(status(plain(e))).toBe(expected));
  it("final answer after an exact claim: 1500 + 400 = 1900, final answer 1900 VALID, final answer 1800 INVALID", () => {
    expect(status(MC("Estimate 1476 + 423.", "1900", ["1900", "1800", "2000"], "Round 1476 to 1500 and 423 to 400. 1500 + 400 = 1900. Therefore the estimated total is 1900."))).toBe("VALID");
    expect(codes(MC("Estimate 1476 + 423.", "1800", ["1900", "1800", "2000"], "Round 1476 to 1500 and 423 to 400. 1500 + 400 = 1900. Therefore the estimated total is 1900."))).toEqual(["EXPLANATION_RESULT_MISMATCH"]);
    expect(status(MC("Q?", "1900", ["1900", "1800"], "1500 + 400 = 1900, so the answer is 1900."))).toBe("VALID");
  });
  it.each([
    ["Therefore, the perimeter is 34 cm.", "28 cm", ["28 cm", "34 cm"], ["EXPLANATION_RESULT_MISMATCH"]],
    ["So the answer is 34.", "28", ["28", "30"], ["EXPLANATION_RESULT_MISMATCH", "NO_CORRECT_OPTION"]],
    ["The total is 34.", "28", ["28", "34"], ["EXPLANATION_RESULT_MISMATCH"]],
    ["Thus, 34 cm.", "28 cm", ["28 cm", "34 cm"], ["EXPLANATION_RESULT_MISMATCH"]],
  ])("high-confidence final cue %s vs marked %s", (e, a, o, expected) => {
    expect(codes(MC("Find it.", a as string, o as string[], `Work through each side. ${e}`))).toEqual(expected);
  });
  it("units: 34 / 34 cm / 34 centimeters agree; a different unit is never converted (UNKNOWN)", () => {
    expect(status(MC("Find it.", "34 centimeters", ["34 centimeters", "30 centimeters"], "So the perimeter is 34 cm."))).toBe("VALID");
    expect(status(MC("Find it.", "34", ["34", "30"], "So the perimeter is 34 cm."))).toBe("VALID");
    expect(status(MC("Convert 3.4 cm to mm.", "34 mm", ["34 mm", "340 mm"], "So the answer is 3.4 cm."))).toBe("UNKNOWN");
  });
  it("approximate / intermediate values without a final cue stay UNKNOWN", () => {
    expect(status(MC("Estimate.", "1800", ["1800", "2000"], "1500 is about 1476. Rounding helps us check our work."))).toBe("UNKNOWN");
    expect(status(MC("Add.", "127", ["127", "128"], "Line up the digits. The ones make 17 and we carry 1. The tens make 12."))).toBe("UNKNOWN");
  });
  it("a final cue inside a negated/hypothetical sentence is not used", () => {
    expect(status(MC("Q?", "28", ["28", "30"], "Some say the answer is 34, but that is wrong."))).toBe("UNKNOWN");
  });
});

describe("V1.1 — the 7 diagnostic false positives never become INVALID (exact production text)", () => {
  it.each([
    ["time subtraction", MC("What is the elapsed time between 2:30 PM and 4:15 PM?", "1 hour 45 minutes", ["1 hour 45 minutes", "1 hour 30 minutes", "2 hours"], "To calculate elapsed time, subtract the start time from the end time: 4:15 - 2:30 results in 1 hour and 45 minutes."), "UNKNOWN"],
    ["missing number (Y1 U11)", MC("What is the missing number in the equation: 2 + ___ = 5?", "3", ["2", "3", "1"], "The missing number is 3 because 2 plus 3 equals 5."), "VALID"],
    ["carrying / regrouping", MC("What is the result of 78 plus 49 using vertical addition?", "127", ["127", "126", "128"], "Align 78 and 49 vertically. Adding 8 and 9 gives 17, write 7 and carry over 1. Then add 7 and 4 plus the 1 carried over, which is 12. This makes the total 127."), "UNKNOWN"],
    ["unit conversion (thousands separator)", MC("If a container has a capacity of 1.5 liters, how many milliliters is that?", "1500 milliliters", ["150 milliliters", "1500 milliliters", "15 milliliters"], "1.5 liters is equal to 1,500 milliliters because 1 liter equals 1,000 milliliters."), "UNKNOWN"],
    ["unit conversion (multi-term)", MC("If a bottle holds 2 liters, how many milliliters does it hold?", "2000 milliliters", ["200 milliliters", "2000 milliliters", "20 milliliters"], "Since 1 liter equals 1000 milliliters, 2 liters equals 2 times 1000 milliliters, which is 2000 milliliters."), "UNKNOWN"],
    ["unit conversion (decimal)", MC("If a water bottle can hold 1.5 liters, how many milliliters can it hold?", "1500 milliliters", ["150 milliliters", "1500 milliliters", "750 milliliters"], "Since 1 liter equals 1000 milliliters, 1.5 liters equals 1.5 times 1000 milliliters, which is 1500 milliliters."), "UNKNOWN"],
    ["missing number (Y1 U14)", MC("Solve the addition: 6 + ? = 10. What is the missing number?", "4", ["4", "3", "2"], "The missing number is 4 because 6 plus 4 equals 10."), "VALID"],
  ])("%s => %s (never INVALID)", (_label, q, expected) => {
    const r = run(q);
    expect(r.status).not.toBe("INVALID");
    expect(r.status).toBe(expected);
  });
});

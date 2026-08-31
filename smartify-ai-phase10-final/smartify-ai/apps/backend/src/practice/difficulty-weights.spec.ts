import { pickDifficultyWeights } from "./difficulty-weights";

describe("pickDifficultyWeights", () => {
  it("defaults to a balanced easy-leaning mix when the student has no attempts yet", () => {
    const weights = pickDifficultyWeights(null);
    expect(weights.EASY).toBeGreaterThan(weights.HARD);
    expect(weights.EASY + weights.MEDIUM + weights.HARD).toBeCloseTo(1);
  });

  it("skews toward easy/medium for a weak student (<40%)", () => {
    const weights = pickDifficultyWeights(20);
    expect(weights.EASY).toBeGreaterThan(weights.MEDIUM);
    expect(weights.MEDIUM).toBeGreaterThan(weights.HARD);
  });

  it("is roughly balanced for a mid-accuracy student (40-75%)", () => {
    const weights = pickDifficultyWeights(60);
    expect(weights.MEDIUM).toBeGreaterThanOrEqual(weights.EASY);
    expect(weights.MEDIUM).toBeGreaterThanOrEqual(weights.HARD);
  });

  it("skews toward medium/hard for a strong student (>=75%)", () => {
    const weights = pickDifficultyWeights(90);
    expect(weights.HARD).toBeGreaterThan(weights.EASY);
  });

  it("always returns weights that sum to 1 across the full input range", () => {
    for (const accuracy of [null, 0, 10, 39, 40, 41, 74, 75, 76, 100]) {
      const weights = pickDifficultyWeights(accuracy);
      const sum = weights.EASY + weights.MEDIUM + weights.HARD;
      expect(sum).toBeCloseTo(1, 5);
    }
  });

  it("is a pure function — same input always produces the same output", () => {
    expect(pickDifficultyWeights(55)).toEqual(pickDifficultyWeights(55));
  });
});

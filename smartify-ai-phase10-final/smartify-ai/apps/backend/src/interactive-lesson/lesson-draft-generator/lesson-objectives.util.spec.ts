import { BadRequestException } from "@nestjs/common";
import {
  allObjectivesReviewed,
  applyReviewedTranslations,
  parseBilingualObjectives,
  toUnreviewedBilingualObjectives,
} from "./lesson-objectives.util";

describe("toUnreviewedBilingualObjectives", () => {
  it("wraps English objectives with objectiveAr always null, regardless of how many are given", () => {
    expect(toUnreviewedBilingualObjectives(["First.", "Second."])).toEqual([
      { objectiveEn: "First.", objectiveAr: null },
      { objectiveEn: "Second.", objectiveAr: null },
    ]);
  });

  it("returns an empty array for no objectives", () => {
    expect(toUnreviewedBilingualObjectives([])).toEqual([]);
  });
});

describe("parseBilingualObjectives", () => {
  it("parses the current bilingual shape as-is", () => {
    const raw = [{ objectiveEn: "First.", objectiveAr: "الأول." }];
    expect(parseBilingualObjectives(raw)).toEqual(raw);
  });

  it("treats a pre-Phase-10B plain string[] as unreviewed objectives, without crashing", () => {
    expect(parseBilingualObjectives(["Old objective."])).toEqual([{ objectiveEn: "Old objective.", objectiveAr: null }]);
  });

  it("normalizes a blank/whitespace-only objectiveAr to null", () => {
    expect(parseBilingualObjectives([{ objectiveEn: "X.", objectiveAr: "   " }])).toEqual([{ objectiveEn: "X.", objectiveAr: null }]);
  });

  it("returns an empty array for non-array/garbage input, never throwing", () => {
    expect(parseBilingualObjectives(null)).toEqual([]);
    expect(parseBilingualObjectives(undefined)).toEqual([]);
    expect(parseBilingualObjectives("not an array")).toEqual([]);
  });
});

describe("allObjectivesReviewed", () => {
  it("is false for an empty objectives list — nothing to approve", () => {
    expect(allObjectivesReviewed([])).toBe(false);
  });

  it("is false if any single objective lacks a reviewed Arabic translation", () => {
    expect(
      allObjectivesReviewed([
        { objectiveEn: "A", objectiveAr: "أ" },
        { objectiveEn: "B", objectiveAr: null },
      ]),
    ).toBe(false);
  });

  it("is true only when every objective has a non-empty objectiveAr", () => {
    expect(
      allObjectivesReviewed([
        { objectiveEn: "A", objectiveAr: "أ" },
        { objectiveEn: "B", objectiveAr: "ب" },
      ]),
    ).toBe(true);
  });
});

describe("applyReviewedTranslations", () => {
  const current = [
    { objectiveEn: "First.", objectiveAr: null },
    { objectiveEn: "Second.", objectiveAr: null },
  ];

  it("fills in objectiveAr for a matching objectiveEn, leaving others untouched", () => {
    const result = applyReviewedTranslations(current, [{ objectiveEn: "First.", objectiveAr: "الأول." }]);
    expect(result).toEqual([
      { objectiveEn: "First.", objectiveAr: "الأول." },
      { objectiveEn: "Second.", objectiveAr: null },
    ]);
  });

  it("can update an already-reviewed objective (e.g. fixing a typo before approval)", () => {
    const reviewed = [{ objectiveEn: "First.", objectiveAr: "خطأ." }];
    const result = applyReviewedTranslations(reviewed, [{ objectiveEn: "First.", objectiveAr: "الصحيح." }]);
    expect(result).toEqual([{ objectiveEn: "First.", objectiveAr: "الصحيح." }]);
  });

  it("rejects a translation whose objectiveEn does not exactly match any existing objective", () => {
    expect(() => applyReviewedTranslations(current, [{ objectiveEn: "Not in the draft.", objectiveAr: "غير موجود." }])).toThrow(
      BadRequestException,
    );
  });

  it("rejects an empty objectiveAr", () => {
    expect(() => applyReviewedTranslations(current, [{ objectiveEn: "First.", objectiveAr: "" }])).toThrow(BadRequestException);
  });

  it("rejects a whitespace-only objectiveAr", () => {
    expect(() => applyReviewedTranslations(current, [{ objectiveEn: "First.", objectiveAr: "   " }])).toThrow(BadRequestException);
  });

  it("rejects an empty translations array — must supply at least one", () => {
    expect(() => applyReviewedTranslations(current, [])).toThrow(BadRequestException);
  });

  it("trims whitespace around a valid Arabic translation before storing it", () => {
    const result = applyReviewedTranslations(current, [{ objectiveEn: "First.", objectiveAr: "  الأول.  " }]);
    expect(result[0].objectiveAr).toBe("الأول.");
  });
});

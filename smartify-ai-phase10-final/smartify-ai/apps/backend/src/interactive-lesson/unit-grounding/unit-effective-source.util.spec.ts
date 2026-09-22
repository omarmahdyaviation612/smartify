import { resolveEffectiveSourceFile } from "./unit-effective-source.util";

describe("resolveEffectiveSourceFile", () => {
  it("returns the Subject's sourceFile when the Unit has no override (normal case, byte-for-byte prior behavior)", () => {
    const result = resolveEffectiveSourceFile({ sourceFileOverride: null }, { sourceFile: "british-intl/grade-5/science/science.pdf" });
    expect(result).toBe("british-intl/grade-5/science/science.pdf");
  });

  it("returns the Unit's own override when set, even though the Subject also has a sourceFile", () => {
    const result = resolveEffectiveSourceFile(
      { sourceFileOverride: "british-intl/grade-1/english/extras/the-magic-garden.pdf" },
      { sourceFile: "british-intl/grade-1/english/english-course-book.pdf" },
    );
    expect(result).toBe("british-intl/grade-1/english/extras/the-magic-garden.pdf");
  });

  it("returns null when neither the Unit override nor the Subject sourceFile is set", () => {
    expect(resolveEffectiveSourceFile({ sourceFileOverride: null }, { sourceFile: null })).toBeNull();
  });

  it("returns the override even when the Subject has no sourceFile at all", () => {
    const result = resolveEffectiveSourceFile({ sourceFileOverride: "curriculum/grade-1/subject/extras/book.pdf" }, { sourceFile: null });
    expect(result).toBe("curriculum/grade-1/subject/extras/book.pdf");
  });
});

import { canonicalContentSubjectId, isSharedLaunchSubject, sharedSubjectKind } from "./shared-content-subject.util";

describe("shared content subject classification", () => {
  it.each([
    ["Arabic Language", "اللغة العربية", "ARABIC"],
    ["Arabic", "عربي", "ARABIC"],
    ["Social Studies", "الدراسات الاجتماعية", "SOCIAL_STUDIES"],
  ])("classifies %s / %s", (nameEn, nameAr, expected) => {
    expect(sharedSubjectKind(nameEn, nameAr)).toBe(expected);
    expect(isSharedLaunchSubject(nameEn, nameAr)).toBe(true);
  });

  it("classifies English but never shares it without a curriculum that allows it", () => {
    expect(sharedSubjectKind("English", "اللغة الإنجليزية")).toBe("ENGLISH");
    expect(isSharedLaunchSubject("English", "اللغة الإنجليزية")).toBe(false);
    expect(isSharedLaunchSubject("English", "اللغة الإنجليزية", "BRITISH_INTL")).toBe(false);
    expect(isSharedLaunchSubject("English", "اللغة الإنجليزية", "EG_LANGUAGE")).toBe(true);
  });

  describe("canonicalContentSubjectId", () => {
    const source = (nameEn: string, over: Record<string, unknown> = {}) => ({
      id: "src", nameEn, nameAr: null, isActive: true, sharedContentSubjectId: null,
      grade: { level: 8, isActive: true, curriculum: { code: "EG_NATIONAL", isActive: true } }, ...over,
    });
    const alias = (nameEn: string, src: ReturnType<typeof source>) => ({
      id: "alias", nameEn, nameAr: null, sharedContentSubjectId: "src", grade: { level: 8 }, sharedContentSubject: src,
    });

    it("resolves a same-name subject outside the standard kinds", () => {
      expect(canonicalContentSubjectId(alias("Italian Language", source("Italian Language")))).toBe("src");
    });

    it("rejects a differently named subject outside the standard kinds", () => {
      expect(canonicalContentSubjectId(alias("French Language", source("Italian Language")))).toBeNull();
    });

    it("still requires matching kinds for standard shared subjects", () => {
      expect(canonicalContentSubjectId(alias("Arabic Language", source("Arabic Language")))).toBe("src");
      expect(canonicalContentSubjectId(alias("Math (English)", source("Mathematics")))).toBeNull();
      expect(canonicalContentSubjectId(alias("Mathematics", source("Arabic Language")))).toBeNull();
    });

    it("rejects a source outside Egyptian MOE or another grade level", () => {
      expect(canonicalContentSubjectId(alias("Italian Language", source("Italian Language", { grade: { level: 8, isActive: true, curriculum: { code: "EG_LANGUAGE", isActive: true } } })))).toBeNull();
      expect(canonicalContentSubjectId(alias("Italian Language", source("Italian Language", { grade: { level: 9, isActive: true, curriculum: { code: "EG_NATIONAL", isActive: true } } })))).toBeNull();
    });
  });

  it("does not classify other subjects", () => {
    expect(isSharedLaunchSubject("Mathematics", "الرياضيات")).toBe(false);
  });
});

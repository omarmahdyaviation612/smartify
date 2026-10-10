import { isSharedLaunchSubject, sharedSubjectKind } from "./shared-content-subject.util";

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

  it("does not classify other subjects", () => {
    expect(isSharedLaunchSubject("Mathematics", "الرياضيات")).toBe(false);
  });
});

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

  it("does not classify other subjects", () => {
    expect(sharedSubjectKind("English", "اللغة الإنجليزية")).toBeNull();
    expect(isSharedLaunchSubject("Mathematics", "الرياضيات")).toBe(false);
  });
});

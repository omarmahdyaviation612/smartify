import { getLessonLanguage, isArabicOnlySubject } from "./lesson-language.util";

describe("lesson language for Arabic-only curriculum subjects", () => {
  it.each([
    ["Arabic", "اللغة العربية"],
    ["Arabic Language", "اللغة العربية"],
    ["Social Studies", "الدراسات الاجتماعية"],
  ])("forces %s to Arabic", (nameEn, nameAr) => {
    expect(isArabicOnlySubject(nameEn, nameAr)).toBe(true);
    expect(getLessonLanguage("en", nameEn, nameAr)).toBe("ar");
  });
  it("keeps other subjects in the student's selected language", () => {
    expect(getLessonLanguage("en", "Science", "العلوم")).toBe("en");
    expect(getLessonLanguage("ar", "Science", "العلوم")).toBe("ar");
  });
});

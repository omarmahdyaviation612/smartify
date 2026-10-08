import { sharedSubjectKind } from "../common/shared-content-subject.util";

export function isArabicOnlySubject(nameEn?: string | null, nameAr?: string | null): boolean {
  return sharedSubjectKind(nameEn ?? "", nameAr) !== null;
}

export function hasArabicQuestionContent(promptAr: unknown, optionsAr: unknown, optionsJson: unknown): boolean {
  return typeof promptAr === "string" && /\p{Script=Arabic}/u.test(promptAr) &&
    Array.isArray(optionsAr) && Array.isArray(optionsJson) && optionsAr.length === optionsJson.length &&
    optionsAr.every((option) => typeof option === "string" &&
      (/\p{Script=Arabic}/u.test(option) || /^[\d٠-٩۰-۹\s.,%+\-]+$/u.test(option)));
}

export function getLessonLanguage(preferredLang: string | undefined, nameEn?: string | null, nameAr?: string | null): "ar" | "en" {
  return isArabicOnlySubject(nameEn, nameAr) || preferredLang === "ar" ? "ar" : "en";
}

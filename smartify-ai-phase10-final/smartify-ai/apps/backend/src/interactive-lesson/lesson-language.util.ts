export function isArabicOnlySubject(nameEn?: string | null, nameAr?: string | null): boolean {
  return /arabic|social\s*studies/i.test(nameEn ?? "") || /اللغة العربية|الدراسات الاجتماعية/.test(nameAr ?? "");
}

export function getLessonLanguage(preferredLang: string | undefined, nameEn?: string | null, nameAr?: string | null): "ar" | "en" {
  return isArabicOnlySubject(nameEn, nameAr) || preferredLang === "ar" ? "ar" : "en";
}

export type SharedContentSubjectKind = "ARABIC" | "SOCIAL_STUDIES" | "ENGLISH" | null;

/**
 * Curricula whose Arabic / Social Studies subjects may reuse the canonical
 * Egyptian MOE (EG_NATIONAL) content instead of having their own.
 * EG_LANGUAGE (2026-10-11): Egyptian Language schools study the national
 * Arabic and Social Studies books.
 */
export const SHARED_TARGET_CURRICULUM_CODES = ["BRITISH_INTL", "AMERICAN_INTL", "EG_LANGUAGE"] as const;

export function isSharedTargetCurriculum(code: string | null | undefined): boolean {
  return (SHARED_TARGET_CURRICULUM_CODES as readonly string[]).includes(code ?? "");
}

/**
 * EG_LANGUAGE sells the shared subjects at the same price as Egyptian
 * National, so a newly linked subject starts with the MOE subject's price.
 * British/American keep their own prices (new links start unpriced).
 */
export function linksAtMoePrice(code: string | null | undefined): boolean {
  return code === "EG_LANGUAGE";
}

function normalizedName(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function sharedSubjectKind(nameEn: string, nameAr?: string | null): SharedContentSubjectKind {
  const names = `${normalizedName(nameEn)} ${normalizedName(nameAr)}`;
  if (names.includes("arabic") || names.includes("العربية") || names.includes("عربي")) return "ARABIC";
  if ((names.includes("social") && names.includes("studies")) || names.includes("الدراسات الاجتماعية")) return "SOCIAL_STUDIES";
  // NFKD splits the hamza off "إ", so match the stable part of "الإنجليزية".
  if (names.includes("english") || names.includes("نجليزي")) return "ENGLISH";
  return null;
}

type SharedKind = Exclude<SharedContentSubjectKind, null>;
const ALL_SHARED_KINDS: readonly SharedKind[] = ["ARABIC", "SOCIAL_STUDIES", "ENGLISH"];

/**
 * Which subjects each curriculum may reuse from Egyptian MOE. English
 * (2026-10-11) is shared only with Egyptian Language schools — British and
 * American keep their own English textbooks.
 */
const SHARED_KINDS_BY_TARGET: Record<string, readonly SharedKind[]> = {
  BRITISH_INTL: ["ARABIC", "SOCIAL_STUDIES"],
  AMERICAN_INTL: ["ARABIC", "SOCIAL_STUDIES"],
  EG_LANGUAGE: ["ARABIC", "SOCIAL_STUDIES", "ENGLISH"],
};

/** Shareable subject kinds for a curriculum: every kind for the EG_NATIONAL source, the allowed list for a target. */
export function sharedKindsForCurriculum(code: string | null | undefined): readonly SharedKind[] {
  if (code === "EG_NATIONAL") return ALL_SHARED_KINDS;
  return SHARED_KINDS_BY_TARGET[code ?? ""] ?? [];
}

/**
 * Whether a subject can take part in MOE content sharing. Without a
 * curriculum code this keeps the original meaning (Arabic / Social Studies).
 */
export function isSharedLaunchSubject(nameEn: string, nameAr?: string | null, curriculumCode?: string | null): boolean {
  const kind = sharedSubjectKind(nameEn, nameAr);
  if (!kind) return false;
  if (curriculumCode === undefined) return kind !== "ENGLISH";
  return sharedKindsForCurriculum(curriculumCode).includes(kind);
}

export function canonicalContentSubjectId(subject: {
  id: string;
  nameEn: string;
  nameAr?: string | null;
  sharedContentSubjectId?: string | null;
  grade?: { level: number };
  sharedContentSubject?: {
    id: string;
    nameEn: string;
    nameAr?: string | null;
    isActive: boolean;
    sharedContentSubjectId?: string | null;
    grade: { level: number; isActive: boolean; curriculum: { code: string; isActive: boolean } };
  } | null;
}): string | null {
  if (!subject.sharedContentSubjectId) return subject.id;
  const source = subject.sharedContentSubject;
  if (!source || source.id !== subject.sharedContentSubjectId || !source.isActive || source.sharedContentSubjectId != null) return null;
  if (!source.grade.isActive || !source.grade.curriculum.isActive || source.grade.curriculum.code !== "EG_NATIONAL" || source.grade.level !== subject.grade?.level) return null;
  const sourceKind = sharedSubjectKind(source.nameEn, source.nameAr);
  return sourceKind && sourceKind === sharedSubjectKind(subject.nameEn, subject.nameAr) ? source.id : null;
}

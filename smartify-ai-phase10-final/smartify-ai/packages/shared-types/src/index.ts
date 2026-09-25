// Types shared between apps/backend and apps/frontend.
// Mirrors the Prisma enums in packages/database — kept manually in sync
// (a codegen step can be added later if drift becomes a problem).

export enum UserRole {
  SUPER_ADMIN = "SUPER_ADMIN",
  ADMIN = "ADMIN",
  CONTENT_MANAGER = "CONTENT_MANAGER",
  SUPPORT = "SUPPORT",
  TEACHER = "TEACHER",
  PARENT = "PARENT",
  STUDENT = "STUDENT",
}

export enum QuestionType {
  MULTIPLE_CHOICE = "MULTIPLE_CHOICE",
  TRUE_FALSE = "TRUE_FALSE",
  SHORT_ANSWER = "SHORT_ANSWER",
  FILL_BLANK = "FILL_BLANK",
  MATCHING = "MATCHING",
  STEP_PROBLEM = "STEP_PROBLEM",
}

export enum Difficulty {
  EASY = "EASY",
  MEDIUM = "MEDIUM",
  HARD = "HARD",
}

export enum CurriculumCode {
  LOCAL = "LOCAL",
  EG_NATIONAL = "EG_NATIONAL",
  BRITISH_INTL = "BRITISH_INTL",
  AMERICAN_INTL = "AMERICAN_INTL",
}

export interface CurrentUser {
  id: string;
  clerkUserId: string;
  email: string;
  role: UserRole;
}

export interface StudentDashboardSummary {
  studentId: string;
  fullName: string;
  streakDays: number;
  weeklyStudyMinutes: number;
  subjectProgress: Array<{
    subjectId: string;
    subjectName: string;
    percentComplete: number;
  }>;
}

export type VisualInstruction =
  | { kind: "NUMBER_LINE"; min: number; max: number; marks: number[]; jumps?: Array<{ from: number; to: number; label?: string }>; altText: string }
  | { kind: "MULTIPLICATION_GROUPS"; groups: number; itemsPerGroup: number; item: "dot" | "apple" | "block"; altText: string }
  | { kind: "FRACTION_BAR"; numerator: number; denominator: number; segments: Array<"filled" | "empty">; altText: string }
  | { kind: "BAR_MODEL"; bars: Array<{ label?: string; value: number }>; total?: number; altText: string }
  | { kind: "PLACE_VALUE_BLOCKS"; thousands?: number; hundreds?: number; tens?: number; ones?: number; altText: string };

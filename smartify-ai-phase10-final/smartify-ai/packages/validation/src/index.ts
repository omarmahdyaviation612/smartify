import { z } from "zod";

// Shared request-validation schemas. Backend controllers use these as the
// single source of truth for input validation; frontend forms can reuse
// the same schema for client-side validation, avoiding drift.

export const updateUserRoleSchema = z.object({
  userId: z.string().cuid(),
  role: z.enum([
    "SUPER_ADMIN",
    "ADMIN",
    "CONTENT_MANAGER",
    "SUPPORT",
    "TEACHER",
    "PARENT",
    "STUDENT",
  ]),
});
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;

// Placeholder for Phase 4 onboarding — defined now so the shape is agreed
// on before the onboarding UI/API are built.
export const studentOnboardingSchema = z.object({
  fullName: z.string().min(2).max(100),
  age: z.number().int().min(4).max(25),
  country: z.string().min(2),
  preferredLang: z.enum(["ar", "en"]),
  curriculumCode: z.enum(["LOCAL", "EG_NATIONAL", "BRITISH_INTL", "AMERICAN_INTL"]),
  gradeId: z.string().cuid(),
  subjectIds: z.array(z.string().cuid()).min(1),
  weeklyStudyHours: z.number().int().min(0).max(60).optional(),
  goals: z.string().max(500).optional(),
});
export type StudentOnboardingInput = z.infer<typeof studentOnboardingSchema>;

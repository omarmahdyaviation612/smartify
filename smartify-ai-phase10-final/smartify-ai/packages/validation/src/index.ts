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

export const updatePaymentProviderSchema = z.object({
  isActive: z.boolean().optional(),
  publicConfig: z.record(z.unknown()).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const updateAIProviderSchema = z.object({
  model: z.string().trim().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
  costPerInputToken: z.number().nonnegative().finite().optional(),
  costPerOutputToken: z.number().nonnegative().finite().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const updateCurriculumSchema = z.object({
  nameEn: z.string().trim().min(1).max(200).optional(),
  nameAr: z.string().trim().min(1).max(200).optional(),
  isActive: z.boolean().optional(),
}).strict();

export const updateGradeSchema = z.object({
  nameEn: z.string().trim().min(1).max(200).optional(),
  nameAr: z.string().trim().min(1).max(200).optional(),
  level: z.number().int().min(1).max(20).optional(),
  isActive: z.boolean().optional(),
}).strict();

export const updateSubjectSchema = z.object({
  nameEn: z.string().trim().min(1).max(200).optional(),
  nameAr: z.string().trim().min(1).max(200).optional(),
  icon: z.string().trim().max(100).optional(),
  isActive: z.boolean().optional(),
}).strict();

// Phase 9.4B — SUPER_ADMIN AI spending controls. A dedicated endpoint (not
// the generic system-config/:key PATCH) so the per-user-budget <= global-
// budget cross-field rule can be enforced against the resulting combined
// state, not just the one field being changed.
export const updateAISpendingControlsSchema = z
  .object({
    globalDailyBudgetUsd: z.number().positive().finite().optional(),
    perUserDailyBudgetUsd: z.number().positive().finite().optional(),
    dailyQuestionsPerSubject: z.number().int().positive().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");
export type UpdateAISpendingControlsInput = z.infer<typeof updateAISpendingControlsSchema>;

export const updatePricingPlanSchema = z.object({
  monthlyPriceEGP: z.number().nonnegative().finite().optional(),
  includedSubjects: z.number().int().positive().optional(),
  additionalSubjectPriceEGP: z.number().nonnegative().finite().optional(),
  isActive: z.boolean().optional(),
}).strict();

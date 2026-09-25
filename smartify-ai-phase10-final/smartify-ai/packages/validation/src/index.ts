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
  // Subject-based pricing (2026-09-20) — nullable so an admin can
  // explicitly un-price a Subject (e.g. take it off sale) as well as set it.
  priceEGP: z.number().nonnegative().finite().nullable().optional(),
}).strict();

// Phase 9.4B — SUPER_ADMIN AI spending controls. A dedicated endpoint (not
// the generic system-config/:key PATCH) so the per-user-budget <= global-
// budget cross-field rule can be enforced against the resulting combined
// state, not just the one field being changed.
export const updateAISpendingControlsSchema = z
  .object({
    globalDailyBudgetUsd: z.number().positive().finite().optional(),
    perUserDailyBudgetUsd: z.number().positive().finite().optional(),
    // Independent platform content-authoring circuit breaker (2026-09-25)
    // — a separate cap from perUserDailyBudgetUsd, never reused. See
    // AIUsageService.assertWithinBudget/reserveBudget.
    platformContentAuthoringDailyBudgetUsd: z.number().positive().finite().optional(),
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

// Admin New Subject + Textbook Ingestion V1 — the shared Unit/Topic
// structure shape re-validated server-side at confirmation time, for BOTH
// a brand-new Subject's main textbook (confirmSubjectStructureSchema) and
// an existing Subject's extra/story book (confirmExtraBookStructureSchema,
// English Extra Book / Story support V1). sourcePageStart/sourcePageEnd on
// a topic are accepted but never persisted (Topic has no page-range
// columns) — kept optional here only so the preview UI can round-trip
// them without the request being rejected as unknown.
const tocUnitsSchema = z
  .array(
    z.object({
      nameEn: z.string().trim().min(1).max(200),
      nameAr: z.string().trim().min(1).max(200),
      sourcePageStart: z.number().int().positive(),
      sourcePageEnd: z.number().int().positive(),
      topics: z
        .array(
          z.object({
            nameEn: z.string().trim().min(1).max(200),
            nameAr: z.string().trim().min(1).max(200),
            sourcePageStart: z.number().int().positive().optional(),
            sourcePageEnd: z.number().int().positive().optional(),
          }),
        )
        .min(1),
    }),
  )
  .min(1);

// curriculumId and gradeId are included even though the Subject already
// has a gradeId in the DB: the backend re-derives the Subject's REAL
// grade/curriculum and rejects if it doesn't match what the client
// believes it's confirming against, rather than trusting the client's own
// relationship claim.
export const confirmSubjectStructureSchema = z.object({
  curriculumId: z.string().cuid(),
  gradeId: z.string().cuid(),
  units: tocUnitsSchema,
}).strict();
export type ConfirmSubjectStructureInput = z.infer<typeof confirmSubjectStructureSchema>;

// English Extra Book / Story support V1 (2026-09-20) — no curriculumId/
// gradeId here: this appends Units to an EXISTING Subject (identified by
// the URL's :id, fetched authoritatively server-side), it never asserts a
// Curriculum/Grade relationship the way creating a brand-new Subject does.
// `bookLabel` must be the exact same human-chosen label used at upload
// time — the backend re-derives the deterministic extra-book object key
// from it and verifies that object actually exists in storage before
// trusting it as this confirmation's source (see
// AdminCurriculumService.confirmExtraBookStructure).
export const confirmExtraBookStructureSchema = z.object({
  bookLabel: z.string().trim().min(1).max(200),
  units: tocUnitsSchema,
}).strict();
export type ConfirmExtraBookStructureInput = z.infer<typeof confirmExtraBookStructureSchema>;

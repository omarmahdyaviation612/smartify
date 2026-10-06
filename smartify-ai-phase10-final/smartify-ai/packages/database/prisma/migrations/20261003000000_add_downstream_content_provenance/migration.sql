-- Downstream content provenance (2026-10-03). Additive, nullable columns only:
-- no backfill, no default, existing rows stay NULL (= LEGACY provenance).
ALTER TABLE "Unit" ADD COLUMN "contentProvenanceEnforcedAt" TIMESTAMP(3);
ALTER TABLE "Topic" ADD COLUMN "groundingSourceFingerprintUsed" TEXT;
ALTER TABLE "Topic" ADD COLUMN "groundingAssignmentFingerprintUsed" TEXT;
ALTER TABLE "Question" ADD COLUMN "groundingSourceFingerprint" TEXT;
ALTER TABLE "Question" ADD COLUMN "groundingAssignmentFingerprint" TEXT;
ALTER TABLE "QuestionDraft" ADD COLUMN "groundingSourceFingerprint" TEXT;
ALTER TABLE "QuestionDraft" ADD COLUMN "groundingAssignmentFingerprint" TEXT;

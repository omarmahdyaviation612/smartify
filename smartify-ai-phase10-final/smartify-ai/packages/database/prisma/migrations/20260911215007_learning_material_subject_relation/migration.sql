-- LearningMaterial gains a direct Subject relationship (subjectId), and its
-- Topic relationship becomes optional (topicId nullable) — a material can
-- now be attached to a subject directly (importSubjectMaterial) or to a
-- specific topic within that subject (createMaterial), matching how the
-- application code has already been calling these fields.
--
-- Safe to apply directly without a phased backfill: LearningMaterial has
-- zero existing rows in every environment this migration has been
-- validated against (confirmed via `SELECT count(*)` before writing this
-- migration) — there is no data that could violate the new NOT NULL
-- constraint on subjectId, and no ambiguous topicId-to-subjectId mapping
-- to perform. If this is ever applied to an environment that already has
-- LearningMaterial rows, STOP and re-verify that assumption first — this
-- migration was written and reviewed only under the zero-row condition.

-- AlterTable
ALTER TABLE "LearningMaterial" ADD COLUMN     "subjectId" TEXT NOT NULL,
ALTER COLUMN "topicId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "LearningMaterial_subjectId_idx" ON "LearningMaterial"("subjectId");

-- AddForeignKey
ALTER TABLE "LearningMaterial" ADD CONSTRAINT "LearningMaterial_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

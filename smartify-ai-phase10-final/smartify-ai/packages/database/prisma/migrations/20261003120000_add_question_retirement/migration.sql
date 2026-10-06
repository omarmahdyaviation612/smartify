-- Question retirement (2026-10-03). Additive, nullable columns only:
-- no backfill, no default, existing rows stay NULL (= active). A retired
-- Question keeps its content and provenance and is never servable.
-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "replacedByQuestionId" TEXT,
ADD COLUMN     "retiredAt" TIMESTAMP(3),
ADD COLUMN     "retiredReason" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Question_replacedByQuestionId_key" ON "Question"("replacedByQuestionId");

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_replacedByQuestionId_fkey" FOREIGN KEY ("replacedByQuestionId") REFERENCES "Question"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Interactive Lesson engine (real-curriculum pilot): adds term support to
-- Unit, a compact ordered teaching-step structure to Topic, and a new
-- LessonSession table that tracks a student's resumable position inside a
-- specific lesson (Topic). Purely additive — a new enum, two new nullable
-- columns, and one new table with no impact on any existing row or query.
-- Existing Practice/Quiz/Tutor/Admin behavior is unaffected: Topic/Unit
-- rows without the new fields simply have them as NULL, exactly as before.

-- CreateEnum
CREATE TYPE "Term" AS ENUM ('TERM_1', 'TERM_2');

-- AlterTable
ALTER TABLE "Topic" ADD COLUMN     "teachingStepsJson" JSONB;

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "term" "Term";

-- CreateTable
CREATE TABLE "LessonSession" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "currentStepIndex" INTEGER NOT NULL DEFAULT 0,
    "stepResultsJson" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "LessonSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LessonSession_conversationId_key" ON "LessonSession"("conversationId");

-- CreateIndex
CREATE INDEX "LessonSession_studentId_idx" ON "LessonSession"("studentId");

-- CreateIndex
CREATE INDEX "LessonSession_topicId_idx" ON "LessonSession"("topicId");

-- CreateIndex
CREATE UNIQUE INDEX "LessonSession_studentId_topicId_key" ON "LessonSession"("studentId", "topicId");

-- AddForeignKey
ALTER TABLE "LessonSession" ADD CONSTRAINT "LessonSession_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonSession" ADD CONSTRAINT "LessonSession_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonSession" ADD CONSTRAINT "LessonSession_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AIConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

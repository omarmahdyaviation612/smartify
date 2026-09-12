-- CreateTable
CREATE TABLE "LessonDraft" (
    "id" TEXT NOT NULL,
    "targetUnitId" TEXT,
    "topicNameEn" TEXT NOT NULL,
    "topicNameAr" TEXT NOT NULL,
    "learningObjectivesJson" JSONB NOT NULL,
    "teachingStepsJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_review',
    "aiProvider" TEXT NOT NULL,
    "aiModel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,

    CONSTRAINT "LessonDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LessonDraft_status_idx" ON "LessonDraft"("status");

-- AddForeignKey
ALTER TABLE "LessonDraft" ADD CONSTRAINT "LessonDraft_targetUnitId_fkey" FOREIGN KEY ("targetUnitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

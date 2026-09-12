-- CreateTable
CREATE TABLE "LessonVisualAsset" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonVisualAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LessonVisualAsset_topicId_stepId_key" ON "LessonVisualAsset"("topicId", "stepId");

-- AddForeignKey
ALTER TABLE "LessonVisualAsset" ADD CONSTRAINT "LessonVisualAsset_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

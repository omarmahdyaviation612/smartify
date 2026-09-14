-- AlterTable
ALTER TABLE "LessonDraft" ADD COLUMN     "publishedTopicId" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "LessonDraft_publishedTopicId_key" ON "LessonDraft"("publishedTopicId");

-- AddForeignKey
ALTER TABLE "LessonDraft" ADD CONSTRAINT "LessonDraft_publishedTopicId_fkey" FOREIGN KEY ("publishedTopicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

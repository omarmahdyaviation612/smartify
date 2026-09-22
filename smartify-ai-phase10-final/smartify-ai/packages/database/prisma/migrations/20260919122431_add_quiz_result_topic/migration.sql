-- AlterTable
ALTER TABLE "QuizResult" ADD COLUMN     "topicId" TEXT;

-- CreateIndex
CREATE INDEX "QuizResult_topicId_idx" ON "QuizResult"("topicId");

-- AddForeignKey
ALTER TABLE "QuizResult" ADD CONSTRAINT "QuizResult_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

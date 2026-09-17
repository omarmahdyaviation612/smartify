-- CreateTable
CREATE TABLE "QuestionDraft" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "difficulty" "Difficulty" NOT NULL,
    "promptEn" TEXT NOT NULL,
    "promptAr" TEXT,
    "optionsJson" JSONB,
    "correctAnswerJson" JSONB NOT NULL,
    "explanationEn" TEXT,
    "explanationAr" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_review',
    "isAiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "aiProvider" TEXT,
    "aiModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "rejectionReason" TEXT,
    "publishedQuestionId" TEXT,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "QuestionDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuestionDraft_publishedQuestionId_key" ON "QuestionDraft"("publishedQuestionId");

-- CreateIndex
CREATE INDEX "QuestionDraft_status_idx" ON "QuestionDraft"("status");

-- CreateIndex
CREATE INDEX "QuestionDraft_topicId_idx" ON "QuestionDraft"("topicId");

-- AddForeignKey
ALTER TABLE "QuestionDraft" ADD CONSTRAINT "QuestionDraft_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionDraft" ADD CONSTRAINT "QuestionDraft_publishedQuestionId_fkey" FOREIGN KEY ("publishedQuestionId") REFERENCES "Question"("id") ON DELETE SET NULL ON UPDATE CASCADE;

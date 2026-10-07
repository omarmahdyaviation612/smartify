ALTER TABLE "ParentProfile"
  ADD COLUMN "notificationLocale" TEXT NOT NULL DEFAULT 'ar';

CREATE TABLE "PracticeSubmission" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "correctCount" INTEGER NOT NULL,
  "total" INTEGER NOT NULL,
  "subjectIds" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PracticeSubmission_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PracticeSubmission_correctCount_check" CHECK ("correctCount" >= 0 AND "correctCount" <= "total"),
  CONSTRAINT "PracticeSubmission_total_check" CHECK ("total" >= 0)
);
CREATE UNIQUE INDEX "PracticeSubmission_studentId_idempotencyKey_key" ON "PracticeSubmission"("studentId", "idempotencyKey");
CREATE INDEX "PracticeSubmission_studentId_createdAt_idx" ON "PracticeSubmission"("studentId", "createdAt");
ALTER TABLE "PracticeSubmission" ADD CONSTRAINT "PracticeSubmission_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ParentResultNotification" (
  "id" TEXT NOT NULL,
  "parentId" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "quizResultId" TEXT,
  "practiceSubmissionId" TEXT,
  "summaryJson" JSONB NOT NULL,
  "emailStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "emailFailureCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ParentResultNotification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ParentResultNotification_one_result_check" CHECK (("quizResultId" IS NOT NULL) <> ("practiceSubmissionId" IS NOT NULL))
);
CREATE UNIQUE INDEX "ParentResultNotification_parentId_eventKey_key" ON "ParentResultNotification"("parentId", "eventKey");
CREATE INDEX "ParentResultNotification_parentId_createdAt_idx" ON "ParentResultNotification"("parentId", "createdAt");
CREATE INDEX "ParentResultNotification_emailStatus_createdAt_idx" ON "ParentResultNotification"("emailStatus", "createdAt");
ALTER TABLE "ParentResultNotification" ADD CONSTRAINT "ParentResultNotification_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "ParentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParentResultNotification" ADD CONSTRAINT "ParentResultNotification_quizResultId_fkey"
  FOREIGN KEY ("quizResultId") REFERENCES "QuizResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParentResultNotification" ADD CONSTRAINT "ParentResultNotification_practiceSubmissionId_fkey"
  FOREIGN KEY ("practiceSubmissionId") REFERENCES "PracticeSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

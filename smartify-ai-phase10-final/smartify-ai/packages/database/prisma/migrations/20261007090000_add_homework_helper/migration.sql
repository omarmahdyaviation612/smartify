-- Add Homework Helper state without granting access to historical subscriptions.
ALTER TABLE "Subscription"
  ADD COLUMN "homeworkAddonActive" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "homeworkAddonMonthlyAmountEGP" DECIMAL(65,30),
  ADD COLUMN "homeworkAddonMonthlyAllowance" INTEGER,
  ADD COLUMN "homeworkAddonPendingActive" BOOLEAN,
  ADD COLUMN "homeworkAddonPendingAmountEGP" DECIMAL(65,30),
  ADD COLUMN "homeworkAddonPendingAllowance" INTEGER;

-- Pricing and monthly limits are trusted server-side configuration; the client only selects a tier.
INSERT INTO "SystemConfig" ("key", "value", "description", "updatedAt") VALUES
  ('homework_addon_price_10_egp', '150'::jsonb, 'Monthly Homework Helper price for up to 10 exercises (EGP)', CURRENT_TIMESTAMP),
  ('homework_addon_price_20_egp', '250'::jsonb, 'Monthly Homework Helper price for up to 20 exercises (EGP)', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

CREATE TABLE "HomeworkSession" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "accessSubjectId" TEXT NOT NULL,
  "topicId" TEXT,
  "curriculumId" TEXT NOT NULL,
  "gradeId" TEXT NOT NULL,
  "extractedQuestion" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'AWAITING_TOPIC_CONFIRMATION',
  "incorrectAttemptCount" INTEGER NOT NULL DEFAULT 0,
  "solutionRevealed" BOOLEAN NOT NULL DEFAULT false,
  "solvedAt" TIMESTAMP(3),
  "turnLockExpiresAt" TIMESTAMP(3),
  "turnLockToken" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HomeworkSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HomeworkMessage" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "kind" TEXT,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HomeworkMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HomeworkAllowanceCounter" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "reserved" INTEGER NOT NULL DEFAULT 0,
  "consumed" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HomeworkAllowanceCounter_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HomeworkAllowanceReservation" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RESERVED',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HomeworkAllowanceReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HomeworkAllowanceCounter_studentId_periodStart_key"
  ON "HomeworkAllowanceCounter"("studentId", "periodStart");
CREATE UNIQUE INDEX "HomeworkAllowanceReservation_sessionId_key"
  ON "HomeworkAllowanceReservation"("sessionId");
CREATE INDEX "HomeworkSession_studentId_updatedAt_idx"
  ON "HomeworkSession"("studentId", "updatedAt");
CREATE INDEX "HomeworkSession_subjectId_status_idx"
  ON "HomeworkSession"("subjectId", "status");
CREATE INDEX "HomeworkSession_topicId_idx" ON "HomeworkSession"("topicId");
CREATE INDEX "HomeworkMessage_sessionId_createdAt_idx"
  ON "HomeworkMessage"("sessionId", "createdAt");
CREATE INDEX "HomeworkAllowanceReservation_studentId_periodStart_status_idx"
  ON "HomeworkAllowanceReservation"("studentId", "periodStart", "status");
CREATE INDEX "HomeworkAllowanceReservation_status_expiresAt_idx"
  ON "HomeworkAllowanceReservation"("status", "expiresAt");

ALTER TABLE "HomeworkSession"
  ADD CONSTRAINT "HomeworkSession_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "HomeworkSession_subjectId_fkey"
    FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "HomeworkSession_accessSubjectId_fkey"
    FOREIGN KEY ("accessSubjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "HomeworkSession_topicId_fkey"
    FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "HomeworkSession_curriculumId_fkey"
    FOREIGN KEY ("curriculumId") REFERENCES "Curriculum"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "HomeworkSession_gradeId_fkey"
    FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HomeworkMessage"
  ADD CONSTRAINT "HomeworkMessage_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "HomeworkSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HomeworkAllowanceCounter"
  ADD CONSTRAINT "HomeworkAllowanceCounter_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HomeworkAllowanceReservation"
  ADD CONSTRAINT "HomeworkAllowanceReservation_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "HomeworkSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "HomeworkAllowanceReservation_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

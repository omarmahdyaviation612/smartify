CREATE TABLE "TeacherSessionRequest" (
  "id" TEXT NOT NULL,
  "parentId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "topicId" TEXT,
  "preferredTimes" TEXT NOT NULL,
  "contactNote" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "adminNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeacherSessionRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TeacherSessionRequest_status_check" CHECK ("status" IN ('PENDING', 'CONTACTED', 'CONFIRMED', 'DECLINED'))
);

CREATE INDEX "TeacherSessionRequest_parentId_status_createdAt_idx" ON "TeacherSessionRequest"("parentId", "status", "createdAt");
CREATE INDEX "TeacherSessionRequest_status_createdAt_idx" ON "TeacherSessionRequest"("status", "createdAt");
ALTER TABLE "TeacherSessionRequest" ADD CONSTRAINT "TeacherSessionRequest_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ParentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeacherSessionRequest" ADD CONSTRAINT "TeacherSessionRequest_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeacherSessionRequest" ADD CONSTRAINT "TeacherSessionRequest_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeacherSessionRequest" ADD CONSTRAINT "TeacherSessionRequest_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "GradeSubject" (
    "id" TEXT NOT NULL,
    "gradeId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GradeSubject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GradeSubject_gradeId_isActive_idx" ON "GradeSubject"("gradeId", "isActive");

-- CreateIndex
CREATE INDEX "GradeSubject_subjectId_idx" ON "GradeSubject"("subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "GradeSubject_gradeId_subjectId_key" ON "GradeSubject"("gradeId", "subjectId");

-- AddForeignKey
ALTER TABLE "GradeSubject" ADD CONSTRAINT "GradeSubject_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeSubject" ADD CONSTRAINT "GradeSubject_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill (2026-10-06): every Subject must be offered by its own content-home
-- grade. This is what makes Phase 1 behavior-identical to the pre-change
-- application: every existing subject stays exactly as reachable as it was.
-- Subject.gradeId is the CONTENT HOME and is never modified here.
INSERT INTO "GradeSubject" ("id", "gradeId", "subjectId", "isActive", "createdAt")
SELECT gen_random_uuid()::text, s."gradeId", s."id", true, NOW()
FROM "Subject" s
ON CONFLICT ("gradeId", "subjectId") DO NOTHING;

-- Fail loudly rather than shipping a half-backfilled table. Prisma runs each
-- migration inside a transaction on PostgreSQL, so raising here rolls the
-- whole migration back.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Subject" s
    WHERE NOT EXISTS (SELECT 1 FROM "GradeSubject" gs WHERE gs."subjectId" = s."id")
  ) THEN
    RAISE EXCEPTION 'GradeSubject backfill incomplete: some Subjects have no offering';
  END IF;
END $$;

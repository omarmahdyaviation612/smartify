ALTER TABLE "Subject"
ADD COLUMN "sharedContentSubjectId" TEXT;

CREATE INDEX "Subject_sharedContentSubjectId_idx"
ON "Subject"("sharedContentSubjectId");

ALTER TABLE "Subject"
ADD CONSTRAINT "Subject_sharedContentSubjectId_fkey"
FOREIGN KEY ("sharedContentSubjectId") REFERENCES "Subject"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

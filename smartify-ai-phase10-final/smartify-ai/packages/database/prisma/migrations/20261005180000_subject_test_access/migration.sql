ALTER TABLE "User" ADD COLUMN "isTestStudent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Subscription" ADD COLUMN "pendingSubjectChange" JSONB;

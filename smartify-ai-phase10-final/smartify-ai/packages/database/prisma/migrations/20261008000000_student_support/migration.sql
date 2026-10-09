ALTER TABLE "AIBudgetReservation"
  ADD COLUMN "featureScope" TEXT,
  ADD COLUMN "featureScopeKey" TEXT;

INSERT INTO "SystemConfig" ("key", "value", "description", "updatedAt") VALUES
  ('student_support_daily_budget_usd', '2'::jsonb, 'Maximum AI spend per day for the dedicated student technical-support assistant.', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

CREATE TYPE "StudentSupportStatus" AS ENUM ('AI_ASSISTING', 'NEW', 'IN_PROGRESS', 'CLOSED');

CREATE TABLE "StudentSupportTicket" (
  "id" TEXT NOT NULL,
  "studentUserId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" "StudentSupportStatus" NOT NULL DEFAULT 'AI_ASSISTING',
  "screenshotKey" TEXT,
  "screenshotMime" TEXT,
  "route" TEXT,
  "locale" TEXT NOT NULL DEFAULT 'en',
  "assignedToId" TEXT,
  "closedAt" TIMESTAMP(3),
  "contentDeletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudentSupportTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudentSupportMessage" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentSupportMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StudentSupportTicket_studentUserId_updatedAt_idx" ON "StudentSupportTicket"("studentUserId", "updatedAt");
CREATE INDEX "StudentSupportTicket_status_updatedAt_idx" ON "StudentSupportTicket"("status", "updatedAt");
CREATE INDEX "StudentSupportTicket_closedAt_idx" ON "StudentSupportTicket"("closedAt");
CREATE INDEX "StudentSupportMessage_ticketId_createdAt_idx" ON "StudentSupportMessage"("ticketId", "createdAt");
ALTER TABLE "StudentSupportTicket" ADD CONSTRAINT "StudentSupportTicket_studentUserId_fkey" FOREIGN KEY ("studentUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentSupportMessage" ADD CONSTRAINT "StudentSupportMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "StudentSupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

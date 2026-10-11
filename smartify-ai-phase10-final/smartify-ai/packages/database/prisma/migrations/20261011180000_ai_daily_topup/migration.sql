-- Extra daily AI allowance bought via manual InstaPay (50 EGP).
ALTER TYPE "InstapayPurchaseKind" ADD VALUE IF NOT EXISTS 'AI_DAILY_TOPUP';

ALTER TABLE "InstapayPaymentSubmission" ADD COLUMN "topUpPurchaseId" TEXT;

CREATE TABLE "AIDailyTopUpPurchase" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "amountEGP" DECIMAL(65,30) NOT NULL,
  "status" TEXT NOT NULL,
  "paymentProvider" TEXT,
  "externalSessionId" TEXT,
  "externalEventId" TEXT,
  "grantedUsageDate" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AIDailyTopUpPurchase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AIDailyTopUpPurchase_externalSessionId_key" ON "AIDailyTopUpPurchase"("externalSessionId");
CREATE UNIQUE INDEX "AIDailyTopUpPurchase_paymentProvider_externalEventId_key" ON "AIDailyTopUpPurchase"("paymentProvider", "externalEventId");
CREATE INDEX "AIDailyTopUpPurchase_userId_status_grantedUsageDate_idx" ON "AIDailyTopUpPurchase"("userId", "status", "grantedUsageDate");
CREATE INDEX "AIDailyTopUpPurchase_studentId_status_idx" ON "AIDailyTopUpPurchase"("studentId", "status");

ALTER TABLE "AIDailyTopUpPurchase" ADD CONSTRAINT "AIDailyTopUpPurchase_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

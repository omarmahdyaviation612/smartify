-- CreateEnum
CREATE TYPE "InstapayPurchaseKind" AS ENUM ('SUBSCRIPTION', 'QUESTION_PACK');

-- CreateEnum
CREATE TYPE "InstapaySubmissionStatus" AS ENUM ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED');

-- CreateTable
CREATE TABLE "InstapayPaymentSubmission" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "kind" "InstapayPurchaseKind" NOT NULL,
    "subscriptionId" TEXT,
    "packPurchaseId" TEXT,
    "referenceId" TEXT NOT NULL,
    "expectedAmountEGP" DECIMAL(65,30) NOT NULL,
    "submittedAmountEGP" DECIMAL(65,30) NOT NULL,
    "senderName" TEXT,
    "note" TEXT,
    "receiptImage" BYTEA NOT NULL,
    "receiptMimeType" TEXT NOT NULL,
    "status" "InstapaySubmissionStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "verifiedByUserId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedByUserId" TEXT,
    "rejectionReason" TEXT,

    CONSTRAINT "InstapayPaymentSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InstapayPaymentSubmission_referenceId_key" ON "InstapayPaymentSubmission"("referenceId");

-- CreateIndex
CREATE INDEX "InstapayPaymentSubmission_status_idx" ON "InstapayPaymentSubmission"("status");

-- CreateIndex
CREATE INDEX "InstapayPaymentSubmission_studentId_idx" ON "InstapayPaymentSubmission"("studentId");

-- AddForeignKey
ALTER TABLE "InstapayPaymentSubmission" ADD CONSTRAINT "InstapayPaymentSubmission_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

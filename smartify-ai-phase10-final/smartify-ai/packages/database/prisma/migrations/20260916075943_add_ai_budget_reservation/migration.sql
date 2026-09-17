-- CreateEnum
CREATE TYPE "AIBudgetReservationStatus" AS ENUM ('RESERVED', 'RECONCILED', 'RELEASED');

-- CreateTable
CREATE TABLE "AIDailyBudgetCounter" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "usageDate" TIMESTAMP(3) NOT NULL,
    "committedUsd" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIDailyBudgetCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIBudgetReservation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "usageDate" TIMESTAMP(3) NOT NULL,
    "estimatedUsd" DECIMAL(65,30) NOT NULL,
    "reconciledUsd" DECIMAL(65,30),
    "status" "AIBudgetReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIBudgetReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AIDailyBudgetCounter_scope_scopeKey_usageDate_key" ON "AIDailyBudgetCounter"("scope", "scopeKey", "usageDate");

-- CreateIndex
CREATE INDEX "AIBudgetReservation_userId_createdAt_idx" ON "AIBudgetReservation"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AIBudgetReservation_status_idx" ON "AIBudgetReservation"("status");

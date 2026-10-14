CREATE TYPE "UnitGroundingProgressStatus" AS ENUM ('IN_PROGRESS', 'RETRYABLE_FAILURE', 'CONFIGURATION_ERROR', 'READY');

CREATE TABLE "UnitGroundingProgress" (
  "id" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "status" "UnitGroundingProgressStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "sourceKey" TEXT NOT NULL,
  "sourceFingerprint" TEXT NOT NULL,
  "sourcePageStart" INTEGER NOT NULL,
  "sourcePageEnd" INTEGER NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "providerModel" TEXT NOT NULL,
  "rendererVersion" TEXT NOT NULL,
  "chunkPlanJson" JSONB NOT NULL,
  "completedChunksJson" JSONB NOT NULL,
  "nextEligibleAt" TIMESTAMP(3),
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "lastErrorCode" TEXT,
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UnitGroundingProgress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UnitGroundingProgress_unitId_key" ON "UnitGroundingProgress"("unitId");
CREATE INDEX "UnitGroundingProgress_status_nextEligibleAt_idx" ON "UnitGroundingProgress"("status", "nextEligibleAt");
CREATE INDEX "UnitGroundingProgress_leaseExpiresAt_idx" ON "UnitGroundingProgress"("leaseExpiresAt");
ALTER TABLE "UnitGroundingProgress" ADD CONSTRAINT "UnitGroundingProgress_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

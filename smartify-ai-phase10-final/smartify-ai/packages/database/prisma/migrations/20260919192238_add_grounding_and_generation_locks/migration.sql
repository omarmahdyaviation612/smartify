-- AlterTable
ALTER TABLE "Topic" ADD COLUMN     "generationLockedAt" TIMESTAMP(3),
ADD COLUMN     "generationLockedBy" TEXT;

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "groundingLockedAt" TIMESTAMP(3),
ADD COLUMN     "groundingLockedBy" TEXT;

-- AlterTable
ALTER TABLE "Subject" ADD COLUMN     "sourceFile" TEXT;

-- AlterTable
ALTER TABLE "Topic" ADD COLUMN     "contentGeneratedAt" TIMESTAMP(3),
ADD COLUMN     "generationPromptVersion" TEXT,
ADD COLUMN     "generationSource" TEXT,
ADD COLUMN     "groundingVersionUsed" INTEGER;

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "groundingGeneratedAt" TIMESTAMP(3),
ADD COLUMN     "groundingModel" TEXT,
ADD COLUMN     "groundingNotesJson" JSONB,
ADD COLUMN     "groundingPromptVersion" TEXT,
ADD COLUMN     "groundingSourceFingerprint" TEXT,
ADD COLUMN     "groundingVersion" INTEGER,
ADD COLUMN     "sourcePageEnd" INTEGER,
ADD COLUMN     "sourcePageStart" INTEGER;

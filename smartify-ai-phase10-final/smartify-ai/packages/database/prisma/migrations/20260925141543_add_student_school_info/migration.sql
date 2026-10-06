-- AlterTable
ALTER TABLE "StudentProfile" ADD COLUMN     "area" TEXT,
ADD COLUMN     "governorate" TEXT,
ADD COLUMN     "schoolId" TEXT,
ADD COLUMN     "schoolNameManual" TEXT;

-- CreateTable
CREATE TABLE "School" (
    "id" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT,
    "governorate" TEXT NOT NULL,
    "area" TEXT,
    "source" TEXT NOT NULL,
    "externalRef" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "School_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "School_governorate_isActive_idx" ON "School"("governorate", "isActive");

-- CreateIndex
CREATE INDEX "School_governorate_area_idx" ON "School"("governorate", "area");

-- AddForeignKey
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

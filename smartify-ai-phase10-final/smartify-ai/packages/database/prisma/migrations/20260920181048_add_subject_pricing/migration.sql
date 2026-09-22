-- DropForeignKey
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_pricingPlanId_fkey";

-- AlterTable
ALTER TABLE "Subject" ADD COLUMN     "priceEGP" DECIMAL(65,30);

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "selectedSubjectIds" JSONB,
ALTER COLUMN "pricingPlanId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_pricingPlanId_fkey" FOREIGN KEY ("pricingPlanId") REFERENCES "PricingPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

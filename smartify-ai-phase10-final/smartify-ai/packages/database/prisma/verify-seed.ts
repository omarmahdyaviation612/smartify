import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [curricula, pricingPlans, aiProviders, paymentProviders, duplicateGrades] = await Promise.all([
    prisma.curriculum.count(),
    prisma.pricingPlan.count(),
    prisma.aIProviderConfig.count(),
    prisma.paymentProviderConfig.count(),
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM (
        SELECT "curriculumId", level FROM "Grade" GROUP BY "curriculumId", level HAVING count(*) > 1
      ) duplicates
    `,
  ]);

  const failures: string[] = [];
  if (curricula !== 4) failures.push(`expected 4 curricula, found ${curricula}`);
  if (pricingPlans !== 16) failures.push(`expected 16 pricing plans, found ${pricingPlans}`);
  if (aiProviders < 1) failures.push("expected at least one AI provider configuration");
  if (paymentProviders !== 5) failures.push(`expected 5 payment provider configurations, found ${paymentProviders}`);
  if (Number(duplicateGrades[0]?.count ?? 0) !== 0) failures.push("duplicate curriculum/grade levels found");
  if (failures.length) throw new Error(`Seed verification failed: ${failures.join("; ")}`);

  console.log(JSON.stringify({ curricula, pricingPlans, aiProviders, paymentProviders, duplicateGradeLevels: 0 }));
}

main().finally(() => prisma.$disconnect());

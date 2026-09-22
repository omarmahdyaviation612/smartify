// Configuration only. Uses DATABASE_URL from the runtime environment.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const provider = {
    providerKey: "openai",
    model: "gpt-4o-mini",
    isActive: true,
    costPerInputToken: 0.00000015,
    costPerOutputToken: 0.0000006,
  };

  await prisma.aIProviderConfig.upsert({
    where: { providerKey: provider.providerKey },
    update: provider,
    create: provider,
  });

  // Match seed-ai-budget-config.ts values and create-only-if-missing semantics.
  // Missing budgets block AI/TTS requests; preserve existing admin-set caps.
  for (const config of [
    {
      key: "global_daily_ai_budget_usd",
      value: 5.0,
      description: "Maximum combined AI/TTS spend allowed per day, across all students.",
    },
    {
      key: "per_user_daily_ai_budget_usd",
      value: 0.25,
      description: "Maximum AI/TTS spend one student may consume per day.",
    },
  ]) {
    await prisma.systemConfig.upsert({
      where: { key: config.key },
      update: {},
      create: config,
    });
  }

  console.log("Production AI provider and required budget configuration seeded.");
}

main()
  .catch(() => {
    // Do not print connection details or runtime secrets on failure.
    console.error("Production configuration seed failed.");
    process.exitCode = 1;
  })
  .finally(async () => { await prisma.$disconnect(); });

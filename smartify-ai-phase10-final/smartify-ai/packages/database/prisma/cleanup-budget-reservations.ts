/**
 * Phase 9.4D: idempotent maintenance command that prunes rows from
 * AIDailyBudgetCounter and AIBudgetReservation that have aged past their
 * operational usefulness. Neither table is ever read for anything but
 * TODAY's date (see AIUsageService.startOfToday()), so once a row's day
 * has fully passed and cleared a retention window kept for debugging,
 * it has zero further purpose — the permanent, full-detail audit trail
 * for real AI cost lives in AIUsage (userId/feature/tokens/costUsd per
 * real call), which this script never touches.
 *
 * Safety, by construction:
 *  - RESERVED reservations are NEVER deleted, regardless of age — a
 *    RESERVED row represents budget still committed against a live
 *    accumulator; deleting it would silently "forget" that commitment
 *    without ever releasing it. Only RECONCILED/RELEASED (terminal)
 *    reservations are eligible.
 *  - Rows from today (or within --retention-days, default 30) are never
 *    eligible, regardless of status.
 *  - Deletes run in bounded batches (--batch-size, default 5000) and are
 *    safe to re-run or resume after an interruption — each batch is
 *    independently deleted by primary key, and a re-run simply finds
 *    fewer (or zero) remaining eligible rows.
 *  - --dry-run reports exactly what WOULD be deleted (counts only) and
 *    deletes nothing — always run this first.
 *  - AIUsage is never read or written by this script.
 *
 * Usage (from packages/database):
 *   pnpm exec tsx prisma/cleanup-budget-reservations.ts --dry-run
 *   pnpm exec tsx prisma/cleanup-budget-reservations.ts --retention-days=30 --batch-size=5000
 *
 * This is a manually-run command, not a cron job — the project has no
 * existing approved scheduling mechanism (no @nestjs/schedule, no cron
 * package), and Phase 9.4D's instructions are explicit not to add one.
 */
import { PrismaClient } from "@prisma/client";

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_BATCH_SIZE = 5000;

function parseArgs(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const retentionArg = argv.find((a) => a.startsWith("--retention-days="));
  const retentionDays = retentionArg ? Number(retentionArg.split("=")[1]) : DEFAULT_RETENTION_DAYS;
  const batchArg = argv.find((a) => a.startsWith("--batch-size="));
  const batchSize = batchArg ? Number(batchArg.split("=")[1]) : DEFAULT_BATCH_SIZE;

  if (!Number.isFinite(retentionDays) || retentionDays < 1) {
    throw new Error(`Invalid --retention-days: ${retentionDays} — must be a positive number.`);
  }
  if (!Number.isFinite(batchSize) || batchSize < 1) {
    throw new Error(`Invalid --batch-size: ${batchSize} — must be a positive number.`);
  }
  return { dryRun, retentionDays, batchSize };
}

async function deleteInBatches(
  label: string,
  batchSize: number,
  findBatch: () => Promise<Array<{ id: string }>>,
  deleteIds: (ids: string[]) => Promise<number>,
): Promise<number> {
  let deleted = 0;
  for (;;) {
    const batch = await findBatch();
    if (batch.length === 0) break;
    const count = await deleteIds(batch.map((r) => r.id));
    deleted += count;
    console.log(`[cleanup-budget-reservations] Deleted ${count} ${label} row(s) (running total: ${deleted}).`);
    if (batch.length < batchSize) break;
  }
  return deleted;
}

export async function runCleanup(argv: string[] = process.argv.slice(2)): Promise<{
  dryRun: boolean;
  retentionDays: number;
  cutoff: Date;
  eligibleCounters: number;
  eligibleReservations: number;
  deletedCounters: number;
  deletedReservations: number;
}> {
  const { dryRun, retentionDays, batchSize } = parseArgs(argv);

  const cutoff = new Date();
  // Match the UTC daily keys used by AIUsageService, including across DST.
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);

  const counterWhere = { usageDate: { lt: cutoff } };
  const reservationWhere = {
    status: { in: ["RECONCILED", "RELEASED"] as ("RECONCILED" | "RELEASED")[] },
    usageDate: { lt: cutoff },
  };

  const prisma = new PrismaClient();
  try {
    const [eligibleCounters, eligibleReservations] = await Promise.all([
      prisma.aIDailyBudgetCounter.count({ where: counterWhere }),
      prisma.aIBudgetReservation.count({ where: reservationWhere }),
    ]);

    console.log(
      `[cleanup-budget-reservations] ${dryRun ? "DRY RUN — " : ""}retentionDays=${retentionDays} cutoff=${cutoff.toISOString()} ` +
        `eligibleCounters=${eligibleCounters} eligibleReservations=${eligibleReservations}`,
    );

    if (dryRun) {
      return { dryRun, retentionDays, cutoff, eligibleCounters, eligibleReservations, deletedCounters: 0, deletedReservations: 0 };
    }

    const deletedCounters = await deleteInBatches(
      "AIDailyBudgetCounter",
      batchSize,
      () => prisma.aIDailyBudgetCounter.findMany({ where: counterWhere, select: { id: true }, take: batchSize }),
      async (ids) => (await prisma.aIDailyBudgetCounter.deleteMany({ where: { id: { in: ids } } })).count,
    );
    const deletedReservations = await deleteInBatches(
      "AIBudgetReservation",
      batchSize,
      () => prisma.aIBudgetReservation.findMany({ where: reservationWhere, select: { id: true }, take: batchSize }),
      async (ids) => (await prisma.aIBudgetReservation.deleteMany({ where: { id: { in: ids } } })).count,
    );

    console.log(`[cleanup-budget-reservations] Done. deletedCounters=${deletedCounters} deletedReservations=${deletedReservations}`);
    return { dryRun, retentionDays, cutoff, eligibleCounters, eligibleReservations, deletedCounters, deletedReservations };
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runCleanup().catch((err) => {
    console.error(`[cleanup-budget-reservations] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}

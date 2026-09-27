/**
 * Narrow, auditable, one-time recovery for the 2026-09-26 provider-outage
 * incident: an OpenAI account-level "no credits remaining" 429
 * (isQuotaError) was, before commit <this fix's SHA>, treated identically
 * to any other transient grounding failure and consumed the per-Unit
 * retry ceiling — converting a batch of Units to CONFIGURATION_ERROR
 * (`lastErrorCode: "retryable_failure_limit_exceeded"`) purely because the
 * WHOLE provider account had zero credits during a bounded window, not
 * because anything about those specific Units was actually broken.
 *
 * This script does NOT touch:
 *   - sourceKey / sourceFingerprint / promptVersion / providerModel /
 *     rendererVersion (grounding IDENTITY — completely untouched, so no
 *     grounding-contract/version bump is used or needed here)
 *   - chunkPlanJson / completedChunksJson (already-completed chunks are
 *     preserved exactly — resuming picks up from the next uncompleted
 *     chunk, nothing is re-done)
 *   - groundingNotesJson on the Unit itself (nothing here has ever
 *     completed grounding — recovered rows just resume mid-flight)
 *   - any UnitGroundingProgress row that doesn't match BOTH the exact
 *     lastErrorCode this incident produced AND the incident's own time
 *     window (see INCIDENT_WINDOW_START/END below) — an unrelated
 *     CONFIGURATION_ERROR row (a genuinely broken Unit, or one from a
 *     future/different incident) is never touched.
 *
 * It only flips: status ("CONFIGURATION_ERROR" -> "IN_PROGRESS"),
 * lastErrorCode (-> null), retryCount (-> 0), nextEligibleAt (-> null),
 * leaseOwner/leaseExpiresAt (-> null, in case a lease was somehow left
 * stale). The very next real request for a recovered Unit resumes
 * normally through prepareNextGroundingChunk()'s existing claimNextChunk()
 * path — no manual grounding trigger required.
 *
 * Usage:
 *   pnpm --filter backend exec ts-node src/scripts/recover-provider-outage-progress.ts             (dry run — default, lists exactly which rows qualify, writes nothing)
 *   pnpm --filter backend exec ts-node src/scripts/recover-provider-outage-progress.ts --apply      (writes — only after the dry-run list has been reviewed and approved)
 *
 * Production: railway ssh -- node apps/backend/dist/scripts/recover-provider-outage-progress.js [--apply]
 */
import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";

// The incident's own bounded window — read-only-verified start/end of the
// run that produced these rows (2026-09-26, ~19:30–20:07 UTC). Narrower
// than "any row with this lastErrorCode, ever" on purpose: a genuinely
// different, unrelated ceiling-exhaustion incident before or after this
// window must never be swept up by this one-time recovery.
const INCIDENT_WINDOW_START = new Date("2026-09-26T19:30:00.000Z");
const INCIDENT_WINDOW_END = new Date("2026-09-26T21:00:00.000Z");
const INCIDENT_LAST_ERROR_CODE = "retryable_failure_limit_exceeded";

async function main() {
  const apply = process.argv.includes("--apply");
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  try {
    const prisma = app.get(PrismaService);

    const candidates = await prisma.client.unitGroundingProgress.findMany({
      where: {
        status: "CONFIGURATION_ERROR",
        lastErrorCode: INCIDENT_LAST_ERROR_CODE,
        updatedAt: { gte: INCIDENT_WINDOW_START, lte: INCIDENT_WINDOW_END },
      },
      select: {
        unitId: true, status: true, lastErrorCode: true, retryCount: true, updatedAt: true,
        sourceKey: true, sourceFingerprint: true, promptVersion: true, providerModel: true, rendererVersion: true,
        chunkPlanJson: true, completedChunksJson: true,
      },
    });

    console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
    console.log(`Incident window: ${INCIDENT_WINDOW_START.toISOString()} .. ${INCIDENT_WINDOW_END.toISOString()}`);
    console.log(`Qualifying rows (status=CONFIGURATION_ERROR, lastErrorCode="${INCIDENT_LAST_ERROR_CODE}", within window): ${candidates.length}\n`);

    for (const row of candidates) {
      const completed = Array.isArray(row.completedChunksJson) ? (row.completedChunksJson as unknown[]).length : 0;
      const total = Array.isArray(row.chunkPlanJson) ? (row.chunkPlanJson as unknown[]).length : "?";
      console.log(`  unitId=${row.unitId} sourceKey=${row.sourceKey} completedChunks=${completed}/${total} retryCount=${row.retryCount} updatedAt=${row.updatedAt.toISOString()}`);
    }

    if (!apply) {
      console.log(`\nDRY RUN — zero writes. Re-run with --apply to recover exactly these ${candidates.length} rows.`);
      return;
    }

    let recovered = 0;
    for (const row of candidates) {
      // Fail-closed per row: re-verify immediately before writing, in case
      // anything changed between the read above and now (e.g. a real
      // student request already resumed/cleared it independently).
      const fresh = await prisma.client.unitGroundingProgress.findUnique({ where: { unitId: row.unitId } });
      if (!fresh || fresh.status !== "CONFIGURATION_ERROR" || fresh.lastErrorCode !== INCIDENT_LAST_ERROR_CODE) {
        console.log(`  SKIPPED unitId=${row.unitId} — no longer matches expected pre-recovery state (already changed).`);
        continue;
      }
      await prisma.client.unitGroundingProgress.update({
        where: { unitId: row.unitId },
        data: { status: "IN_PROGRESS", lastErrorCode: null, retryCount: 0, nextEligibleAt: null, leaseOwner: null, leaseExpiresAt: null },
      });
      recovered++;
      console.log(`  RECOVERED unitId=${row.unitId}`);
    }

    console.log(`\nRecovered ${recovered}/${candidates.length} rows. Identity fields (sourceKey/sourceFingerprint/promptVersion/providerModel/rendererVersion) and all completed chunks were left untouched.`);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("FAILED:", err);
    process.exit(1);
  });
}

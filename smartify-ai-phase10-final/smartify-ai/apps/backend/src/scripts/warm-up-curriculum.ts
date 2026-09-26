/**
 * Admin/maintenance curriculum warm-up (2026-09-26 product decision:
 * prepare shared grounding + lesson authoring ahead of public launch,
 * instead of leaving every Topic's first real student to pay the lazy-
 * generation latency).
 *
 * DUPLICATES NOTHING: this script drives exactly the same two production
 * entry points InteractiveLessonService.ensureTopicHasSteps() already
 * calls for a real student's first /advance —
 * LessonDraftGeneratorService.prepareTopicGrounding() (which wraps
 * UnitGroundingService.prepareNextGroundingChunk(), the resumable,
 * durable, one-chunk-per-call grounding driver) and .ensureTopicHasLesson()
 * — plus the same fire-and-forget QuestionDraftGeneratorService used
 * today. It only adds the server-side retry/backoff LOOP a real student's
 * browser would otherwise perform itself, one HTTP poll at a time.
 *
 * Every call uses CONTENT_AUTHORING_ACTOR_ID (the existing platform
 * content-authoring actor, on its own separate AI budget — see
 * ai-usage.service.ts) — NEVER a student id, NEVER a LessonSession, NEVER
 * an AIConversation/AIMessage. Nothing here touches those tables at all.
 *
 * Idempotent and safe to rerun: every Unit/Topic already in a valid final
 * state (Unit.groundingNotesJson set / Topic.teachingStepsJson set) is
 * skipped without any provider call — this is the SAME skip check
 * ensureTopicHasSteps() and ensureTopicHasLesson() already perform.
 *
 * Strictly SEQUENTIAL — one Unit's grounding loop runs fully (or hits its
 * own real TPM cooldown, honored via `nextEligibleAt`/`retryAfterMs`, the
 * same values the frontend already respects) before the next Unit starts.
 * No Promise.all, no manual concurrency.
 *
 * BRITISH_INTL Year 6 English Language (subjectId
 * cmucxcuf700gf2qd5t5q38tcx) is hard-excluded — a confirmed
 * SOURCE_FILE_MISMATCH, not a metadata/grounding gap. Never touched here,
 * regardless of --subjectId scoping.
 *
 * Usage:
 *   pnpm --filter backend exec ts-node src/scripts/warm-up-curriculum.ts [--subjectId=<id>]             (dry run — default, lists work, makes ZERO provider calls)
 *   pnpm --filter backend exec ts-node src/scripts/warm-up-curriculum.ts [--subjectId=<id>] --apply      (executes — only after the dry-run scope/cost estimate is reviewed and approved)
 *
 * --subjectId restricts the whole run to one Subject's Units/Topics — used
 * for a controlled pilot before the full-curriculum run. Omit it to cover
 * every eligible Subject.
 *
 * Production: run the COMPILED artifact, e.g.
 *   railway ssh -- node apps/backend/dist/scripts/warm-up-curriculum.js --subjectId=cmucxctob004d2qd5ajweuz1n
 *   railway ssh -- node apps/backend/dist/scripts/warm-up-curriculum.js --subjectId=cmucxctob004d2qd5ajweuz1n --apply
 */
import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";
import { LessonDraftGeneratorService } from "../interactive-lesson/lesson-draft-generator/lesson-draft-generator.service";
import { QuestionDraftGeneratorService } from "../question-bank/question-draft-generator/question-draft-generator.service";
import { CONTENT_AUTHORING_ACTOR_ID } from "../ai/content-authoring-actor.const";
import { isQuotaError } from "../ai/providers/openai-request-diagnostics";

const EXCLUDED_SUBJECT_ID = "cmucxcuf700gf2qd5t5q38tcx"; // BRITISH_INTL Year 6 English — SOURCE_FILE_MISMATCH
const MAX_CHUNK_ATTEMPTS_PER_UNIT = 200; // generous ceiling — a real unit needs a few dozen at most; this only guards against an unforeseen infinite loop, never trips in normal operation
const POLL_FLOOR_MS = 500;
const POLL_CEILING_MS = 90_000; // TPM cooldowns observed in production have run up to ~65s

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Thrown to unwind out of the Units loop entirely — a provider-wide
 * outage must stop the whole run, not just the one Unit that surfaced it. */
export class ProviderOutageError extends Error {
  constructor(readonly unitId: string, readonly reason: string) {
    super(`Provider outage detected while grounding unit ${unitId} (${reason}). Halting the entire warm-up run — no further Units will be processed. All already-completed grounding/authoring is preserved; rerun this same command once provider availability is confirmed restored.`);
  }
}

function parseSubjectIdArg(): string | undefined {
  const arg = process.argv.find((a) => a.startsWith("--subjectId="));
  return arg ? arg.slice("--subjectId=".length) : undefined;
}

interface RunReport {
  unitsGrounded: string[];
  unitsAlreadyGrounded: string[];
  unitsSkippedConfigurationError: string[];
  unitsSkippedExcluded: string[];
  topicsAuthored: string[];
  topicsAlreadyAuthored: string[];
  topicsFailed: { topicId: string; error: string }[];
  totalChunksProcessed: number;
  totalCooldownWaits: number;
}

/** Real physical page count for the log line only — matches the same
 * ceil((end-start+1)/2) 2-pages-per-chunk convention UnitGroundingService
 * itself uses to build its chunkPlan. */
function estimateTotalChunks(pageStart: number | null, pageEnd: number | null): number | null {
  if (pageStart == null || pageEnd == null || pageEnd < pageStart) return null;
  return Math.ceil((pageEnd - pageStart + 1) / 2);
}

export async function warmUpUnit(
  draftGenerator: LessonDraftGeneratorService,
  unitId: string,
  anyTopicIdForUnit: string,
  totalChunksEstimate: number | null,
  report: RunReport,
  apply: boolean,
): Promise<"READY" | "CONFIGURATION_ERROR"> {
  let completedChunks = 0;
  for (let attempt = 0; attempt < MAX_CHUNK_ATTEMPTS_PER_UNIT; attempt++) {
    if (!apply) return "READY"; // dry run never calls the provider
    const result = await draftGenerator.prepareTopicGrounding(anyTopicIdForUnit, CONTENT_AUTHORING_ACTOR_ID);
    if (result.status === "READY") {
      console.log(`  grounding chunks completed: ${completedChunks}/${totalChunksEstimate ?? "?"} (unit ${unitId} READY)`);
      return "READY";
    }
    // 2026-09-26 provider-outage hotfix: a PROVIDER_OUTAGE result means the
    // OpenAI account itself has no usable quota/credits right now — this is
    // NOT specific to this Unit (nothing was persisted for it — see
    // UnitGroundingService), and every subsequent Unit would fail the exact
    // same way. Halting the ENTIRE run immediately rather than continuing
    // to the next Unit is the whole point of this fix (the 2026-09-26
    // incident is exactly what happens without it: 16 Units wrongly
    // converted to CONFIGURATION_ERROR before anyone noticed).
    if (result.status === "PROVIDER_OUTAGE") {
      throw new ProviderOutageError(unitId, result.reason);
    }
    if (result.status === "CONFIGURATION_ERROR") {
      console.log(`  grounding TERMINAL FAILURE for unit ${unitId} after ${completedChunks} chunk(s)`);
      return "CONFIGURATION_ERROR";
    }
    // A chunk that actually ran advances progress; a chunk still inside a
    // TPM/rate-limit cooldown returns PREPARING without doing new work —
    // distinguished here only for the printed progress line, never for
    // correctness (both cases simply retry after the given delay).
    const waitMs = Math.min(POLL_CEILING_MS, Math.max(POLL_FLOOR_MS, result.retryAfterMs ?? 1500));
    if (waitMs > POLL_FLOOR_MS * 2) {
      report.totalCooldownWaits++;
      console.log(`  cooldown/backoff: waiting ${Math.round(waitMs / 1000)}s before next chunk (unit ${unitId})`);
    } else {
      completedChunks++;
      report.totalChunksProcessed++;
      console.log(`  grounding chunk ${completedChunks}/${totalChunksEstimate ?? "?"} completed (unit ${unitId})`);
    }
    await sleep(waitMs);
  }
  throw new Error(`Unit ${unitId} did not finish grounding within ${MAX_CHUNK_ATTEMPTS_PER_UNIT} attempts — investigate before rerunning.`);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const subjectId = parseSubjectIdArg();
  const runStartedAt = new Date();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn", "log"] });
  const report: RunReport = {
    unitsGrounded: [], unitsAlreadyGrounded: [], unitsSkippedConfigurationError: [], unitsSkippedExcluded: [],
    topicsAuthored: [], topicsAlreadyAuthored: [], topicsFailed: [], totalChunksProcessed: 0, totalCooldownWaits: 0,
  };

  try {
    const prisma = app.get(PrismaService);
    const draftGenerator = app.get(LessonDraftGeneratorService);
    const questionGenerator = app.get(QuestionDraftGeneratorService);

    const units = await prisma.client.unit.findMany({
      where: { subject: { isActive: true, ...(subjectId ? { id: subjectId } : {}) } },
      select: {
        id: true, subjectId: true, sourcePageStart: true, sourcePageEnd: true, groundingNotesJson: true,
        topics: { select: { id: true, teachingStepsJson: true } },
      },
    });

    console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}${subjectId ? ` — scoped to subjectId=${subjectId}` : " — ALL eligible subjects"}`);
    console.log(`Units in scope: ${units.length}\n`);

    let unitIndex = 0;
    let outage: ProviderOutageError | null = null;
    try {
    for (const unit of units) {
      unitIndex++;
      console.log(`Unit ${unitIndex}/${units.length}: ${unit.id}`);

      if (unit.subjectId === EXCLUDED_SUBJECT_ID) {
        report.unitsSkippedExcluded.push(unit.id);
        console.log(`  SKIPPED — excluded subject (SOURCE_FILE_MISMATCH)`);
        continue;
      }
      if (unit.topics.length === 0) continue;

      let groundingStatus: "READY" | "CONFIGURATION_ERROR";
      if (unit.groundingNotesJson) {
        report.unitsAlreadyGrounded.push(unit.id);
        console.log(`  already grounded — skipping (0 provider calls)`);
        groundingStatus = "READY";
      } else {
        const totalChunksEstimate = estimateTotalChunks(unit.sourcePageStart, unit.sourcePageEnd);
        console.log(`  ${apply ? "grounding" : "would ground"} — estimated chunks: ${totalChunksEstimate ?? "?"}`);
        try {
          groundingStatus = await warmUpUnit(draftGenerator, unit.id, unit.topics[0].id, totalChunksEstimate, report, apply);
          if (groundingStatus === "READY") report.unitsGrounded.push(unit.id);
          else report.unitsSkippedConfigurationError.push(unit.id);
        } catch (err) {
          if (err instanceof ProviderOutageError) throw err; // never swallowed — must unwind the whole run
          report.topicsFailed.push({ topicId: unit.topics.map((t) => t.id).join(","), error: err instanceof Error ? err.message : String(err) });
          continue;
        }
      }

      if (groundingStatus !== "READY") continue;
      const topicsMissing = unit.topics.filter((t) => !t.teachingStepsJson);
      if (!apply && !unit.groundingNotesJson) {
        // Dry run and this unit isn't grounded yet: its topics' post-
        // grounding authoring outcome isn't actually known without calling
        // the provider, so just report the pending count instead of
        // asserting each one "would" author successfully.
        console.log(`  Topic authoring: 0/${topicsMissing.length} (pending grounding completion)`);
        continue;
      }

      let topicIndex = 0;
      for (const topic of unit.topics) {
        if (topic.teachingStepsJson) {
          report.topicsAlreadyAuthored.push(topic.id);
          continue;
        }
        topicIndex++;
        console.log(`  ${apply ? "authoring" : "would author"} topic ${topicIndex}/${topicsMissing.length}: ${topic.id}`);
        if (!apply) continue;
        try {
          await draftGenerator.ensureTopicHasLesson(topic.id, { preferredLang: "en", studentAgeRange: "9-10" }, CONTENT_AUTHORING_ACTOR_ID);
          await questionGenerator.ensurePoolForTopic(topic.id, CONTENT_AUTHORING_ACTOR_ID);
          report.topicsAuthored.push(topic.id);
        } catch (err) {
          // Same provider-outage guard as grounding above — lesson/question
          // authoring makes real OpenAI calls too, and an account-level
          // quota exhaustion here is just as much a whole-run stop signal,
          // not a per-Topic failure to log and move past.
          if (isQuotaError(err)) throw new ProviderOutageError(topic.id, "provider_quota_exhausted");
          report.topicsFailed.push({ topicId: topic.id, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
    } catch (err) {
      if (!(err instanceof ProviderOutageError)) throw err;
      outage = err;
      console.log(`\n!!! PROVIDER OUTAGE — HALTED !!!\n${err.message}\n`);
    }

    let realCost: { inputTokens: number; outputTokens: number; costUsd: number; calls: number } | null = null;
    if (apply) {
      const usageRows = await prisma.client.aIUsage.findMany({
        where: { userId: CONTENT_AUTHORING_ACTOR_ID, createdAt: { gte: runStartedAt } },
        select: { inputTokens: true, outputTokens: true, costUsd: true },
      });
      realCost = usageRows.reduce(
        (acc, r) => ({ inputTokens: acc.inputTokens + r.inputTokens, outputTokens: acc.outputTokens + r.outputTokens, costUsd: acc.costUsd + Number(r.costUsd), calls: acc.calls + 1 }),
        { inputTokens: 0, outputTokens: 0, costUsd: 0, calls: 0 },
      );
    }

    console.log(`\n=== FINAL SUMMARY ===`);
    console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
    console.log(`Units grounded this run: ${report.unitsGrounded.length}`);
    console.log(`Units already grounded (skipped): ${report.unitsAlreadyGrounded.length}`);
    console.log(`Units excluded: ${report.unitsSkippedExcluded.length}`);
    console.log(`Units with terminal grounding failure: ${report.unitsSkippedConfigurationError.length}`);
    console.log(`Topics authored this run: ${report.topicsAuthored.length}`);
    console.log(`Topics already authored (skipped): ${report.topicsAlreadyAuthored.length}`);
    console.log(`Topics/units failed: ${report.topicsFailed.length}`);
    console.log(`Total grounding chunks processed: ${report.totalChunksProcessed}`);
    console.log(`Total cooldown/backoff waits: ${report.totalCooldownWaits}`);
    if (realCost) {
      console.log(`Real platform-actor provider usage this run: ${realCost.calls} call(s), ${realCost.inputTokens} input / ${realCost.outputTokens} output tokens, $${realCost.costUsd.toFixed(4)}`);
    }
    if (report.topicsFailed.length > 0) {
      console.log(`\nFAILURES (investigate before rerunning if unexpected — rerunning is always safe, already-completed work is never lost):`);
      console.log(JSON.stringify(report.topicsFailed, null, 2));
    }
    if (outage) {
      process.exitCode = 1;
    }
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

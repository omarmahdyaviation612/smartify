/**
 * Production-safe backfill driver for the persisted TopicGroundingAssignment
 * architecture (2026-09-27). Drives exactly the two existing services that
 * already implement the whole pipeline — TopicGroundingAssignmentService
 * (deterministic Steps 1-5, DB-free classification + the one write path) and
 * TopicGroundingMapperService (the bounded, closed-set AI mapper, LAST
 * resort only) — this script adds no grounding-assignment LOGIC of its own,
 * only the scoping/looping/reporting around them.
 *
 * DEFAULT = DRY RUN. Only --apply may persist a TopicGroundingAssignment row
 * or invoke the AI mapper (one real provider call per still-unresolved
 * Topic, budgeted through the existing CONTENT_AUTHORING_ACTOR_ID platform
 * tier — see ai-usage.service.ts — never a student's budget).
 *
 * BRITISH_INTL Year 6 English Language (subjectId cmucxcuf700gf2qd5t5q38tcx)
 * is hard-excluded, unconditionally, regardless of any --topicId/--unitId/
 * --subjectId scoping flag — the same exclusion warm-up-curriculum.ts and
 * repair-unit-source-page-end.ts already enforce for this confirmed
 * SOURCE_FILE_MISMATCH subject.
 *
 * A Unit with no completed grounding can never receive a fabricated
 * assignment — its Topics are reported BLOCKED_BY_GROUNDING and skipped
 * entirely (grounding itself is out of scope for this script; see
 * warm-up-curriculum.ts).
 *
 * Resumable by construction, not by any special resume state this script
 * keeps: TopicGroundingAssignmentService.assignGroundingForTopic() already
 * persists each Topic's outcome the instant it is decided and is itself
 * idempotent (an existing valid-identity row is a no-op read), so
 * interrupting this script anywhere and rerunning it just skips everything
 * already decided and continues from there. A BLOCKED row (the mapper ran
 * and rejected/LOW-confidenced) is never silently retried — only a
 * TOPIC_GROUNDING_ASSIGNMENT_VERSION bump (a real logic change) invalidates
 * it, exactly as designed.
 *
 * Usage:
 *   pnpm --filter backend exec ts-node src/scripts/prepare-topic-grounding-assignments.ts [--topicId=<id>|--unitId=<id>|--subjectId=<id>]            (dry run — default, zero writes, zero provider calls)
 *   pnpm --filter backend exec ts-node src/scripts/prepare-topic-grounding-assignments.ts [...] --apply                                               (writes deterministic assignments; invokes the AI mapper only for Topics Steps 1-5 leave UNRESOLVED)
 *
 * Production: run the COMPILED artifact, e.g.
 *   railway ssh --service smartify -- node apps/backend/dist/scripts/prepare-topic-grounding-assignments.js
 *   railway ssh --service smartify -- node apps/backend/dist/scripts/prepare-topic-grounding-assignments.js --apply
 */
import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";
import { AIProviderFactory } from "../ai/ai-provider.factory";
import { AIUsageService } from "../ai/usage/ai-usage.service";
import { TopicGroundingAssignmentService, computeDeterministicAssignment, type AssignmentTopic } from "../ai/context/topic-grounding-assignment.service";
import { TopicGroundingMapperService } from "../ai/context/topic-grounding-mapper.service";
import { DETERMINISTIC_ASSIGNMENT_VERSION, MAPPER_PROMPT_VERSION } from "../ai/context/topic-grounding-assignment.util";
import { isQuotaError } from "../ai/providers/openai-request-diagnostics";
import type { GroundingNotes } from "../interactive-lesson/unit-grounding/unit-grounding.types";

export const EXCLUDED_SUBJECT_ID = "cmucxcuf700gf2qd5t5q38tcx"; // BRITISH_INTL Year 6 English — SOURCE_FILE_MISMATCH, never processed here

export class ProviderOutageError extends Error {
  constructor(readonly topicId: string, readonly reason: string) {
    super(`Provider outage detected while mapping topic ${topicId} (${reason}). Halting the entire backfill run — every already-persisted assignment is preserved and this run is safe to retry once provider availability is confirmed restored.`);
  }
}

export interface BackfillReport {
  totalTopics: number;
  eligibleTopics: number;
  excludedY6English: number;
  alreadyReady: Record<string, number>; // method -> count, among pre-existing valid READY rows
  deterministicAssigned: Record<string, number>; // method -> count, newly assigned this run (apply) or would-assign (dry run)
  aiMapperRequired: number; // Steps 1-5 found nothing (dry run: estimate; apply: attempted)
  aiMapperReady: number;
  aiMapperBlocked: number;
  blockedByGrounding: number;
  staleRecomputed: number;
  skippedIdempotent: number;
  failures: { topicId: string; error: string }[];
  providerCalls: number;
  inputTokens: number;
  outputTokens: number;
  actualCostUsd: number;
}

function emptyReport(): BackfillReport {
  return {
    totalTopics: 0,
    eligibleTopics: 0,
    excludedY6English: 0,
    alreadyReady: {},
    deterministicAssigned: {},
    aiMapperRequired: 0,
    aiMapperReady: 0,
    aiMapperBlocked: 0,
    blockedByGrounding: 0,
    staleRecomputed: 0,
    skippedIdempotent: 0,
    failures: [],
    providerCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    actualCostUsd: 0,
  };
}

function bump(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

function parseScopeArgs(): { topicId?: string; unitId?: string; subjectId?: string } {
  const arg = (flag: string) => {
    const found = process.argv.find((a) => a.startsWith(`--${flag}=`));
    return found ? found.slice(flag.length + 3) : undefined;
  };
  return { topicId: arg("topicId"), unitId: arg("unitId"), subjectId: arg("subjectId") };
}

interface ScopedTopic {
  id: string;
  nameEn: string;
  order: number;
  teachingStepsJson: unknown;
  unit: {
    id: string;
    subjectId: string;
    groundingNotesJson: unknown;
    groundingVersion: number | null;
    groundingSourceFingerprint: string | null;
    topics: { id: string; nameEn: string; order: number }[];
  };
  groundingAssignment: {
    unitGroundingVersion: number;
    unitSourceFingerprint: string;
    assignmentVersion: number;
    method: string;
    mapperPromptVersion: number | null;
    status: string;
  } | null;
}

/** Loads the scoped Topics, always excluding BRITISH_INTL Y6 English regardless of any scope flag. */
export async function loadScopedTopics(prisma: PrismaService, scope: { topicId?: string; unitId?: string; subjectId?: string }): Promise<{ all: ScopedTopic[]; totalTopics: number }> {
  const totalTopics = await prisma.client.topic.count();

  const where: Record<string, unknown> = { unit: { subjectId: { not: EXCLUDED_SUBJECT_ID } } };
  if (scope.topicId) where.id = scope.topicId;
  if (scope.unitId) where.unitId = scope.unitId;
  if (scope.subjectId) {
    if (scope.subjectId === EXCLUDED_SUBJECT_ID) {
      // Never silently include the excluded subject even if explicitly requested.
      return { all: [], totalTopics };
    }
    where.unit = { subjectId: scope.subjectId };
  }

  const all = (await prisma.client.topic.findMany({
    where,
    select: {
      id: true,
      nameEn: true,
      order: true,
      teachingStepsJson: true,
      unit: {
        select: {
          id: true,
          subjectId: true,
          groundingNotesJson: true,
          groundingVersion: true,
          groundingSourceFingerprint: true,
          topics: { select: { id: true, nameEn: true, order: true }, orderBy: { order: "asc" } },
        },
      },
      groundingAssignment: {
        select: { unitGroundingVersion: true, unitSourceFingerprint: true, assignmentVersion: true, method: true, mapperPromptVersion: true, status: true },
      },
    },
  })) as unknown as ScopedTopic[];

  return { all, totalTopics };
}

/**
 * Mirrors assignmentIdentityMatches() in topic-grounding-assignment.util.ts:
 * an AI_MAPPER row is checked against mapperPromptVersion only, a
 * deterministic-method row against DETERMINISTIC_ASSIGNMENT_VERSION only.
 * Kept as a local, DB-shape-specific mirror (rather than importing the util
 * function directly) because this script's ScopedTopic select omits fields
 * (matchedConceptNames/matchedHintTitles) that the shared type requires but
 * this dry-run report never needs.
 */
function identityValid(topic: ScopedTopic): boolean {
  const a = topic.groundingAssignment;
  const u = topic.unit;
  if (!a || u.groundingVersion === null || u.groundingSourceFingerprint === null) return false;
  if (a.unitGroundingVersion !== u.groundingVersion || a.unitSourceFingerprint !== u.groundingSourceFingerprint) return false;
  if (a.method === "AI_MAPPER") return a.mapperPromptVersion === MAPPER_PROMPT_VERSION;
  return a.assignmentVersion === DETERMINISTIC_ASSIGNMENT_VERSION;
}

/** Dry-run classification only — pure, DB-free, makes zero writes/provider calls. */
export function dryRunOne(topic: ScopedTopic, report: BackfillReport) {
  const unit = topic.unit;
  const grounded = unit.groundingVersion !== null && unit.groundingSourceFingerprint !== null && !!unit.groundingNotesJson;
  if (!grounded) {
    report.blockedByGrounding++;
    return;
  }

  const existing = topic.groundingAssignment;
  if (existing && identityValid(topic)) {
    if (existing.status === "BLOCKED") {
      bump(report.alreadyReady, "AI_MAPPER(BLOCKED, unchanged)");
    } else {
      bump(report.alreadyReady, existing.method);
    }
    return;
  }
  if (existing && !identityValid(topic)) report.staleRecomputed++;

  const notes = unit.groundingNotesJson as unknown as GroundingNotes;
  const siblings: AssignmentTopic[] = unit.topics.map((t) => ({ id: t.id, nameEn: t.nameEn, order: t.order }));
  const computed = computeDeterministicAssignment(notes, { id: topic.id, nameEn: topic.nameEn, order: topic.order }, siblings, undefined);
  if (computed) bump(report.deterministicAssigned, computed.method);
  else report.aiMapperRequired++;
}

/** Apply mode for ONE Topic — delegates ALL persistence/provider logic to the existing services. */
export async function applyOne(
  topic: ScopedTopic,
  assignmentService: TopicGroundingAssignmentService,
  mapperService: TopicGroundingMapperService,
  report: BackfillReport,
): Promise<void> {
  const existing = topic.groundingAssignment;
  const wasStale = !!existing && !identityValid(topic);

  const outcome = await assignmentService.assignGroundingForTopic(topic.id);

  if (outcome.outcome === "NOT_GROUNDED") {
    report.blockedByGrounding++;
    return;
  }
  if (outcome.outcome === "UNCHANGED") {
    if (outcome.status === "BLOCKED") bump(report.alreadyReady, "AI_MAPPER(BLOCKED, unchanged)");
    else bump(report.alreadyReady, outcome.method);
    report.skippedIdempotent++;
    return;
  }
  if (outcome.outcome === "ASSIGNED") {
    bump(report.deterministicAssigned, outcome.method);
    if (wasStale) report.staleRecomputed++;
    return;
  }

  // outcome.outcome === "UNRESOLVED" — Steps 1-5 declined; the bounded mapper is the last resort.
  report.aiMapperRequired++;
  const before = { calls: report.providerCalls };
  let mapped: Awaited<ReturnType<typeof mapperService.mapTopic>>;
  try {
    mapped = await mapperService.mapTopic(topic.id);
  } catch (err) {
    if (isQuotaError(err)) throw new ProviderOutageError(topic.id, "provider_quota_exhausted");
    report.failures.push({ topicId: topic.id, error: err instanceof Error ? err.message : String(err) });
    return;
  }
  if (mapped.outcome === "READY") {
    report.providerCalls++;
    report.aiMapperReady++;
  } else if (mapped.outcome === "BLOCKED") {
    if (mapped.code !== "BUDGET_UNAVAILABLE" && mapped.code !== "NO_CANDIDATES") {
      report.providerCalls++; // a validation/LOW-confidence BLOCKED still made exactly one real provider call
    }
    report.aiMapperBlocked++;
  } else if (mapped.outcome === "NOT_GROUNDED") {
    report.blockedByGrounding++;
  }
  // SKIPPED_DETERMINISTIC is unreachable here: assignGroundingForTopic() already
  // proved this Topic is UNRESOLVED under the identical deterministic logic.
  void before;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const scope = parseScopeArgs();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn", "log"] });
  const report = emptyReport();

  try {
    const prisma = app.get(PrismaService);
    const assignmentService = app.get(TopicGroundingAssignmentService);
    const providerFactory = app.get(AIProviderFactory);
    const usageService = app.get(AIUsageService);
    // Deliberately NOT registered in any module (see topic-grounding-mapper.service.ts's
    // own docstring) — constructed explicitly, only here, only for the backfill run.
    const mapperService = new TopicGroundingMapperService(prisma, providerFactory, usageService, assignmentService);

    const runStartedAt = new Date();
    const { all, totalTopics } = await loadScopedTopics(prisma, scope);
    report.totalTopics = totalTopics;
    report.eligibleTopics = all.length;

    const y6Count = await prisma.client.topic.count({ where: { unit: { subjectId: EXCLUDED_SUBJECT_ID } } });
    report.excludedY6English = y6Count;

    console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}${scope.topicId ? ` — topicId=${scope.topicId}` : scope.unitId ? ` — unitId=${scope.unitId}` : scope.subjectId ? ` — subjectId=${scope.subjectId}` : " — ALL eligible Topics"}`);
    console.log(`Topics in scope: ${all.length} (excluded Y6 English: ${y6Count}, total in DB: ${totalTopics})\n`);

    let outage: ProviderOutageError | null = null;
    for (let i = 0; i < all.length; i++) {
      const topic = all[i];
      try {
        if (apply) {
          await applyOne(topic, assignmentService, mapperService, report);
        } else {
          dryRunOne(topic, report);
        }
      } catch (err) {
        if (err instanceof ProviderOutageError) {
          outage = err;
          break;
        }
        report.failures.push({ topicId: topic.id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (apply) {
      const usageRows = await prisma.client.aIUsage.findMany({
        where: { userId: "cmtz6270z0000u9c5h6ua0y67" /* CONTENT_AUTHORING_ACTOR_ID */, feature: "topic_grounding_mapper", createdAt: { gte: runStartedAt } },
        select: { inputTokens: true, outputTokens: true, costUsd: true },
      });
      report.inputTokens = usageRows.reduce((n, r) => n + r.inputTokens, 0);
      report.outputTokens = usageRows.reduce((n, r) => n + r.outputTokens, 0);
      report.actualCostUsd = usageRows.reduce((n, r) => n + Number(r.costUsd), 0);
    }

    console.log(`\n=== FINAL SUMMARY (${apply ? "APPLY" : "DRY RUN"}) ===`);
    console.log(`Total Topics (all subjects): ${report.totalTopics}`);
    console.log(`Eligible Topics in this run's scope: ${report.eligibleTopics}`);
    console.log(`Excluded Y6 English Topics: ${report.excludedY6English}`);
    console.log(`Already READY/unchanged (by method): ${JSON.stringify(report.alreadyReady)}`);
    console.log(`Deterministic newly-assigned (by method): ${JSON.stringify(report.deterministicAssigned)}`);
    console.log(`AI_MAPPER required (Steps 1-5 unresolved): ${report.aiMapperRequired}`);
    console.log(`AI_MAPPER READY (HIGH confidence): ${report.aiMapperReady}`);
    console.log(`AI_MAPPER BLOCKED (rejected/LOW/budget): ${report.aiMapperBlocked}`);
    console.log(`BLOCKED_BY_GROUNDING (Unit not grounded): ${report.blockedByGrounding}`);
    console.log(`Stale identity recomputed: ${report.staleRecomputed}`);
    console.log(`Skipped (idempotent no-op): ${report.skippedIdempotent}`);
    console.log(`Failures: ${report.failures.length}`);
    if (apply) {
      console.log(`Provider calls this run: ${report.providerCalls}`);
      console.log(`Input tokens: ${report.inputTokens}, output tokens: ${report.outputTokens}, actual cost: $${report.actualCostUsd.toFixed(6)}`);
    }

    const alreadyReadyCount = Object.values(report.alreadyReady).reduce((a, b) => a + b, 0);
    const deterministicCount = Object.values(report.deterministicAssigned).reduce((a, b) => a + b, 0);
    const accounted =
      alreadyReadyCount + deterministicCount + report.blockedByGrounding + report.failures.length + (apply ? report.aiMapperReady + report.aiMapperBlocked : report.aiMapperRequired);
    console.log(`\nReconciliation: ${accounted} / ${report.eligibleTopics} eligible Topics accounted for ${accounted === report.eligibleTopics ? "— MATCH" : "— MISMATCH, investigate"}`);

    if (report.failures.length > 0) {
      console.log(`\nFAILURES:`);
      console.log(JSON.stringify(report.failures, null, 2));
    }
    if (outage) {
      console.log(`\n!!! PROVIDER OUTAGE — HALTED !!!\n${outage.message}\n`);
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

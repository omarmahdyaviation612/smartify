/**
 * Resumable, explicit-plan Wave B re-grounding orchestration (2026-10-02).
 *
 * Built on the pilot-proven reground-unit mechanics. For every Unit of the
 * requested books (processed book by book, Units sequentially):
 *   classify -> preflight -> generate (no clear) -> validate -> guarded CAS
 *   replace -> confirm fingerprint -> rebuild that Unit's Topic assignments
 *   (existing remediation normal mode: deterministic, then compact mapper
 *   only where required; never source extraction) -> verify slices ->
 *   per-Unit accounting -> record.
 * After every book an integrity checkpoint must pass before the next book.
 *
 * Classification (before any work, and again right before each Unit):
 *   ALREADY_COMPLETED  corrected range + corrected fingerprint (skipped)
 *   READY_TO_REGROUND  corrected range + historical old-range fingerprint
 *   FAILED_PREVIOUSLY  recorded as failed in --priorReport (skipped, no retry)
 *   PARTIAL_ASSIGNMENT corrected fingerprint but a Topic still carries a
 *                      non-current fingerprint with no prior completion record
 *   DRIFTED            anything else (stop)
 *
 * DRY RUN (default) only classifies. Usage:
 *   node dist/scripts/reground-wave.js --plan=<plan.json> --subjectIds=<ordered ids> [--priorReport=<report.json>] [--report=<out.json>] [--apply]
 */
import * as fs from "fs";
import { validatePlan, type RepairPlan } from "./repair-unit-page-offset";
import { approvedTarget, validateReplacement, type ApprovedTarget } from "./reground-unit";

export type UnitClass = "ALREADY_COMPLETED" | "READY_TO_REGROUND" | "FAILED_PREVIOUSLY" | "PAGE_LIMIT" | "PARTIAL_ASSIGNMENT" | "DRIFTED";
export type UnitOutcome = "COMPLETED" | "SKIPPED_ALREADY_COMPLETED" | "SKIPPED_FAILED_PREVIOUSLY" | "SKIPPED_PAGE_LIMIT" | "FAILED_BEFORE_REPLACEMENT" | "FAILED_GUARDED_REPLACEMENT" | "GROUNDING_REPLACED_ASSIGNMENT_FAILED";

export interface LiveTopic { id: string; nameEn: string; status: string | null; fingerprint: string | null }
export interface LiveUnit { id: string; sourceFileOverride: string | null; subjectSourceFile: string | null; sourcePageStart: number | null; sourcePageEnd: number | null; groundingSourceFingerprint: string | null; hasNotes: boolean; topics: LiveTopic[] }
export interface TopicVerdict { id: string; nameEn: string; state: "READY_CURRENT" | "BLOCKED_CURRENT" | "STALE_UNRESOLVED" | "READY_EMPTY_SLICE"; method: string | null }
export interface Accounting { usageRows: number; byFeature: Record<string, number>; inputTokens: number; outputTokens: number; costUsd: number; reservations: Record<string, number>; reconciledUsd: number }
export interface Snapshot { units: Record<string, string>; ranges: Record<string, string>; assignByTopic: Record<string, string>; teachingSteps: string; questions: string; questionDrafts: string; tse: string; progress: string; ready: number; blocked: number }

export interface WaveDeps {
  loadUnit(unitId: string): Promise<LiveUnit | null>;
  generate(unitId: string): Promise<{ notes: any; model: string; chunkCount: number; sourceKey: string; pageStart: number; pageEnd: number; groundingVersion: number; groundingPromptVersion: string }>;
  replace(t: ApprovedTarget, gen: { notes: any; model: string; groundingVersion: number; groundingPromptVersion: string }): Promise<number>;
  rebuildAssignments(topicIds: string[]): Promise<{ deterministicRecovered: number; compactMapperAttempted: number; compactMapperRecovered: number }>;
  verifyTopics(unitId: string): Promise<TopicVerdict[]>;
  snapshot(): Promise<Snapshot>;
  accountingSince(since: Date): Promise<Accounting>;
  health(): Promise<{ live: number; ready: number }>;
  /** Platform-actor spend gap since a UTC day: AIUsage actual cost minus committed platform budget counters. */
  platformGap(sinceDay: Date): Promise<{ aiUsageUsd: number; committedUsd: number; gapUsd: number }>;
  now(): Date;
  writeReport(report: WaveReport): void;
}

export interface UnitRecord { unitId: string; label: string; bookId: string; classification: UnitClass; outcome: UnitOutcome; reason?: string; oldFingerprint: string; newFingerprint: string; chunkCount?: number; concepts?: number; deterministicRecovered?: number; compactMapperAttempted?: number; compactMapperRecovered?: number; topics?: TopicVerdict[]; accounting?: Accounting }
export interface BookCheckpoint { bookId: string; label: string; platformGapUsd?: number; unitsCompleted: number; unitsFailed: number; readyBefore: number; readyAfter: number; blockedBefore: number; blockedAfter: number; accounting: Accounting; gates: Record<string, boolean>; passed: boolean; problems: string[] }
export interface WaveReport { mode: "DRY_RUN" | "APPLY"; status: "RUNNING" | "COMPLETED" | "STOPPED"; stopReason?: string; accountingBaseline?: { sinceDay: string; aiUsageUsd: number; committedUsd: number; gapUsd: number }; classification: { unitId: string; label: string; classification: UnitClass }[]; units: UnitRecord[]; books: BookCheckpoint[] }

const ID = /^[a-z0-9]{20,40}$/;
export function parseArgs(argv: string[]) {
  for (const a of argv) if (!/^--(plan|subjectIds|priorReport|report)=.+$/.test(a) && a !== "--apply") throw new Error(`unexpected argument: ${a}`);
  const get = (n: string, required: boolean) => { const v = argv.filter((a) => a.startsWith(`--${n}=`)); if (v.length > 1 || (required && !v.length)) throw new Error(`--${n} must be given ${required ? "exactly" : "at most"} once`); return v[0]?.slice(n.length + 3); };
  const subjectIds = get("subjectIds", true)!.split(",");
  if (subjectIds.some((x) => !ID.test(x))) throw new Error("malformed --subjectIds entry");
  if (new Set(subjectIds).size !== subjectIds.length) throw new Error("duplicate --subjectIds entry");
  if (argv.filter((a) => a === "--apply").length > 1) throw new Error("--apply given more than once");
  return { plan: get("plan", true)!, subjectIds, priorReport: get("priorReport", false), report: get("report", false), apply: argv.includes("--apply") };
}

/** Orchestration-level page-limit classification: an otherwise eligible Unit whose corrected range exceeds the extraction limit is a known, expected skip (never rendered, never sent, never written), not a failure. */
export function classifyWithPageLimit(t: ApprovedTarget, live: LiveUnit | null, prior: Map<string, UnitOutcome>, maxUnitPages: number): UnitClass {
  const cls = classify(t, live, prior);
  return cls === "READY_TO_REGROUND" && t.newEnd - t.newStart + 1 > maxUnitPages ? "PAGE_LIMIT" : cls;
}

export function classify(t: ApprovedTarget, live: LiveUnit | null, prior: Map<string, UnitOutcome>): UnitClass {
  const p = prior.get(t.unitId);
  // A failure stays terminal across ANY number of resumes: a later report records it as SKIPPED_FAILED_PREVIOUSLY, which must carry it forward too.
  if (p === "FAILED_BEFORE_REPLACEMENT" || p === "FAILED_GUARDED_REPLACEMENT" || p === "GROUNDING_REPLACED_ASSIGNMENT_FAILED" || p === "SKIPPED_FAILED_PREVIOUSLY") return "FAILED_PREVIOUSLY";
  if (!live || live.sourceFileOverride !== null || live.subjectSourceFile !== t.sourceKey || live.sourcePageStart !== t.newStart || live.sourcePageEnd !== t.newEnd || !live.hasNotes) return "DRIFTED";
  if (live.groundingSourceFingerprint === t.oldFingerprint) return "READY_TO_REGROUND";
  if (live.groundingSourceFingerprint === t.newFingerprint) {
    const completedBefore = p === "COMPLETED" || p === "SKIPPED_ALREADY_COMPLETED";
    return live.topics.every((x) => x.fingerprint === t.newFingerprint) || completedBefore ? "ALREADY_COMPLETED" : "PARTIAL_ASSIGNMENT";
  }
  return "DRIFTED";
}

/** Deterministic, row-order-independent page-range comparison keyed by Unit ID (ranges are "start-end" strings). Returns one problem per differing Unit; empty means unchanged. */
export function comparePageRanges(before: Record<string, string>, after: Record<string, string>): string[] {
  const ids = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const problems: string[] = [];
  for (const id of ids) {
    if (!(id in after)) problems.push(`unit ${id} missing after`);
    else if (!(id in before)) problems.push(`unit ${id} unexpected after`);
    else if (before[id] !== after[id]) problems.push(`unit ${id} range ${before[id]} -> ${after[id]}`);
  }
  return problems;
}

const emptyAcct = (): Accounting => ({ usageRows: 0, byFeature: {}, inputTokens: 0, outputTokens: 0, costUsd: 0, reservations: {}, reconciledUsd: 0 });
const isBudgetRefusal = (e: unknown) => /budget reservation refused|Budget unavailable|daily_limit|misconfigured/i.test(e instanceof Error ? e.message : String(e));

export async function runWave(options: { plan: RepairPlan; subjectIds: string[]; apply: boolean; prior: Map<string, UnitOutcome>; maxUnitPages: number }, deps: WaveDeps): Promise<WaveReport> {
  if (!Number.isSafeInteger(options.maxUnitPages) || options.maxUnitPages < 1) throw new Error("maxUnitPages must be a positive integer");
  const books = options.subjectIds.map((id) => { const b = options.plan.books.find((x) => x.subjectId === id); if (!b) throw new Error(`book ${id} is not in the reviewed Wave B plan`); return b; });
  const report: WaveReport = { mode: options.apply ? "APPLY" : "DRY_RUN", status: "RUNNING", classification: [], units: [], books: [] };
  const stop = (reason: string) => { report.status = "STOPPED"; report.stopReason = reason; deps.writeReport(report); return report; };
  const targets = books.map((b) => ({ book: b, units: [...b.expectedUnits].sort((x, y) => x.order - y.order).map((u) => approvedTarget(options.plan, u.unitId)) }));
  // Full classification before any work.
  for (const { units } of targets) for (const t of units) report.classification.push({ unitId: t.unitId, label: t.label, classification: classifyWithPageLimit(t, await deps.loadUnit(t.unitId), options.prior, options.maxUnitPages) });
  const bad = report.classification.filter((c) => c.classification === "DRIFTED" || c.classification === "PARTIAL_ASSIGNMENT");
  if (bad.length) return stop(`pre-classification found ${bad.map((b) => `${b.label}=${b.classification}`).join(", ")}`);
  if (!options.apply) { report.status = "COMPLETED"; deps.writeReport(report); return report; }

  // Pre-existing platform accounting gap (e.g. spend released before the
  // failure-path accounting fix) is recorded once; every checkpoint then
  // requires it to be exactly unchanged, so only a NEW gap can stop the run.
  const sinceDay = new Date(deps.now()); sinceDay.setUTCHours(0, 0, 0, 0);
  const baseline = await deps.platformGap(sinceDay);
  report.accountingBaseline = { sinceDay: sinceDay.toISOString(), ...baseline };
  let failures = 0;
  for (const { book, units } of targets) {
    const bookStart = deps.now(); const before = await deps.snapshot(); const processed = new Set<string>(); const processedTopics = new Set<string>();
    let completed = 0, failed = 0;
    for (const t of units) {
      const live = await deps.loadUnit(t.unitId); const cls = classifyWithPageLimit(t, live, options.prior, options.maxUnitPages);
      const base: UnitRecord = { unitId: t.unitId, label: t.label, bookId: book.subjectId, classification: cls, outcome: "COMPLETED", oldFingerprint: t.oldFingerprint, newFingerprint: t.newFingerprint };
      if (cls === "ALREADY_COMPLETED") { report.units.push({ ...base, outcome: "SKIPPED_ALREADY_COMPLETED" }); continue; }
      if (cls === "PAGE_LIMIT") { report.units.push({ ...base, outcome: "SKIPPED_PAGE_LIMIT", reason: `corrected range ${t.newStart}-${t.newEnd} is ${t.newEnd - t.newStart + 1} pages > ${options.maxUnitPages}` }); continue; }
      if (cls === "FAILED_PREVIOUSLY") { report.units.push({ ...base, outcome: "SKIPPED_FAILED_PREVIOUSLY" }); continue; }
      if (cls !== "READY_TO_REGROUND") { report.units.push({ ...base, outcome: "FAILED_BEFORE_REPLACEMENT", reason: cls }); return stop(`${t.label} classified ${cls} immediately before processing`); }
      const unitStart = deps.now();
      let gen;
      try { gen = await deps.generate(t.unitId); validateReplacement(t, gen); }
      catch (e) {
        failures++; failed++; const reason = e instanceof Error ? e.message : String(e);
        report.units.push({ ...base, outcome: "FAILED_BEFORE_REPLACEMENT", reason, accounting: await deps.accountingSince(unitStart) }); deps.writeReport(report);
        if (isBudgetRefusal(e)) return stop(`budget rejection at ${t.label}: ${reason}`);
        if (failures >= 2) return stop(`repeated failure (${failures}) at ${t.label}: ${reason}`);
        continue;
      }
      if ((await deps.replace(t, gen)) !== 1) { report.units.push({ ...base, outcome: "FAILED_GUARDED_REPLACEMENT", reason: "compare-and-set matched no row" }); return stop(`${t.label}: guarded replacement refused (state drift during generation)`); }
      processed.add(t.unitId);
      const after = await deps.loadUnit(t.unitId);
      if (after?.groundingSourceFingerprint !== t.newFingerprint) { report.units.push({ ...base, outcome: "GROUNDING_REPLACED_ASSIGNMENT_FAILED", reason: "fingerprint not current after replace" }); return stop(`${t.label}: fingerprint check failed after replacement`); }
      after.topics.forEach((x) => processedTopics.add(x.id));
      let rebuilt;
      try { rebuilt = await deps.rebuildAssignments(after.topics.map((x) => x.id)); }
      catch (e) { report.units.push({ ...base, outcome: "GROUNDING_REPLACED_ASSIGNMENT_FAILED", reason: e instanceof Error ? e.message : String(e), accounting: await deps.accountingSince(unitStart) }); return stop(`${t.label}: assignment rebuild failed after grounding replacement`); }
      const topics = await deps.verifyTopics(t.unitId);
      const accounting = await deps.accountingSince(unitStart);
      const rec: UnitRecord = { ...base, chunkCount: gen.chunkCount, concepts: gen.notes.concepts.length, ...rebuilt, topics, accounting };
      if (topics.some((x) => x.state === "READY_EMPTY_SLICE")) { report.units.push({ ...rec, outcome: "GROUNDING_REPLACED_ASSIGNMENT_FAILED", reason: "READY assignment with empty downstream slice" }); return stop(`${t.label}: READY assignment without a usable slice`); }
      if (accounting.reservations.RESERVED) { report.units.push({ ...rec, outcome: "GROUNDING_REPLACED_ASSIGNMENT_FAILED", reason: "unreconciled reservation" }); return stop(`${t.label}: ${accounting.reservations.RESERVED} reservation(s) left RESERVED`); }
      report.units.push(rec); completed++; deps.writeReport(report);
    }
    // Book checkpoint.
    const after = await deps.snapshot(); const acct = await deps.accountingSince(bookStart); const h = await deps.health(); const gapNow = await deps.platformGap(sinceDay); const problems: string[] = [];
    const changedUnits = Object.keys({ ...before.units, ...after.units }).filter((k) => before.units[k] !== after.units[k]);
    const changedAssign = Object.keys({ ...before.assignByTopic, ...after.assignByTopic }).filter((k) => before.assignByTopic[k] !== after.assignByTopic[k]);
    const gates: Record<string, boolean> = {
      onlyProcessedUnitsChanged: changedUnits.every((k) => processed.has(k)),
      onlyProcessedTopicsAssignmentsChanged: changedAssign.every((k) => processedTopics.has(k)),
      pageRangesUnchanged: comparePageRanges(before.ranges, after.ranges).length === 0,
      teachingStepsUnchanged: before.teachingSteps === after.teachingSteps,
      questionsUnchanged: before.questions === after.questions,
      questionDraftsUnchanged: before.questionDrafts === after.questionDrafts,
      topicSourceEvidenceUnchanged: before.tse === after.tse,
      groundingProgressUnchanged: before.progress === after.progress,
      noOpenReservations: !acct.reservations.RESERVED,
      accountingReconciled: Math.abs(acct.costUsd - acct.reconciledUsd) < 1e-6,
      accountingBaselineGapUnchanged: Math.abs(gapNow.gapUsd - baseline.gapUsd) < 1e-6,
      healthLive: h.live === 200,
      healthReady: h.ready === 200,
    };
    for (const [k, v] of Object.entries(gates)) if (!v) problems.push(k);
    if (!gates.pageRangesUnchanged) problems.push(...comparePageRanges(before.ranges, after.ranges).slice(0, 20));
    if (!gates.onlyProcessedUnitsChanged) problems.push(`unrelated units: ${changedUnits.filter((k) => !processed.has(k)).join(",")}`);
    if (!gates.onlyProcessedTopicsAssignmentsChanged) problems.push(`unrelated assignments: ${changedAssign.filter((k) => !processedTopics.has(k)).join(",")}`);
    if (!gates.accountingBaselineGapUnchanged) problems.push(`platform gap ${baseline.gapUsd.toFixed(8)} -> ${gapNow.gapUsd.toFixed(8)}`);
    const cp: BookCheckpoint = { bookId: book.subjectId, label: book.label, platformGapUsd: gapNow.gapUsd, unitsCompleted: completed, unitsFailed: failed, readyBefore: before.ready, readyAfter: after.ready, blockedBefore: before.blocked, blockedAfter: after.blocked, accounting: acct, gates, passed: problems.length === 0, problems };
    report.books.push(cp); deps.writeReport(report);
    if (!cp.passed) return stop(`checkpoint failed for ${book.label}: ${problems.join("; ")}`);
  }
  report.status = "COMPLETED"; deps.writeReport(report); return report;
}

export function loadPrior(file?: string): Map<string, UnitOutcome> {
  if (!file) return new Map();
  const r = JSON.parse(fs.readFileSync(file, "utf8")) as WaveReport;
  return new Map((r.units ?? []).map((u) => [u.unitId, u.outcome]));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = validatePlan(JSON.parse(fs.readFileSync(args.plan, "utf8")));
  const crypto = await import("crypto");
  const { NestFactory } = await import("@nestjs/core");
  const { AppModule } = await import("../app.module");
  const { PrismaService } = await import("../prisma/prisma.service");
  const { UnitGroundingService, MAX_UNIT_PAGE_COUNT } = await import("../interactive-lesson/unit-grounding/unit-grounding.service");
  const { CONTENT_AUTHORING_ACTOR_ID } = await import("../ai/content-authoring-actor.const");
  const { TopicGroundingAssignmentService } = await import("../ai/context/topic-grounding-assignment.service");
  const { TopicGroundingMapperService } = await import("../ai/context/topic-grounding-mapper.service");
  const { TopicSourceEvidenceService } = await import("../ai/context/topic-source-evidence.service");
  const { AIProviderFactory } = await import("../ai/ai-provider.factory");
  const { AIUsageService } = await import("../ai/usage/ai-usage.service");
  const { resolveAssignedGroundingSlice } = await import("../ai/context/topic-grounding-assignment.util");
  const { runRemediation } = await import("./topic-grounding-remediation");
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  const h = (x: unknown) => crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 16);
  try {
    const prismaService = app.get(PrismaService); const prisma = prismaService.client;
    const grounding = app.get(UnitGroundingService); const assignment = app.get(TopicGroundingAssignmentService); const provider = app.get(AIProviderFactory);
    const mapper = new TopicGroundingMapperService(prismaService, provider, app.get(AIUsageService), assignment);
    const port = process.env.PORT ?? "8080";
    const deps: WaveDeps = {
      loadUnit: async (id) => {
        const u = await prisma.unit.findUnique({ where: { id }, select: { id: true, sourceFileOverride: true, sourcePageStart: true, sourcePageEnd: true, groundingSourceFingerprint: true, groundingNotesJson: true, subject: { select: { sourceFile: true } }, topics: { orderBy: { order: "asc" }, select: { id: true, nameEn: true, groundingAssignment: { select: { status: true, unitSourceFingerprint: true } } } } } });
        return u && { id: u.id, sourceFileOverride: u.sourceFileOverride, subjectSourceFile: u.subject.sourceFile, sourcePageStart: u.sourcePageStart, sourcePageEnd: u.sourcePageEnd, groundingSourceFingerprint: u.groundingSourceFingerprint, hasNotes: !!u.groundingNotesJson, topics: u.topics.map((t: any) => ({ id: t.id, nameEn: t.nameEn, status: t.groundingAssignment?.status ?? null, fingerprint: t.groundingAssignment?.unitSourceFingerprint ?? null })) };
      },
      generate: (id) => grounding.generateReplacementGrounding(id, CONTENT_AUTHORING_ACTOR_ID),
      replace: async (t, gen) => (await prisma.unit.updateMany({ where: { id: t.unitId, sourcePageStart: t.newStart, sourcePageEnd: t.newEnd, groundingSourceFingerprint: t.oldFingerprint, sourceFileOverride: null }, data: { groundingNotesJson: gen.notes, groundingGeneratedAt: new Date(), groundingVersion: gen.groundingVersion, groundingModel: gen.model, groundingPromptVersion: gen.groundingPromptVersion, groundingSourceFingerprint: t.newFingerprint } })).count,
      rebuildAssignments: async (topicIds) => {
        const r = await runRemediation({ topicIds, sourceWindows: new Map(), apply: true }, { prisma: prismaService, assignment, mapper, sourceEvidence: app.get(TopicSourceEvidenceService), activeModel: async () => (await provider.getActiveProvider()).model });
        return { deterministicRecovered: r.deterministicRecovered, compactMapperAttempted: r.compactMapperAttempted, compactMapperRecovered: r.compactMapperRecovered };
      },
      verifyTopics: async (unitId) => {
        const u = await prisma.unit.findUnique({ where: { id: unitId }, select: { id: true, groundingVersion: true, groundingSourceFingerprint: true, groundingNotesJson: true, topics: { select: { id: true, nameEn: true, groundingAssignment: true, topicSourceEvidence: { where: { status: "READY" } } } } } });
        return u!.topics.map((t: any) => {
          const a = t.groundingAssignment; const current = !!a && a.unitSourceFingerprint === u!.groundingSourceFingerprint && a.unitGroundingVersion === u!.groundingVersion;
          if (!current) return { id: t.id, nameEn: t.nameEn, state: "STALE_UNRESOLVED" as const, method: a?.method ?? null };
          if (a.status !== "READY") return { id: t.id, nameEn: t.nameEn, state: "BLOCKED_CURRENT" as const, method: a.method };
          const s: any = resolveAssignedGroundingSlice(a, { id: u!.id, groundingVersion: u!.groundingVersion, groundingSourceFingerprint: u!.groundingSourceFingerprint, groundingNotesJson: u!.groundingNotesJson } as any, t.topicSourceEvidence);
          const nonEmpty = s.state === "READY" && s.slice.concepts.length + s.slice.facts.length + s.slice.vocabulary.length > 0;
          return { id: t.id, nameEn: t.nameEn, state: nonEmpty ? ("READY_CURRENT" as const) : ("READY_EMPTY_SLICE" as const), method: a.method };
        });
      },
      snapshot: async () => {
        const units = await prisma.unit.findMany({ select: { id: true, sourcePageStart: true, sourcePageEnd: true, sourceFileOverride: true, groundingNotesJson: true, groundingGeneratedAt: true, groundingVersion: true, groundingModel: true, groundingPromptVersion: true, groundingSourceFingerprint: true } });
        const assigns = await prisma.topicGroundingAssignment.findMany();
        return {
          units: Object.fromEntries(units.map((u: any) => [u.id, h(u)])), ranges: Object.fromEntries(units.map((u: any) => [u.id, `${u.sourcePageStart}-${u.sourcePageEnd}`])),
          assignByTopic: Object.fromEntries(assigns.map((a: any) => [a.topicId, h(a)])),
          teachingSteps: h(await prisma.topic.findMany({ orderBy: { id: "asc" }, select: { id: true, teachingStepsJson: true } })),
          questions: h(await prisma.question.findMany({ orderBy: { id: "asc" } })), questionDrafts: h(await prisma.questionDraft.findMany({ orderBy: { id: "asc" } })),
          tse: h(await prisma.topicSourceEvidence.findMany({ orderBy: { id: "asc" } })), progress: h(await prisma.unitGroundingProgress.findMany({ orderBy: { unitId: "asc" } })),
          ready: assigns.filter((a: any) => a.status === "READY").length, blocked: assigns.filter((a: any) => a.status === "BLOCKED").length,
        };
      },
      accountingSince: async (since) => {
        const usage = await prisma.aIUsage.findMany({ where: { createdAt: { gte: since }, userId: CONTENT_AUTHORING_ACTOR_ID }, select: { feature: true, inputTokens: true, outputTokens: true, costUsd: true } });
        const res = await prisma.aIBudgetReservation.findMany({ where: { createdAt: { gte: since }, userId: CONTENT_AUTHORING_ACTOR_ID }, select: { status: true, reconciledUsd: true } });
        const a = emptyAcct(); a.usageRows = usage.length;
        for (const x of usage) { a.byFeature[x.feature] = (a.byFeature[x.feature] ?? 0) + 1; a.inputTokens += x.inputTokens; a.outputTokens += x.outputTokens; a.costUsd += Number(x.costUsd); }
        for (const r of res) { a.reservations[r.status] = (a.reservations[r.status] ?? 0) + 1; a.reconciledUsd += Number(r.reconciledUsd ?? 0); }
        return a;
      },
      health: async () => { const get = async (p: string) => { try { return (await fetch(`http://127.0.0.1:${port}${p}`)).status; } catch { return 0; } }; return { live: await get("/health/live"), ready: await get("/health/ready") }; },
      platformGap: async (sinceDay) => {
        const usage = await prisma.aIUsage.aggregate({ where: { createdAt: { gte: sinceDay }, userId: CONTENT_AUTHORING_ACTOR_ID }, _sum: { costUsd: true } });
        const counters = await prisma.aIDailyBudgetCounter.findMany({ where: { scope: "platform", scopeKey: CONTENT_AUTHORING_ACTOR_ID, usageDate: { gte: sinceDay } }, select: { committedUsd: true } });
        const aiUsageUsd = Number(usage._sum.costUsd ?? 0), committedUsd = counters.reduce((n: number, c: any) => n + Number(c.committedUsd), 0);
        return { aiUsageUsd, committedUsd, gapUsd: aiUsageUsd - committedUsd };
      },
      now: () => new Date(),
      writeReport: (r) => { if (args.report) fs.writeFileSync(args.report, JSON.stringify(r, null, 1)); },
    };
    const report = await runWave({ plan, subjectIds: args.subjectIds, apply: args.apply, prior: loadPrior(args.priorReport), maxUnitPages: MAX_UNIT_PAGE_COUNT }, deps);
    console.log(JSON.stringify({ status: report.status, stopReason: report.stopReason, units: report.units.length, books: report.books.length }));
    if (report.status !== "COMPLETED") process.exitCode = 3;
  } finally { await app.close(); }
}

if (require.main === module) main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 2; });

/**
 * Explicit, allowlisted ADMIN repair of confirmed-wrong CURRENT Questions
 * (2026-10-03), never exposing an intermediate pool size.
 *
 * `--questionIds` (at most MAX_REPLACEMENTS_PER_RUN, no discovery) are grouped
 * by Topic. Each Topic is ONE repair: retire its listed Questions (k) and
 * publish exactly enough staged candidates to land at REPLACEMENT_POOL_TARGET
 * active CURRENT Questions — k when the Topic has the full target (8 -> 8),
 * k + 1 or k + 2 when it is short (e.g. 7 with 2 wrong -> stage 3 -> 8).
 *   1. PREFLIGHT (read-only): every listed Question is active (not retired),
 *      CURRENT under its Topic's live READY gate, servable and unanswered; the
 *      Topic serves only active CURRENT Questions.
 *   2. STAGE (provider calls, off the serving path): candidates through the
 *      staged generator path — pending_review QuestionDrafts no student path
 *      reads — judged with the Topic's kept Questions (+ already staged ones)
 *      as the accepted pool; structural, duplicate, arithmetic and
 *      grounding/verbatim validation all run in the generator. Bounded batches.
 *   3. VALIDATE every stored candidate again independently.
 *   4. COMMIT in ONE Serializable transaction per Topic: compare-and-set on the
 *      exact active set and every precondition, publish all candidates, retire
 *      the listed Questions (retiredAt / retiredReason / replacedByQuestionId —
 *      content and provenance never change), then re-read and require exactly
 *      the target active CURRENT servable Questions: listed ones excluded,
 *      every candidate included, no duplicate prompts, pool grounding passes,
 *      arithmetic INVALID = 0. Any failure rolls everything back.
 * The Unit's enforcement mode (STRICT/TRANSITION) is never touched.
 *
 * Modes: DRY RUN (default, preflight only) | --stage (stage + validate, no live
 * change; prints the candidate draft ids for review) | --commit=<draftId,...>
 * (commit reviewed staged drafts) | --apply (stage then commit). Stops at the
 * first failure.
 *
 * Usage:
 *   node dist/scripts/replace-current-questions.js --questionIds=<id>[,<id>] [--stage | --commit=<draftId>[,<draftId>] | --apply]
 */
import {
  evaluateTopicGroundingGate,
  isActiveCurrentQuestion,
  isRetired,
  questionServabilityByTopic,
  type TopicGroundingGate,
} from "../ai/context/topic-content-provenance.util";
import { checkGroundingConsistency } from "../ai/context/grounding-consistency-validator";
import { validateQuestionDraft } from "../question-bank/question-draft-generator/question-draft-validator";
import { checkArithmeticConsistency } from "../question-bank/question-draft-generator/arithmetic-consistency";

export const MAX_REPLACEMENTS_PER_RUN = 10;
export const REPLACEMENT_POOL_TARGET = 8;
/** A repair may fill at most this many missing slots beyond the retired ones (it is not a bulk generator). */
export const MAX_FILL = 2;
export const MAX_STAGE_BATCHES = 2;
export const RETIRED_REASON = "DETERMINISTIC_CORRECTNESS_FAILURE";
const ID = /^[a-z0-9]{20,40}$/;

export interface RepairArgs { questionIds: string[]; apply: boolean; stage: boolean; commit: string[] | null }
export function parseArgs(argv: string[]): RepairArgs {
  for (const a of argv) if (!/^--(questionIds|commit)=.+$/.test(a) && a !== "--apply" && a !== "--stage") throw new Error(`unexpected argument: ${a}`);
  for (const f of ["--apply", "--stage"]) if (argv.filter((a) => a === f).length > 1) throw new Error(`${f} given more than once`);
  const lists = argv.filter((a) => a.startsWith("--questionIds="));
  if (lists.length !== 1) throw new Error("--questionIds must be given exactly once");
  const questionIds = lists[0].slice("--questionIds=".length).split(",");
  if (questionIds.some((x) => !ID.test(x))) throw new Error("malformed --questionIds entry");
  if (new Set(questionIds).size !== questionIds.length) throw new Error("duplicate --questionIds entry");
  if (questionIds.length > MAX_REPLACEMENTS_PER_RUN) throw new Error(`at most ${MAX_REPLACEMENTS_PER_RUN} Questions per run`);
  const commits = argv.filter((a) => a.startsWith("--commit="));
  if (commits.length > 1) throw new Error("--commit given more than once");
  const commit = commits.length ? commits[0].slice("--commit=".length).split(",") : null;
  if (commit && (commit.some((x) => !ID.test(x)) || new Set(commit).size !== commit.length)) throw new Error("malformed --commit entry");
  const apply = argv.includes("--apply"), stage = argv.includes("--stage");
  if ([apply, stage, !!commit].filter(Boolean).length > 1) throw new Error("--apply, --stage and --commit are mutually exclusive");
  return { questionIds, apply, stage, commit };
}

export class ReplacementError extends Error {
  constructor(public readonly stage: string, message: string) { super(`${stage}: ${message}`); }
}

type ReadyGate = Extract<TopicGroundingGate, { state: "READY" }>;
/** Everything the repair reads about one Topic (one query shape for preflight and the in-transaction re-read). */
export const TOPIC_STATE_SELECT = {
  id: true, unitId: true, groundingAssignment: true, topicSourceEvidence: true,
  unit: { select: { id: true, groundingVersion: true, groundingSourceFingerprint: true, groundingNotesJson: true, contentProvenanceEnforcedAt: true } },
  questions: {
    select: {
      id: true, topicId: true, isPlaceholder: true, type: true, promptEn: true, explanationEn: true, optionsJson: true, correctAnswerJson: true,
      groundingSourceFingerprint: true, groundingAssignmentFingerprint: true, retiredAt: true, retiredReason: true, replacedByQuestionId: true,
      _count: { select: { attempts: true } },
    },
  },
} as const;

type PoolText = { id?: string; promptEn: string; explanationEn?: string | null };
export interface RepairPlan {
  topicId: string;
  unitId: string;
  unitMode: "STRICT" | "TRANSITION";
  gate: ReadyGate;
  retireIds: string[];
  /** The Topic's active CURRENT Questions that stay. */
  keep: PoolText[];
  activeBeforeIds: string[];
  /** Candidates to stage = target - keep. */
  need: number;
}
/** Single-Question view kept for the 8 -> 8 API. */
export interface ReplacementPlan extends RepairPlan { questionId: string; others: PoolText[] }

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const poolTexts = (q: PoolText) => [q.promptEn, q.explanationEn].filter((t): t is string => !!t);

/** Pure: the conditions that must hold for retiring `retireIds` in `topic` — before staging and again inside the commit. */
export function checkRepairable(topic: any, retireIds: string[], expected?: { sourceFingerprint: string; assignmentFingerprint: string; activeIds?: string[] }): { gate: ReadyGate; active: any[] } {
  if (!topic) throw new ReplacementError("PRECONDITION", `Topic for ${retireIds.join(",")} not found`);
  const gate = evaluateTopicGroundingGate(topic);
  if (gate.state !== "READY") throw new ReplacementError("PRECONDITION", `Topic ${topic.id} gate is not READY (${gate.reason})`);
  if (expected && (gate.provenance.groundingSourceFingerprint !== expected.sourceFingerprint || gate.provenance.groundingAssignmentFingerprint !== expected.assignmentFingerprint)) {
    throw new ReplacementError("PRECONDITION", `Topic ${topic.id} grounding identity changed`);
  }
  const servable = questionServabilityByTopic([topic], topic.questions);
  for (const id of retireIds) {
    const old = topic.questions.find((q: any) => q.id === id);
    if (!old) throw new ReplacementError("PRECONDITION", `${id} is not a Question of Topic ${topic.id}`);
    if (isRetired(old)) throw new ReplacementError("PRECONDITION", `${id} is already retired`);
    if (!isActiveCurrentQuestion(old, gate.provenance)) throw new ReplacementError("PRECONDITION", `${id} is not an active CURRENT Question`);
    if (old._count.attempts !== 0) throw new ReplacementError("PRECONDITION", `${id} has ${old._count.attempts} student attempt(s)`);
    if (!servable(old)) throw new ReplacementError("PRECONDITION", `${id} is not currently servable`);
  }
  const active = topic.questions.filter((q: any) => isActiveCurrentQuestion(q, gate.provenance) && servable(q));
  if (topic.questions.some((q: any) => servable(q) && !isActiveCurrentQuestion(q, gate.provenance))) throw new ReplacementError("PRECONDITION", `Topic ${topic.id} serves non-CURRENT Questions`);
  if (active.length > REPLACEMENT_POOL_TARGET) throw new ReplacementError("PRECONDITION", `Topic ${topic.id} has ${active.length} active CURRENT Questions`);
  const need = REPLACEMENT_POOL_TARGET - (active.length - retireIds.length);
  if (need - retireIds.length > MAX_FILL) throw new ReplacementError("PRECONDITION", `Topic ${topic.id} would need ${need - retireIds.length} fill Questions (max ${MAX_FILL})`);
  if (expected?.activeIds && JSON.stringify(active.map((q: any) => q.id).sort()) !== JSON.stringify([...expected.activeIds].sort())) {
    throw new ReplacementError("PRECONDITION", `Topic ${topic.id} active Question set changed`);
  }
  return { gate, active };
}

export function planRepair(topic: any, retireIds: string[]): RepairPlan {
  const { gate, active } = checkRepairable(topic, retireIds);
  const keep = active.filter((q: any) => !retireIds.includes(q.id)).map((q: any) => ({ id: q.id, promptEn: q.promptEn, explanationEn: q.explanationEn }));
  return {
    topicId: topic.id, unitId: topic.unitId, unitMode: topic.unit.contentProvenanceEnforcedAt ? "STRICT" : "TRANSITION", gate,
    retireIds: [...retireIds], keep, activeBeforeIds: active.map((q: any) => q.id).sort(), need: REPLACEMENT_POOL_TARGET - keep.length,
  };
}
export function planReplacement(topic: any, questionId: string): ReplacementPlan {
  const plan = planRepair(topic, [questionId]);
  if (plan.need !== 1) throw new ReplacementError("PRECONDITION", `${questionId}: Topic has ${plan.keep.length + 1} active CURRENT servable Questions, expected ${REPLACEMENT_POOL_TARGET}`);
  return { ...plan, questionId, others: plan.keep };
}

/** Pure: independent validation of ONE stored candidate draft against the Topic and the rest of the final pool. Empty = valid. */
export function validateCandidate(draft: any, plan: { topicId: string; gate: ReadyGate; others?: PoolText[]; keep?: PoolText[] }, siblings: PoolText[] = []): string[] {
  const errors: string[] = [];
  if (!draft) return ["candidate draft not found"];
  const others = [...(plan.others ?? plan.keep ?? []), ...siblings];
  if (draft.topicId !== plan.topicId) errors.push("candidate belongs to another Topic");
  if (draft.status !== "pending_review" || draft.publishedQuestionId) errors.push("candidate is not an unpublished pending draft");
  if (draft.groundingSourceFingerprint !== plan.gate.provenance.groundingSourceFingerprint || draft.groundingAssignmentFingerprint !== plan.gate.provenance.groundingAssignmentFingerprint) errors.push("candidate provenance is not the Topic's current provenance");
  const structural = validateQuestionDraft(draft, { topicExists: true, topicIsPlaceholder: false, requireReviewedContent: true });
  if (!structural.valid) errors.push(`structurally invalid: ${structural.errors.join("; ")}`);
  const arithmetic = checkArithmeticConsistency(draft);
  if (arithmetic.status === "INVALID") errors.push(`arithmetic INVALID: ${arithmetic.findings.map((f) => f.code).join(",")}`);
  if (others.some((o) => norm(o.promptEn) === norm(draft.promptEn))) errors.push("candidate duplicates a Question in the final pool");
  const grounding = checkGroundingConsistency([...others, draft].flatMap(poolTexts), plan.gate.slice, { wordForms: true });
  if (grounding.length) errors.push(`final pool grounding: ${grounding.join("; ")}`);
  return errors;
}

/**
 * The atomic repair: retire `plan.retireIds`, publish every draft, land at exactly the target.
 * `installDraft` publishes one draft inside `tx` (QuestionPublishService.installAutoQuestionDraft in production).
 */
export async function atomicRepair(
  prisma: { $transaction: (fn: (tx: any) => Promise<any>, opts: any) => Promise<any> },
  plan: RepairPlan,
  draftIds: string[],
  installDraft: (tx: any, draft: any) => Promise<{ id: string }>,
  isolationLevel: unknown,
) {
  if (draftIds.length !== plan.need || new Set(draftIds).size !== draftIds.length) throw new ReplacementError("CANDIDATE", `Topic ${plan.topicId} needs exactly ${plan.need} distinct staged drafts, got ${draftIds.length}`);
  const expected = { sourceFingerprint: plan.gate.provenance.groundingSourceFingerprint, assignmentFingerprint: plan.gate.provenance.groundingAssignmentFingerprint, activeIds: plan.activeBeforeIds };
  return prisma.$transaction(
    async (tx: any) => {
      const before = await tx.topic.findUnique({ where: { id: plan.topicId }, select: TOPIC_STATE_SELECT });
      const pre = checkRepairable(before, plan.retireIds, expected);
      const keep = pre.active.filter((q: any) => !plan.retireIds.includes(q.id));
      const drafts: any[] = [];
      for (const id of draftIds) drafts.push(await tx.questionDraft.findUnique({ where: { id } }));
      drafts.forEach((d, i) => {
        const errors = validateCandidate(d, { topicId: plan.topicId, gate: pre.gate, keep }, drafts.filter((_, j) => j !== i));
        if (errors.length) throw new ReplacementError("CANDIDATE", `${draftIds[i]}: ${errors.join(" | ")}`);
      });
      const modeBefore = before.unit.contentProvenanceEnforcedAt;

      const published: string[] = [];
      for (const d of drafts) published.push((await installDraft(tx, d)).id);
      const retiredAt = new Date();
      for (let i = 0; i < plan.retireIds.length; i++) {
        const r = await tx.question.updateMany({
          where: { id: plan.retireIds[i], topicId: plan.topicId, retiredAt: null },
          data: { retiredAt, retiredReason: RETIRED_REASON, replacedByQuestionId: published[i] },
        });
        if (r.count !== 1) throw new ReplacementError("SWAP", `${plan.retireIds[i]} changed concurrently`);
      }

      // Post-condition BEFORE commit, on the transaction's own view.
      const after = await tx.topic.findUnique({ where: { id: plan.topicId }, select: TOPIC_STATE_SELECT });
      const gate = evaluateTopicGroundingGate(after);
      if (gate.state !== "READY" || gate.provenance.groundingSourceFingerprint !== expected.sourceFingerprint || gate.provenance.groundingAssignmentFingerprint !== expected.assignmentFingerprint) throw new ReplacementError("POSTCONDITION", "Topic gate changed");
      if (String(after.unit.contentProvenanceEnforcedAt) !== String(modeBefore)) throw new ReplacementError("POSTCONDITION", "Unit enforcement mode changed");
      const servable = questionServabilityByTopic([after], after.questions);
      const active = after.questions.filter((q: any) => isActiveCurrentQuestion(q, gate.provenance) && servable(q));
      const servedAll = after.questions.filter((q: any) => servable(q));
      const problems: string[] = [];
      if (active.length !== REPLACEMENT_POOL_TARGET) problems.push(`active CURRENT servable pool would be ${active.length}`);
      if (servedAll.length !== active.length) problems.push("non-CURRENT Question would be servable");
      for (const id of plan.retireIds) {
        const row = after.questions.find((q: any) => q.id === id);
        if (active.some((q: any) => q.id === id) || servable(row) || !isRetired(row)) problems.push(`${id} would remain servable`);
      }
      for (const id of published) if (!active.some((q: any) => q.id === id)) problems.push(`${id} would not be servable`);
      if (new Set(active.map((q: any) => norm(q.promptEn))).size !== active.length) problems.push("duplicate prompts in the pool");
      const grounding = checkGroundingConsistency(active.flatMap(poolTexts), gate.slice, { wordForms: true });
      if (grounding.length) problems.push(`pool grounding: ${grounding.join("; ")}`);
      const invalid = active.filter((q: any) => checkArithmeticConsistency(q).status === "INVALID").map((q: any) => q.id);
      if (invalid.length) problems.push(`arithmetic INVALID in the final pool: ${invalid.join(",")}`);
      if (problems.length) throw new ReplacementError("POSTCONDITION", problems.join(" | "));
      return {
        topicId: plan.topicId, retired: plan.retireIds.map((id, i) => ({ id, replacedBy: published[i] })), published, retiredAt,
        activeBefore: pre.active.map((q: any) => q.id).sort(), activeAfter: active.map((q: any) => q.id).sort(),
      };
    },
    { isolationLevel, maxWait: 10000, timeout: 30000 },
  );
}

/** The 8 -> 8 single-Question swap (kept API). */
export async function atomicReplace(
  prisma: { $transaction: (fn: (tx: any) => Promise<any>, opts: any) => Promise<any> },
  plan: ReplacementPlan,
  draftId: string,
  installDraft: (tx: any, draft: any) => Promise<{ id: string }>,
  isolationLevel: unknown,
) {
  const r = await atomicRepair(prisma, plan, [draftId], installDraft, isolationLevel);
  return { oldQuestionId: plan.questionId, replacementQuestionId: r.published[0], retiredAt: r.retiredAt, activeBefore: r.activeBefore, activeAfter: r.activeAfter };
}

/** Groups explicit ids by Topic (input order kept). */
export function groupByTopic(rows: Array<{ id: string; topicId: string }>, ids: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const row = rows.find((r) => r.id === id);
    if (!row) throw new ReplacementError("PRECONDITION", `${id} not found`);
    groups.set(row.topicId, [...(groups.get(row.topicId) ?? []), id]);
  }
  return groups;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await import("reflect-metadata");
  await import("dotenv/config");
  const { NestFactory } = await import("@nestjs/core");
  const { AppModule } = await import("../app.module");
  const { PrismaService } = await import("../prisma/prisma.service");
  const { QuestionDraftGeneratorService } = await import("../question-bank/question-draft-generator/question-draft-generator.service");
  const { installAutoQuestionDraft } = await import("../question-bank/question-draft-generator/question-publish.service");
  const { CONTENT_AUTHORING_ACTOR_ID } = await import("../ai/content-authoring-actor.const");
  const { Prisma } = await import("@smartify/database");

  const mode = args.apply ? "APPLY" : args.stage ? "STAGE" : args.commit ? "COMMIT" : "DRY_RUN";
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn", "log"] });
  const report: any[] = [];
  try {
    const prisma = app.get(PrismaService).client;
    const generator = app.get(QuestionDraftGeneratorService);
    const rows = await prisma.question.findMany({ where: { id: { in: args.questionIds } }, select: { id: true, topicId: true } });
    const groups = groupByTopic(rows, args.questionIds);
    const loadTopic = (topicId: string) => prisma.topic.findUnique({ where: { id: topicId }, select: TOPIC_STATE_SELECT });
    const commitDrafts = args.commit ? await prisma.questionDraft.findMany({ where: { id: { in: args.commit } } }) : [];
    if (args.commit && commitDrafts.length !== args.commit.length) throw new ReplacementError("CANDIDATE", "unknown --commit draft id");

    for (const [topicId, retireIds] of groups) {
      const plan = planRepair(await loadTopic(topicId), retireIds);
      const entry: any = { topicId, unitId: plan.unitId, unitMode: plan.unitMode, retire: retireIds, activeBefore: plan.activeBeforeIds.length, keep: plan.keep.length, need: plan.need };
      if (mode === "DRY_RUN") { report.push({ ...entry, status: "PLANNED" }); continue; }

      let draftIds: string[];
      if (mode === "COMMIT") {
        draftIds = commitDrafts.filter((d) => d.topicId === topicId).map((d) => d.id);
      } else {
        draftIds = [];
        const staged: any[] = [];
        for (let batch = 0; batch < MAX_STAGE_BATCHES && draftIds.length < plan.need; batch++) {
          const { drafts } = await generator.generateAutoQuestionBatch(topicId, plan.need - draftIds.length, CONTENT_AUTHORING_ACTOR_ID, { gate: plan.gate, acceptedPool: [...plan.keep, ...staged] });
          for (const d of drafts) { draftIds.push(d.id); staged.push({ promptEn: d.promptEn, explanationEn: d.explanationEn }); }
        }
        entry.stagedDraftIds = draftIds;
        if (draftIds.length !== plan.need) throw Object.assign(new ReplacementError("STAGE", `Topic ${topicId}: staged ${draftIds.length}/${plan.need} candidates after ${MAX_STAGE_BATCHES} bounded batch(es)`), { entry });
        const stored = await prisma.questionDraft.findMany({ where: { id: { in: draftIds } } });
        const errors = stored.flatMap((d, i) => validateCandidate(d, plan, stored.filter((_, j) => j !== i)).map((e) => `${d.id}: ${e}`));
        if (errors.length) throw Object.assign(new ReplacementError("CANDIDATE", errors.join(" | ")), { entry });
        entry.candidates = stored.map((d) => ({ id: d.id, promptEn: d.promptEn, optionsJson: d.optionsJson, correctAnswerJson: d.correctAnswerJson, explanationEn: d.explanationEn, arithmetic: checkArithmeticConsistency(d).status }));
        if (mode === "STAGE") { report.push({ ...entry, status: "STAGED" }); continue; }
      }
      const result = await atomicRepair(prisma as any, plan, draftIds, installAutoQuestionDraft as any, Prisma.TransactionIsolationLevel.Serializable);
      // Fresh read OUTSIDE the transaction: the committed state.
      const committed: any = await loadTopic(topicId);
      const gate = evaluateTopicGroundingGate(committed) as ReadyGate;
      const servable = questionServabilityByTopic([committed], committed.questions);
      const active = committed.questions.filter((q: any) => isActiveCurrentQuestion(q, gate.provenance) && servable(q)).map((q: any) => q.id);
      report.push({ ...entry, status: "REPAIRED", ...result, committedActive: active.length, retiredServable: retireIds.filter((id) => servable(committed.questions.find((q: any) => q.id === id))) });
    }
    console.log(JSON.stringify({ mode, report }, null, 2));
  } catch (err) {
    console.log(JSON.stringify({ mode, report, failed: { error: err instanceof Error ? err.message : String(err), entry: (err as any)?.entry } }, null, 2));
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => { console.error("REPLACEMENT FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
}

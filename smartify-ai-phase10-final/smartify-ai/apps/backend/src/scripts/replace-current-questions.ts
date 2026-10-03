/**
 * Explicit, allowlisted ADMIN replacement of confirmed-wrong CURRENT Questions
 * (2026-10-03), one Question at a time, never exposing a 7- or 9-Question pool.
 *
 * For each `--questionIds` entry (at most MAX_REPLACEMENTS_PER_RUN, no
 * discovery):
 *   1. PREFLIGHT (read-only): the Question is active (not retired), CURRENT
 *      under its Topic's live READY gate, servable, has zero attempts, and is
 *      one of exactly POOL_TARGET active CURRENT Questions of its Topic.
 *   2. STAGE (provider calls, off the serving path): ONE replacement candidate
 *      through the staged generator path — a pending_review QuestionDraft no
 *      student path reads — judged with the Topic's other active CURRENT
 *      Questions as the accepted pool (structural, duplicate, arithmetic and
 *      grounding/verbatim validation all run in the generator).
 *   3. VALIDATE the stored candidate again independently.
 *   4. SWAP in ONE Serializable transaction: re-check every preflight
 *      condition (compare-and-set), publish the candidate, retire the old
 *      Question (retiredAt / retiredReason / replacedByQuestionId — its content
 *      and provenance are never changed), then re-read and require exactly
 *      POOL_TARGET active CURRENT servable Questions with the old one excluded
 *      and the replacement included. Any failure rolls the whole swap back.
 * The Unit's enforcement mode (STRICT/TRANSITION) is never touched.
 *
 * DRY RUN (default) performs only the preflight. Stops at the first failure.
 *
 * Usage:
 *   node dist/scripts/replace-current-questions.js --questionIds=<id>[,<id>] [--apply]
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
export const RETIRED_REASON = "DETERMINISTIC_CORRECTNESS_FAILURE";
const ID = /^[a-z0-9]{20,40}$/;

export function parseArgs(argv: string[]): { questionIds: string[]; apply: boolean } {
  for (const a of argv) if (!/^--questionIds=.+$/.test(a) && a !== "--apply") throw new Error(`unexpected argument: ${a}`);
  if (argv.filter((a) => a === "--apply").length > 1) throw new Error("--apply given more than once");
  const lists = argv.filter((a) => a.startsWith("--questionIds="));
  if (lists.length !== 1) throw new Error("--questionIds must be given exactly once");
  const questionIds = lists[0].slice("--questionIds=".length).split(",");
  if (questionIds.some((x) => !ID.test(x))) throw new Error("malformed --questionIds entry");
  if (new Set(questionIds).size !== questionIds.length) throw new Error("duplicate --questionIds entry");
  if (questionIds.length > MAX_REPLACEMENTS_PER_RUN) throw new Error(`at most ${MAX_REPLACEMENTS_PER_RUN} Questions per run`);
  return { questionIds, apply: argv.includes("--apply") };
}

export class ReplacementError extends Error {
  constructor(public readonly stage: string, message: string) { super(`${stage}: ${message}`); }
}

type ReadyGate = Extract<TopicGroundingGate, { state: "READY" }>;
/** Everything the replacement reads about one Topic (one query shape for preflight and the in-transaction re-read). */
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

export interface ReplacementPlan {
  questionId: string;
  topicId: string;
  unitId: string;
  unitMode: "STRICT" | "TRANSITION";
  gate: ReadyGate;
  /** The Topic's other active CURRENT Questions — the accepted pool the candidate is judged with. */
  others: Array<{ id: string; promptEn: string; explanationEn: string | null }>;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const poolTexts = (q: { promptEn: string; explanationEn?: string | null }) => [q.promptEn, q.explanationEn].filter((t): t is string => !!t);

/** Pure: the conditions that must hold for `questionId` in `topic`, both before staging and inside the swap transaction. */
export function checkReplaceable(topic: any, questionId: string, expected?: { sourceFingerprint: string; assignmentFingerprint: string }): { gate: ReadyGate; active: any[]; old: any } {
  if (!topic) throw new ReplacementError("PRECONDITION", `Topic for ${questionId} not found`);
  const gate = evaluateTopicGroundingGate(topic);
  if (gate.state !== "READY") throw new ReplacementError("PRECONDITION", `${questionId}: Topic gate is not READY (${gate.reason})`);
  if (expected && (gate.provenance.groundingSourceFingerprint !== expected.sourceFingerprint || gate.provenance.groundingAssignmentFingerprint !== expected.assignmentFingerprint)) {
    throw new ReplacementError("PRECONDITION", `${questionId}: Topic grounding identity changed`);
  }
  const old = topic.questions.find((q: any) => q.id === questionId);
  if (!old) throw new ReplacementError("PRECONDITION", `${questionId} is not a Question of Topic ${topic.id}`);
  if (isRetired(old)) throw new ReplacementError("PRECONDITION", `${questionId} is already retired`);
  if (!isActiveCurrentQuestion(old, gate.provenance)) throw new ReplacementError("PRECONDITION", `${questionId} is not an active CURRENT Question`);
  if (old._count.attempts !== 0) throw new ReplacementError("PRECONDITION", `${questionId} has ${old._count.attempts} student attempt(s)`);
  const servable = questionServabilityByTopic([topic], topic.questions);
  if (!servable(old)) throw new ReplacementError("PRECONDITION", `${questionId} is not currently servable`);
  const active = topic.questions.filter((q: any) => isActiveCurrentQuestion(q, gate.provenance) && servable(q));
  if (active.length !== REPLACEMENT_POOL_TARGET) throw new ReplacementError("PRECONDITION", `${questionId}: Topic has ${active.length} active CURRENT servable Questions, expected ${REPLACEMENT_POOL_TARGET}`);
  return { gate, active, old };
}

export function planReplacement(topic: any, questionId: string): ReplacementPlan {
  const { gate, active } = checkReplaceable(topic, questionId);
  return {
    questionId, topicId: topic.id, unitId: topic.unitId, unitMode: topic.unit.contentProvenanceEnforcedAt ? "STRICT" : "TRANSITION", gate,
    others: active.filter((q: any) => q.id !== questionId).map((q: any) => ({ id: q.id, promptEn: q.promptEn, explanationEn: q.explanationEn })),
  };
}

/** Pure: independent validation of the stored candidate draft against the plan. Empty = valid. */
export function validateCandidate(draft: any, plan: ReplacementPlan): string[] {
  const errors: string[] = [];
  if (!draft) return ["candidate draft not found"];
  if (draft.topicId !== plan.topicId) errors.push("candidate belongs to another Topic");
  if (draft.status !== "pending_review" || draft.publishedQuestionId) errors.push("candidate is not an unpublished pending draft");
  if (draft.groundingSourceFingerprint !== plan.gate.provenance.groundingSourceFingerprint || draft.groundingAssignmentFingerprint !== plan.gate.provenance.groundingAssignmentFingerprint) errors.push("candidate provenance is not the Topic's current provenance");
  const structural = validateQuestionDraft(draft, { topicExists: true, topicIsPlaceholder: false, requireReviewedContent: true });
  if (!structural.valid) errors.push(`structurally invalid: ${structural.errors.join("; ")}`);
  const arithmetic = checkArithmeticConsistency(draft);
  if (arithmetic.status === "INVALID") errors.push(`arithmetic INVALID: ${arithmetic.findings.map((f) => f.code).join(",")}`);
  if (plan.others.some((o) => norm(o.promptEn) === norm(draft.promptEn))) errors.push("candidate duplicates an active Question");
  const grounding = checkGroundingConsistency([...plan.others, draft].flatMap(poolTexts), plan.gate.slice, { wordForms: true });
  if (grounding.length) errors.push(`final pool grounding: ${grounding.join("; ")}`);
  return errors;
}

/**
 * The atomic 8 -> 8 swap. `installDraft` publishes the draft inside `tx`
 * (QuestionPublishService.installAutoQuestionDraft in production).
 */
export async function atomicReplace(
  prisma: { $transaction: (fn: (tx: any) => Promise<any>, opts: any) => Promise<any> },
  plan: ReplacementPlan,
  draftId: string,
  installDraft: (tx: any, draft: any) => Promise<{ id: string }>,
  isolationLevel: unknown,
) {
  const expected = { sourceFingerprint: plan.gate.provenance.groundingSourceFingerprint, assignmentFingerprint: plan.gate.provenance.groundingAssignmentFingerprint };
  return prisma.$transaction(
    async (tx: any) => {
      const before = await tx.topic.findUnique({ where: { id: plan.topicId }, select: TOPIC_STATE_SELECT });
      const pre = checkReplaceable(before, plan.questionId, expected);
      const draft = await tx.questionDraft.findUnique({ where: { id: draftId } });
      const draftErrors = validateCandidate(draft, { ...plan, others: pre.active.filter((q: any) => q.id !== plan.questionId) });
      if (draftErrors.length) throw new ReplacementError("CANDIDATE", draftErrors.join(" | "));
      const modeBefore = before.unit.contentProvenanceEnforcedAt;

      const replacement = await installDraft(tx, draft);
      const retiredAt = new Date();
      const retired = await tx.question.updateMany({
        where: { id: plan.questionId, topicId: plan.topicId, retiredAt: null },
        data: { retiredAt, retiredReason: RETIRED_REASON, replacedByQuestionId: replacement.id },
      });
      if (retired.count !== 1) throw new ReplacementError("SWAP", `${plan.questionId} changed concurrently`);

      // Post-condition BEFORE commit, on the transaction's own view.
      const after = await tx.topic.findUnique({ where: { id: plan.topicId }, select: TOPIC_STATE_SELECT });
      const gate = evaluateTopicGroundingGate(after);
      if (gate.state !== "READY" || gate.provenance.groundingSourceFingerprint !== expected.sourceFingerprint || gate.provenance.groundingAssignmentFingerprint !== expected.assignmentFingerprint) throw new ReplacementError("POSTCONDITION", "Topic gate changed");
      if (String(after.unit.contentProvenanceEnforcedAt) !== String(modeBefore)) throw new ReplacementError("POSTCONDITION", "Unit enforcement mode changed");
      const servable = questionServabilityByTopic([after], after.questions);
      const active = after.questions.filter((q: any) => isActiveCurrentQuestion(q, gate.provenance) && servable(q));
      const servedAll = after.questions.filter((q: any) => servable(q));
      const oldRow = after.questions.find((q: any) => q.id === plan.questionId);
      const problems: string[] = [];
      if (active.length !== REPLACEMENT_POOL_TARGET) problems.push(`active CURRENT servable pool would be ${active.length}`);
      if (servedAll.length !== active.length) problems.push("non-CURRENT Question would be servable");
      if (active.some((q: any) => q.id === plan.questionId) || servable(oldRow) || !isRetired(oldRow)) problems.push("old Question would remain servable");
      if (!active.some((q: any) => q.id === replacement.id)) problems.push("replacement would not be servable");
      if (new Set(active.map((q: any) => norm(q.promptEn))).size !== active.length) problems.push("duplicate prompts in the pool");
      const grounding = checkGroundingConsistency(active.flatMap(poolTexts), gate.slice, { wordForms: true });
      if (grounding.length) problems.push(`pool grounding: ${grounding.join("; ")}`);
      const newRow = active.find((q: any) => q.id === replacement.id);
      if (newRow && checkArithmeticConsistency(newRow).status === "INVALID") problems.push("replacement arithmetic INVALID");
      if (problems.length) throw new ReplacementError("POSTCONDITION", problems.join(" | "));
      return { oldQuestionId: plan.questionId, replacementQuestionId: replacement.id, retiredAt, activeBefore: pre.active.map((q: any) => q.id).sort(), activeAfter: active.map((q: any) => q.id).sort() };
    },
    { isolationLevel, maxWait: 10000, timeout: 30000 },
  );
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

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn", "log"] });
  const report: any[] = [];
  try {
    const prisma = app.get(PrismaService).client;
    const generator = app.get(QuestionDraftGeneratorService);
    const loadTopicOf = async (questionId: string) => {
      const q = await prisma.question.findUnique({ where: { id: questionId }, select: { topicId: true } });
      if (!q) throw new ReplacementError("PRECONDITION", `${questionId} not found`);
      return prisma.topic.findUnique({ where: { id: q.topicId }, select: TOPIC_STATE_SELECT });
    };
    for (const questionId of args.questionIds) {
      const plan = planReplacement(await loadTopicOf(questionId), questionId);
      const entry: any = { questionId, topicId: plan.topicId, unitId: plan.unitId, unitMode: plan.unitMode, others: plan.others.length };
      if (!args.apply) { report.push({ ...entry, status: "PLANNED" }); continue; }
      const { drafts } = await generator.generateAutoQuestionBatch(plan.topicId, 1, CONTENT_AUTHORING_ACTOR_ID, { gate: plan.gate, acceptedPool: plan.others });
      if (drafts.length !== 1) throw new ReplacementError("STAGE", `${questionId}: expected exactly 1 staged candidate, got ${drafts.length}`);
      entry.candidateDraftId = drafts[0].id;
      const candidate = await prisma.questionDraft.findUnique({ where: { id: drafts[0].id } });
      const errors = validateCandidate(candidate, plan);
      if (errors.length) throw Object.assign(new ReplacementError("CANDIDATE", errors.join(" | ")), { entry });
      const swap = await atomicReplace(prisma as any, plan, drafts[0].id, installAutoQuestionDraft as any, Prisma.TransactionIsolationLevel.Serializable);
      // Fresh read OUTSIDE the transaction: the committed state.
      const committed = await loadTopicOf(questionId);
      const gate = evaluateTopicGroundingGate(committed as any) as ReadyGate;
      const servable = questionServabilityByTopic([committed as any], (committed as any).questions);
      const active = (committed as any).questions.filter((q: any) => isActiveCurrentQuestion(q, gate.provenance) && servable(q)).map((q: any) => q.id);
      report.push({ ...entry, status: "REPLACED", ...swap, committedActive: active.length, oldServable: servable((committed as any).questions.find((q: any) => q.id === questionId)) });
    }
    console.log(JSON.stringify({ mode: args.apply ? "APPLY" : "DRY_RUN", report }, null, 2));
  } catch (err) {
    console.log(JSON.stringify({ mode: args.apply ? "APPLY" : "DRY_RUN", report, failed: { error: err instanceof Error ? err.message : String(err), entry: (err as any)?.entry } }, null, 2));
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => { console.error("REPLACEMENT FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
}

/**
 * ADMIN: content-only staged LEGACY -> CURRENT install (2026-10-04). See
 * ai/context/staged-content-install.ts for the invariants.
 *
 * For a Topic whose assignment is READY/current/non-empty and which has no
 * CURRENT content yet, prepare one CURRENT lesson + exactly 8 CURRENT
 * Questions off the serving path and install them in ONE serializable
 * transaction. The TopicGroundingAssignment is never written.
 *
 * Modes (explicit --topicIds, at most MAX_TOPICS_PER_RUN, stop at the first failure):
 *   DRY RUN (default)  plan only — zero provider calls, zero writes.
 *   --stage            provider generation into pending_review drafts only (normal budget
 *                      accounting); prints the full staged content for review and the staged
 *                      identity. Never installs anything.
 *   --restage-questions=<spec> [--stage]
 *                      SURGICAL re-stage of an earlier staged set: keep its LessonDraft and the listed good
 *                      QuestionDrafts, reject the listed bad ones, generate only the missing count (kept drafts
 *                      are the accepted pool), validate the final 8 and print a NEW identity + commit spec.
 *                      <spec> per Topic: <topicId>:<lessonDraftId>:<keepId>|...:<rejectId>|...:<previousIdentity>
 *                      (keep + reject = the full original 8; the previous identity must still recompute).
 *                      Without --stage: preflight only (zero writes, zero provider calls).
 *   --commit=<spec>    installs previously staged, reviewed content. <spec> per Topic:
 *                      <topicId>:<lessonDraftId>:<questionDraftId>|...|<questionDraftId>:<identity>
 *                      (several specs separated by ","). No provider call.
 * Staging and committing are always separate invocations: unseen content is never installed.
 *
 * Usage:
 *   node dist/scripts/stage-topic-content.js --topicIds=<id>[,<id>] [--stage]
 *   node dist/scripts/stage-topic-content.js --commit=<spec>[,<spec>]
 */
import { CONTENT_TOPIC_SELECT, installStagedContent, planContentStaging, planSurgicalRestage, stageContent, stagedIdentity, surgicalRestage, validateStagedContent, verifyInstalled, type ContentInstallers, type ContentPlan, type SurgicalSpec } from "../ai/context/staged-content-install";
import { STAGED_POOL_TARGET, StagedRepairError, type StageDeps } from "../ai/context/staged-assignment-repair";
import { checkArithmeticConsistency } from "../question-bank/question-draft-generator/arithmetic-consistency";

export const MAX_TOPICS_PER_RUN = 10;
const ID = /^[a-z0-9]{20,40}$/;
const HASH = /^[0-9a-f]{64}$/;

export interface CommitSpec { topicId: string; lessonDraftId: string; questionDraftIds: string[]; identity: string }
export type ContentArgs =
  | { mode: "DRY_RUN" | "STAGE"; topicIds: string[] }
  | { mode: "COMMIT"; commits: CommitSpec[] }
  | { mode: "RESTAGE_DRY_RUN" | "RESTAGE"; restages: SurgicalSpec[] };

export function parseArgs(argv: string[]): ContentArgs {
  for (const a of argv) if (!/^--(topicIds|commit|restage-questions)=.+$/.test(a) && a !== "--stage") throw new Error(`unexpected argument: ${a}`);
  const lists = argv.filter((a) => a.startsWith("--topicIds=")), commits = argv.filter((a) => a.startsWith("--commit="));
  const restages = argv.filter((a) => a.startsWith("--restage-questions="));
  if (restages.length > 1) throw new Error("--restage-questions given more than once");
  if (restages.length) {
    if (lists.length || commits.length) throw new Error("--restage-questions is exclusive with --topicIds and --commit");
    if (argv.filter((a) => a === "--stage").length > 1) throw new Error("--stage given more than once");
    const specs = restages[0].slice("--restage-questions=".length).split(",").map((raw) => {
      const parts = raw.split(":");
      if (parts.length !== 5) throw new Error(`malformed --restage-questions spec: ${raw}`);
      const [topicId, lessonDraftId, keepRaw, rejectRaw, previousIdentity] = parts;
      const keepQuestionDraftIds = keepRaw.split("|"), rejectQuestionDraftIds = rejectRaw.split("|");
      if (!ID.test(topicId) || !ID.test(lessonDraftId) || [...keepQuestionDraftIds, ...rejectQuestionDraftIds].some((q) => !ID.test(q)) || !HASH.test(previousIdentity)) throw new Error(`malformed --restage-questions spec: ${raw}`);
      if (keepQuestionDraftIds.some((id) => rejectQuestionDraftIds.includes(id))) throw new Error(`--restage-questions spec for ${topicId} lists a draft both to keep and to reject`);
      if (new Set([...keepQuestionDraftIds, ...rejectQuestionDraftIds]).size !== keepQuestionDraftIds.length + rejectQuestionDraftIds.length) throw new Error(`--restage-questions spec for ${topicId} has duplicate draft ids`);
      if (keepQuestionDraftIds.length + rejectQuestionDraftIds.length !== STAGED_POOL_TARGET) throw new Error(`--restage-questions spec for ${topicId}: keep + reject must be the full original ${STAGED_POOL_TARGET}`);
      return { topicId, lessonDraftId, keepQuestionDraftIds, rejectQuestionDraftIds, previousIdentity };
    });
    if (new Set(specs.map((x) => x.topicId)).size !== specs.length) throw new Error("duplicate Topic in --restage-questions");
    if (specs.length > MAX_TOPICS_PER_RUN) throw new Error(`at most ${MAX_TOPICS_PER_RUN} Topics per run`);
    return { mode: argv.includes("--stage") ? "RESTAGE" : "RESTAGE_DRY_RUN", restages: specs };
  }
  if (argv.filter((a) => a === "--stage").length > 1) throw new Error("--stage given more than once");
  if (commits.length > 1) throw new Error("--commit given more than once");
  if (commits.length) {
    if (lists.length || argv.includes("--stage")) throw new Error("--commit is exclusive: stage and commit are separate invocations");
    const specs = commits[0].slice("--commit=".length).split(",").map((raw) => {
      const parts = raw.split(":");
      if (parts.length !== 4) throw new Error(`malformed --commit spec: ${raw}`);
      const [topicId, lessonDraftId, qs, identity] = parts;
      const questionDraftIds = qs.split("|");
      if (!ID.test(topicId) || !ID.test(lessonDraftId) || questionDraftIds.some((q) => !ID.test(q)) || !HASH.test(identity)) throw new Error(`malformed --commit spec: ${raw}`);
      if (questionDraftIds.length !== STAGED_POOL_TARGET || new Set(questionDraftIds).size !== questionDraftIds.length) throw new Error(`--commit spec for ${topicId} must name exactly ${STAGED_POOL_TARGET} distinct QuestionDrafts`);
      return { topicId, lessonDraftId, questionDraftIds, identity };
    });
    if (new Set(specs.map((s) => s.topicId)).size !== specs.length) throw new Error("duplicate Topic in --commit");
    if (specs.length > MAX_TOPICS_PER_RUN) throw new Error(`at most ${MAX_TOPICS_PER_RUN} Topics per run`);
    return { mode: "COMMIT", commits: specs };
  }
  if (lists.length !== 1) throw new Error("--topicIds must be given exactly once");
  const topicIds = lists[0].slice("--topicIds=".length).split(",");
  if (topicIds.some((x) => !ID.test(x))) throw new Error("malformed --topicIds entry");
  if (new Set(topicIds).size !== topicIds.length) throw new Error("duplicate --topicIds entry");
  if (topicIds.length > MAX_TOPICS_PER_RUN) throw new Error(`at most ${MAX_TOPICS_PER_RUN} Topics per run`);
  return { mode: argv.includes("--stage") ? "STAGE" : "DRY_RUN", topicIds };
}

export interface ContentDeps extends StageDeps {
  loadTopic(topicId: string): Promise<any>;
  /** Surgical re-stage only. */
  loadPendingLessonDraftIds?(unitId: string): Promise<string[]>;
  countActivity?(topicId: string): Promise<number>;
  rejectQuestionDraft?(id: string, reason: string): Promise<unknown>;
  loadLessonDraft(id: string): Promise<any>;
  loadPendingQuestionDrafts(topicId: string): Promise<any[]>;
  transaction: { $transaction: (fn: (tx: any) => Promise<any>, opts?: any) => Promise<any> };
  installers: ContentInstallers;
}

const describePlan = (p: ContentPlan) => ({
  topicId: p.topicId, unitId: p.unitId, unitMode: p.unitMode,
  assignment: { ...p.assignment, rowHash: p.assignmentHash, fingerprint: p.gate.provenance.groundingAssignmentFingerprint },
  slice: { concepts: p.gate.slice.concepts.length, facts: p.gate.slice.facts.length, vocabulary: p.gate.slice.vocabulary.length },
  liveContent: p.content,
});

/** The full human-reviewable report of a staged set (shared by --stage and --restage-questions --stage). */
async function reviewStaged(plan: ContentPlan, topicId: string, staged: { lessonDraftId: string; questionDraftIds: string[]; questionBatches: number; batchErrors: string[] }, deps: ContentDeps) {
  const lessonDraft = await deps.loadLessonDraft(staged.lessonDraftId);
  const questionDrafts = await deps.loadQuestionDrafts(staged.questionDraftIds);
  const errors = validateStagedContent(plan, lessonDraft, questionDrafts);
  const identity = stagedIdentity(plan, lessonDraft, questionDrafts);
  return {
    errors,
    report: {
      lessonDraftId: staged.lessonDraftId, questionDraftIds: staged.questionDraftIds, questionBatches: staged.questionBatches, batchErrors: staged.batchErrors,
      provenance: plan.gate.provenance,
      lesson: { steps: (lessonDraft.teachingStepsJson ?? []).map((x: any) => ({ type: x.type, objective: x.objective })), learningObjectives: lessonDraft.learningObjectivesJson },
      questions: questionDrafts.map((d: any) => ({ id: d.id, type: d.type, difficulty: d.difficulty, promptEn: d.promptEn, optionsJson: d.optionsJson, correctAnswerJson: d.correctAnswerJson, explanationEn: d.explanationEn, arithmetic: checkArithmeticConsistency(d) })),
      validation: errors.length ? { ok: false, errors } : { ok: true, checks: "structure, answer/options, duplicates, lesson grounding+verbatim, final-pool grounding (prompt+explanation, wordForms)+verbatim, arithmetic V1.1 INVALID=0, provenance" },
      identity,
      commitSpec: `${topicId}:${staged.lessonDraftId}:${staged.questionDraftIds.join("|")}:${identity}`,
    },
  };
}

async function runSurgical(args: Extract<ContentArgs, { mode: "RESTAGE_DRY_RUN" | "RESTAGE" }>, deps: ContentDeps) {
  const results: any[] = [];
  for (const spec of args.restages) {
    const result: any = { topicId: spec.topicId, keep: spec.keepQuestionDraftIds, reject: spec.rejectQuestionDraftIds, previousIdentity: spec.previousIdentity };
    results.push(result);
    let rejectionStarted = false;
    try {
      if (!deps.loadPendingLessonDraftIds || !deps.countActivity || !deps.rejectQuestionDraft) throw new StagedRepairError("DEPS", "surgical re-stage dependencies missing");
      const topic = await deps.loadTopic(spec.topicId);
      if (!topic) throw new StagedRepairError("NOT_FOUND", `Topic ${spec.topicId} not found`);
      const { plan, objectivesEn } = planSurgicalRestage(topic, spec, {
        lessonDraft: await deps.loadLessonDraft(spec.lessonDraftId),
        drafts: await deps.loadQuestionDrafts([...spec.keepQuestionDraftIds, ...spec.rejectQuestionDraftIds]),
        pendingQuestionDraftIds: (await deps.loadPendingQuestionDrafts(spec.topicId)).map((d: any) => d.id),
        pendingLessonDraftIds: await deps.loadPendingLessonDraftIds(topic.unit.id),
        activity: await deps.countActivity(spec.topicId),
      });
      Object.assign(result, describePlan(plan), { replacementsToGenerate: spec.rejectQuestionDraftIds.length, lessonProviderCalls: 0 });
      if (args.mode === "RESTAGE_DRY_RUN") { result.status = "PLANNED"; continue; }
      rejectionStarted = true;
      const staged = await surgicalRestage(plan, spec, objectivesEn, deps as any);
      const { errors, report } = await reviewStaged(plan, spec.topicId, staged, deps);
      result.staged = report;
      if (errors.length) throw new StagedRepairError("STAGED_INVALID", `${spec.topicId}: re-staged set invalid — not committable`, errors);
      result.status = "STAGED";
    } catch (err) {
      result.status = "FAILED";
      result.error = err instanceof StagedRepairError ? { code: err.code, message: err.message, detail: err.detail } : { code: "EXCEPTION", message: err instanceof Error ? err.message : String(err) };
      if (rejectionStarted) result.draftState = { rejected: spec.rejectQuestionDraftIds, keptPending: spec.keepQuestionDraftIds, lessonPending: spec.lessonDraftId, note: "serving content untouched; rejected drafts stay rejected (audit history); any newly generated drafts stay pending_review and non-servable" };
      return { mode: args.mode, results, stoppedOnFailure: true };
    }
  }
  return { mode: args.mode, results, stoppedOnFailure: false };
}

export async function runContentStaging(args: ContentArgs, deps: ContentDeps) {
  if (args.mode === "RESTAGE" || args.mode === "RESTAGE_DRY_RUN") return runSurgical(args, deps);
  const results: any[] = [];
  const items = args.mode === "COMMIT" ? args.commits.map((c) => ({ topicId: c.topicId, commit: c })) : (args as Extract<ContentArgs, { mode: "DRY_RUN" | "STAGE" }>).topicIds.map((topicId) => ({ topicId, commit: null as CommitSpec | null }));
  for (const { topicId, commit } of items) {
    const result: any = { topicId };
    results.push(result);
    try {
      const plan = planContentStaging(await deps.loadTopic(topicId));
      Object.assign(result, describePlan(plan));
      if (args.mode !== "COMMIT") {
        const pending = await deps.loadPendingQuestionDrafts(topicId);
        if (pending.length) throw new StagedRepairError("STAGED_LEFTOVERS_PRESENT", `${topicId}: ${pending.length} pending staged QuestionDrafts already exist (review/commit them, nothing is reused or deleted)`, pending.map((d) => d.id));
        if (args.mode === "DRY_RUN") { result.status = "PLANNED"; continue; }
        const staged = await stageContent(plan, deps);
        const { errors, report } = await reviewStaged(plan, topicId, staged, deps);
        result.staged = report;
        if (errors.length) throw new StagedRepairError("STAGED_INVALID", `${topicId}: staged content invalid — not committable`, errors);
        result.status = "STAGED";
        continue;
      }
      // The staged identity covers the stage-time assignment row hash, gate provenance, Unit grounding identity and
      // live-lesson baseline, so any of those changing since --stage (or any draft edit) refuses here; the same
      // checks are repeated inside the serializable transaction against this plan.
      result.install = await installStagedContent(deps.transaction as any, plan, { lessonDraftId: commit!.lessonDraftId, questionDraftIds: commit!.questionDraftIds, identity: commit!.identity }, deps.installers);
      const committed = await deps.loadTopic(topicId);
      const post = verifyInstalled(committed, plan, result.install.questionIds);
      if (post.length) throw new StagedRepairError("POST_COMMIT_VERIFY", `${topicId}: committed state failed verification`, post);
      result.status = "COMMITTED";
    } catch (err) {
      result.status = "FAILED";
      result.error = err instanceof StagedRepairError ? { code: err.code, message: err.message, detail: err.detail } : { code: "EXCEPTION", message: err instanceof Error ? err.message : String(err) };
      return { mode: args.mode, results, stoppedOnFailure: true };
    }
  }
  return { mode: args.mode, results, stoppedOnFailure: false };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await import("reflect-metadata");
  await import("dotenv/config");
  const { NestFactory } = await import("@nestjs/core");
  const { AppModule } = await import("../app.module");
  const { PrismaService } = await import("../prisma/prisma.service");
  const { LessonDraftGeneratorService } = await import("../interactive-lesson/lesson-draft-generator/lesson-draft-generator.service");
  const { QuestionDraftGeneratorService } = await import("../question-bank/question-draft-generator/question-draft-generator.service");
  const { installAutoDraftIntoTopic } = await import("../interactive-lesson/lesson-draft-generator/lesson-publish.service");
  const { installAutoQuestionDraft, QuestionPublishService } = await import("../question-bank/question-draft-generator/question-publish.service");
  const { CONTENT_AUTHORING_ACTOR_ID } = await import("../ai/content-authoring-actor.const");
  const { parseBilingualObjectives } = await import("../interactive-lesson/lesson-draft-generator/lesson-objectives.util");

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn", "log"] });
  try {
    const prisma = app.get(PrismaService).client;
    const lessonGen = app.get(LessonDraftGeneratorService);
    const questionGen = app.get(QuestionDraftGeneratorService);
    const questionPublisher = app.get(QuestionPublishService);
    const out = await runContentStaging(args, {
      loadTopic: (id) => prisma.topic.findUnique({ where: { id }, select: CONTENT_TOPIC_SELECT }),
      loadLessonDraft: (id) => prisma.lessonDraft.findUnique({ where: { id } }),
      loadQuestionDrafts: (ids) => prisma.questionDraft.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } }),
      loadPendingQuestionDrafts: (topicId) => prisma.questionDraft.findMany({ where: { topicId, status: "pending_review", publishedQuestionId: null }, select: { id: true } }),
      generateLesson: async (topicId, gate) => {
        const t = await prisma.topic.findUniqueOrThrow({ where: { id: topicId }, select: { id: true, nameEn: true, nameAr: true, unitId: true } });
        const r = await lessonGen.generateAutoDraft(t, { preferredLang: "en", studentAgeRange: "6-12" }, CONTENT_AUTHORING_ACTOR_ID, { gate });
        return { draftId: r.draft.id, objectivesEn: parseBilingualObjectives(r.draft.learningObjectivesJson).map((o) => o.objectiveEn), metadata: { generationSource: r.generationSource, groundingVersionUsed: r.groundingVersionUsed, generationPromptVersion: r.generationPromptVersion, provenance: r.provenance } };
      },
      generateQuestions: async (topicId, count, gate, lessonObjectives, acceptedPool) =>
        (await questionGen.generateAutoQuestionBatch(topicId, count, CONTENT_AUTHORING_ACTOR_ID, { gate, lessonObjectives, acceptedPool })).drafts.map((d: any) => d.id),
      loadPendingLessonDraftIds: async (unitId) => (await prisma.lessonDraft.findMany({ where: { targetUnitId: unitId, status: "pending_review", publishedTopicId: null }, select: { id: true } })).map((d) => d.id),
      countActivity: async (topicId) => {
        const t = await prisma.topic.findUniqueOrThrow({ where: { id: topicId }, select: { _count: { select: { lessonSessions: true, quizResults: true } }, lessons: { select: { _count: { select: { progress: true } } } }, questions: { select: { _count: { select: { attempts: true } } } } } });
        return t._count.lessonSessions + t._count.quizResults + t.lessons.reduce((acc, l) => acc + l._count.progress, 0) + t.questions.reduce((acc, q) => acc + q._count.attempts, 0);
      },
      rejectQuestionDraft: (id, reason) => questionPublisher.reject(id, undefined, reason),
      transaction: prisma as any,
      installers: {
        installLesson: (tx, draft, topicId, objectives, metadata) => installAutoDraftIntoTopic(tx, draft, topicId, objectives, metadata),
        installQuestion: (tx, draft) => installAutoQuestionDraft(tx, draft),
      },
    });
    console.log(JSON.stringify(out, null, 2));
    if (out.stoppedOnFailure) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((err) => {
      console.error("CONTENT STAGING FAILED:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}

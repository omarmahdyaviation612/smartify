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
 *   --commit=<spec>    installs previously staged, reviewed content. <spec> per Topic:
 *                      <topicId>:<lessonDraftId>:<questionDraftId>|...|<questionDraftId>:<identity>
 *                      (several specs separated by ","). No provider call.
 * Staging and committing are always separate invocations: unseen content is never installed.
 *
 * Usage:
 *   node dist/scripts/stage-topic-content.js --topicIds=<id>[,<id>] [--stage]
 *   node dist/scripts/stage-topic-content.js --commit=<spec>[,<spec>]
 */
import { CONTENT_TOPIC_SELECT, installStagedContent, planContentStaging, stageContent, stagedIdentity, validateStagedContent, verifyInstalled, type ContentInstallers, type ContentPlan } from "../ai/context/staged-content-install";
import { STAGED_POOL_TARGET, StagedRepairError, type StageDeps } from "../ai/context/staged-assignment-repair";
import { checkArithmeticConsistency } from "../question-bank/question-draft-generator/arithmetic-consistency";

export const MAX_TOPICS_PER_RUN = 10;
const ID = /^[a-z0-9]{20,40}$/;
const HASH = /^[0-9a-f]{64}$/;

export interface CommitSpec { topicId: string; lessonDraftId: string; questionDraftIds: string[]; identity: string }
export type ContentArgs = { mode: "DRY_RUN" | "STAGE"; topicIds: string[] } | { mode: "COMMIT"; commits: CommitSpec[] };

export function parseArgs(argv: string[]): ContentArgs {
  for (const a of argv) if (!/^--(topicIds|commit)=.+$/.test(a) && a !== "--stage") throw new Error(`unexpected argument: ${a}`);
  const lists = argv.filter((a) => a.startsWith("--topicIds=")), commits = argv.filter((a) => a.startsWith("--commit="));
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

export async function runContentStaging(args: ContentArgs, deps: ContentDeps) {
  const results: any[] = [];
  const items = args.mode === "COMMIT" ? args.commits.map((c) => ({ topicId: c.topicId, commit: c })) : args.topicIds.map((topicId) => ({ topicId, commit: null as CommitSpec | null }));
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
        const lessonDraft = await deps.loadLessonDraft(staged.lessonDraftId);
        const questionDrafts = await deps.loadQuestionDrafts(staged.questionDraftIds);
        const errors = validateStagedContent(plan, lessonDraft, questionDrafts);
        const identity = stagedIdentity(plan, lessonDraft, questionDrafts);
        result.staged = {
          lessonDraftId: staged.lessonDraftId, questionDraftIds: staged.questionDraftIds, questionBatches: staged.questionBatches, batchErrors: staged.batchErrors,
          provenance: plan.gate.provenance,
          lesson: { steps: (lessonDraft.teachingStepsJson ?? []).map((s: any) => ({ type: s.type, objective: s.objective })), learningObjectives: lessonDraft.learningObjectivesJson },
          questions: questionDrafts.map((d: any) => ({ id: d.id, type: d.type, difficulty: d.difficulty, promptEn: d.promptEn, optionsJson: d.optionsJson, correctAnswerJson: d.correctAnswerJson, explanationEn: d.explanationEn, arithmetic: checkArithmeticConsistency(d) })),
          validation: errors.length ? { ok: false, errors } : { ok: true, checks: "structure, answer/options, duplicates, lesson grounding+verbatim, final-pool grounding (prompt+explanation, wordForms)+verbatim, arithmetic V1.1 INVALID=0, provenance" },
          identity,
          commitSpec: `${topicId}:${staged.lessonDraftId}:${staged.questionDraftIds.join("|")}:${identity}`,
        };
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
  const { installAutoQuestionDraft } = await import("../question-bank/question-draft-generator/question-publish.service");
  const { CONTENT_AUTHORING_ACTOR_ID } = await import("../ai/content-authoring-actor.const");
  const { parseBilingualObjectives } = await import("../interactive-lesson/lesson-draft-generator/lesson-objectives.util");

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn", "log"] });
  try {
    const prisma = app.get(PrismaService).client;
    const lessonGen = app.get(LessonDraftGeneratorService);
    const questionGen = app.get(QuestionDraftGeneratorService);
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

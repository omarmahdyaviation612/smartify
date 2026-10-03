/**
 * Controlled, explicit-allowlist ADMIN regeneration of a Topic's downstream
 * content (teachingSteps + Question pool) from its CURRENT grounding.
 *
 * Rewritten 2026-10-03 (Wave B runtime safety + provenance). Student runtime
 * now refuses BLOCKED/stale Topics and never regenerates existing content on
 * its own; this script is the deliberate path that REPLACES legacy content:
 *
 *   - Every Topic must be READY_CURRENT_NON_EMPTY (the same gate student
 *     runtime uses — topic-content-provenance.util.ts). A non-READY Topic is
 *     refused with zero provider calls; this script never weakens that gate.
 *   - teachingSteps are regenerated unless they are already CURRENT, through
 *     the normal generateAutoDraft -> autoPublishIntoTopic pipeline, which
 *     stamps the new steps with their grounding provenance (the old ones are
 *     replaced in place — the same mechanism the old version of this script
 *     used).
 *   - The Question pool is completed to POOL_TARGET CURRENT Questions:
 *     only CURRENT Questions are counted, each batch requests (and the
 *     generator persists) at most the missing number, and the count is
 *     re-read from the database after every batch, for at most
 *     MAX_QUESTION_BATCHES_PER_TOPIC batches. LEGACY Questions are never
 *     copied, restamped or deleted; a Topic with any CURRENT Question no
 *     longer serves its LEGACY ones (topic-content-provenance.util.ts).
 *     Each batch's pool-level grounding check judges the FINAL pool — the
 *     Topic's already-accepted CURRENT Questions plus the new batch — so a
 *     one-Question completion is not judged in isolation (2026-10-03).
 *   - A Topic is COMPLETED only when, re-read after all writes, its steps are
 *     CURRENT and it holds >= POOL_TARGET CURRENT Questions; otherwise it is
 *     INCOMPLETE and the run stops there (exit code 1).
 *   - DRY RUN (default) only reports the per-Topic plan. --apply is required
 *     to call any provider or write anything. Stops at the first failure.
 *   - Explicit --topicIds only, at most MAX_TOPICS_PER_RUN per invocation —
 *     never a whole Unit/Subject sweep.
 *
 * KNOWN LIMITATION (unchanged): autoPublishIntoTopic deletes the Topic's
 * previous AI Lesson row; real StudentProgress rows against it make that fail
 * on the foreign key rather than silently discarding progress.
 *
 * Usage (via the root `content:regenerate` script — see root package.json):
 *   pnpm content:regenerate --topicIds=<id>[,<id>] [--apply] [--lesson-only | --questions-only]
 */
import { classifyContentProvenance, evaluateTopicGroundingGate, topicStepsProvenance, type ContentProvenanceState, type GateTopic, type StoredProvenance, type TopicStepsProvenanceFields } from "../ai/context/topic-content-provenance.util";

export const MAX_TOPICS_PER_RUN = 25;
export const POOL_TARGET = 8;
// Same bound as the generators' own MAX_ATTEMPTS (2): one batch plus one
// completion batch per Topic. Each batch itself retries at most once inside
// generateAutoQuestionBatch, so a Topic costs at most 4 Question provider calls.
export const MAX_QUESTION_BATCHES_PER_TOPIC = 2;
const ID = /^[a-z0-9]{20,40}$/;

export interface RegenerationArgs { topicIds: string[]; apply: boolean; lesson: boolean; questions: boolean }

export function parseArgs(argv: string[]): RegenerationArgs {
  const flags = ["--apply", "--lesson-only", "--questions-only"];
  for (const a of argv) if (!/^--topicIds=.+$/.test(a) && !flags.includes(a)) throw new Error(`unexpected argument: ${a}`);
  for (const f of flags) if (argv.filter((a) => a === f).length > 1) throw new Error(`${f} given more than once`);
  const lists = argv.filter((a) => a.startsWith("--topicIds="));
  if (lists.length !== 1) throw new Error("--topicIds must be given exactly once");
  const topicIds = lists[0].slice("--topicIds=".length).split(",");
  if (topicIds.some((x) => !ID.test(x))) throw new Error("malformed --topicIds entry");
  if (new Set(topicIds).size !== topicIds.length) throw new Error("duplicate --topicIds entry");
  if (topicIds.length > MAX_TOPICS_PER_RUN) throw new Error(`at most ${MAX_TOPICS_PER_RUN} Topics per run`);
  const lessonOnly = argv.includes("--lesson-only"), questionsOnly = argv.includes("--questions-only");
  if (lessonOnly && questionsOnly) throw new Error("--lesson-only and --questions-only are mutually exclusive");
  return { topicIds, apply: argv.includes("--apply"), lesson: !questionsOnly, questions: !lessonOnly };
}

export type RegenerationTopic = GateTopic & TopicStepsProvenanceFields & {
  id: string;
  nameEn: string;
  nameAr: string;
  unitId: string;
  teachingStepsJson: unknown;
  questions: Array<StoredProvenance & { isPlaceholder?: boolean }>;
};

export interface TopicPlan {
  topicId: string;
  gate: string;
  steps: "NONE" | ContentProvenanceState;
  questions: Record<ContentProvenanceState, number>;
  lessonAction: "REGENERATE" | "SKIP_CURRENT" | "SKIP_NOT_REQUESTED" | "REFUSE";
  questionsToGenerate: number;
}

/** Pure: what --apply WOULD do for one Topic, decided only from the gate and stored provenance. */
export function planTopic(topic: RegenerationTopic, args: Pick<RegenerationArgs, "lesson" | "questions">): TopicPlan {
  const gate = evaluateTopicGroundingGate(topic);
  const questions: Record<ContentProvenanceState, number> = { CURRENT: 0, LEGACY: 0, MISMATCH: 0 };
  if (gate.state !== "READY") {
    return { topicId: topic.id, gate: `UNAVAILABLE:${gate.reason}`, steps: topic.teachingStepsJson ? "LEGACY" : "NONE", questions, lessonAction: "REFUSE", questionsToGenerate: 0 };
  }
  for (const q of topic.questions.filter((x) => !x.isPlaceholder)) questions[classifyContentProvenance(q, gate.provenance)]++;
  const steps = topic.teachingStepsJson ? classifyContentProvenance(topicStepsProvenance(topic), gate.provenance) : "NONE";
  const lessonAction = !args.lesson ? "SKIP_NOT_REQUESTED" : steps === "CURRENT" ? "SKIP_CURRENT" : "REGENERATE";
  return { topicId: topic.id, gate: "READY", steps, questions, lessonAction, questionsToGenerate: args.questions ? Math.max(0, POOL_TARGET - questions.CURRENT) : 0 };
}

export interface RegenerationDeps {
  loadTopic(topicId: string): Promise<RegenerationTopic | null>;
  regenerateLesson(topic: RegenerationTopic): Promise<void>;
  generateQuestions(topicId: string, count: number): Promise<number>;
}

type TopicResult = TopicPlan & {
  status: "PLANNED" | "COMPLETED" | "INCOMPLETE";
  lessonRegenerated?: boolean;
  questionBatches?: number;
  questionsPublished?: number;
  batchErrors?: string[];
  final?: { steps: TopicPlan["steps"]; currentQuestions: number; gate: string };
};

async function reload(deps: RegenerationDeps, id: string): Promise<RegenerationTopic> {
  const topic = await deps.loadTopic(id);
  if (!topic) throw new Error(`Topic ${id} not found`);
  return topic;
}

export async function runRegeneration(
  args: RegenerationArgs,
  deps: RegenerationDeps,
): Promise<{ mode: "APPLY" | "DRY_RUN"; results: TopicResult[]; stoppedOnFailure: boolean }> {
  const results: TopicResult[] = [];
  for (const id of args.topicIds) {
    const topic = await reload(deps, id);
    const plan = planTopic(topic, args);
    if (plan.lessonAction === "REFUSE") throw new Error(`Topic ${id} is not READY_CURRENT_NON_EMPTY (${plan.gate}); nothing generated`);
    if (!args.apply) {
      results.push({ ...plan, status: "PLANNED" });
      continue;
    }
    const result: TopicResult = { ...plan, status: "INCOMPLETE", questionBatches: 0, questionsPublished: 0 };
    if (plan.lessonAction === "REGENERATE") {
      await deps.regenerateLesson(topic);
      result.lessonRegenerated = true;
    }
    if (args.questions) {
      // CURRENT is always re-read from the database, never inferred from what
      // a batch claims to have published.
      let current = planTopic(await reload(deps, id), args).questions.CURRENT;
      while (current < POOL_TARGET && result.questionBatches! < MAX_QUESTION_BATCHES_PER_TOPIC) {
        result.questionBatches!++;
        try {
          result.questionsPublished! += await deps.generateQuestions(id, POOL_TARGET - current);
        } catch (err) {
          (result.batchErrors ??= []).push(err instanceof Error ? err.message : String(err));
        }
        current = planTopic(await reload(deps, id), args).questions.CURRENT;
      }
    }
    const final = planTopic(await reload(deps, id), args);
    result.final = { steps: final.steps, currentQuestions: final.questions.CURRENT, gate: final.gate };
    result.status = final.gate === "READY" && final.steps === "CURRENT" && final.questions.CURRENT >= POOL_TARGET ? "COMPLETED" : "INCOMPLETE";
    results.push(result);
    if (result.status !== "COMPLETED") return { mode: "APPLY", results, stoppedOnFailure: true };
  }
  return { mode: args.apply ? "APPLY" : "DRY_RUN", results, stoppedOnFailure: false };
}

/**
 * `RegenerationDeps.generateQuestions` for the real services. Accumulated
 * final-pool validation (2026-10-03): every batch is judged together with this
 * Topic's already-accepted CURRENT Questions — the same semantics as a staged
 * completion (staged-assignment-repair.ts); the generator reads that pool
 * itself under the batch's own gate.
 */
export function currentPoolQuestionGenerator(
  questionGenerator: { generateAutoQuestionBatch(topicId: string, count: number, actor: string, staged?: undefined, completion?: { againstCurrentPool: true }): Promise<{ drafts: Array<{ id: string }> }> },
  questionPublisher: { autoPublish(draftId: string): Promise<unknown> },
  actorId: string,
): RegenerationDeps["generateQuestions"] {
  return async (topicId, count) => {
    const { drafts } = await questionGenerator.generateAutoQuestionBatch(topicId, count, actorId, undefined, { againstCurrentPool: true });
    for (const d of drafts) await questionPublisher.autoPublish(d.id);
    return drafts.length;
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await import("reflect-metadata");
  await import("dotenv/config");
  const { NestFactory } = await import("@nestjs/core");
  const { AppModule } = await import("../app.module");
  const { PrismaService } = await import("../prisma/prisma.service");
  const { LessonDraftGeneratorService } = await import("../interactive-lesson/lesson-draft-generator/lesson-draft-generator.service");
  const { LessonPublishService } = await import("../interactive-lesson/lesson-draft-generator/lesson-publish.service");
  const { QuestionDraftGeneratorService } = await import("../question-bank/question-draft-generator/question-draft-generator.service");
  const { QuestionPublishService } = await import("../question-bank/question-draft-generator/question-publish.service");
  const { CONTENT_AUTHORING_ACTOR_ID } = await import("../ai/content-authoring-actor.const");
  const { TOPIC_GATE_INCLUDE, UNIT_GATE_SELECT, QUESTION_PROVENANCE_SELECT } = await import("../ai/context/topic-content-provenance.util");

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn", "log"] });
  try {
    const prisma = app.get(PrismaService);
    const lessonGenerator = app.get(LessonDraftGeneratorService);
    const lessonPublisher = app.get(LessonPublishService);
    const questionGenerator = app.get(QuestionDraftGeneratorService);
    const questionPublisher = app.get(QuestionPublishService);
    const out = await runRegeneration(args, {
      loadTopic: async (id) =>
        (await prisma.client.topic.findUnique({
          where: { id },
          include: { ...TOPIC_GATE_INCLUDE, unit: { select: UNIT_GATE_SELECT }, questions: { select: { isPlaceholder: true, ...QUESTION_PROVENANCE_SELECT } } },
        })) as any,
      regenerateLesson: async (topic) => {
        const { draft, generationSource, groundingVersionUsed, generationPromptVersion, provenance } = await lessonGenerator.generateAutoDraft(
          { id: topic.id, nameEn: topic.nameEn, nameAr: topic.nameAr, unitId: topic.unitId },
          { preferredLang: "en", studentAgeRange: "6-12" },
          CONTENT_AUTHORING_ACTOR_ID,
        );
        await lessonPublisher.autoPublishIntoTopic(draft.id, topic.id, { generationSource, groundingVersionUsed, generationPromptVersion, provenance });
      },
      generateQuestions: currentPoolQuestionGenerator(questionGenerator, questionPublisher, CONTENT_AUTHORING_ACTOR_ID),
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
      console.error("REGENERATION FAILED:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}

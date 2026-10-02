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
 *   - The Question pool is topped up until it holds POOL_TARGET CURRENT
 *     Questions. Existing LEGACY Questions are NOT deleted here; once a Unit
 *     is switched to STRICT enforcement (enforce-content-provenance.ts) they
 *     simply stop being served.
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

type TopicResult = TopicPlan & { lessonRegenerated?: boolean; questionsPublished?: number };

export async function runRegeneration(args: RegenerationArgs, deps: RegenerationDeps): Promise<{ mode: "APPLY" | "DRY_RUN"; results: TopicResult[] }> {
  const results: TopicResult[] = [];
  for (const id of args.topicIds) {
    const topic = await deps.loadTopic(id);
    if (!topic) throw new Error(`Topic ${id} not found`);
    const plan = planTopic(topic, args);
    if (plan.lessonAction === "REFUSE") throw new Error(`Topic ${id} is not READY_CURRENT_NON_EMPTY (${plan.gate}); nothing generated`);
    if (!args.apply) {
      results.push(plan);
      continue;
    }
    const result: TopicResult = { ...plan };
    if (plan.lessonAction === "REGENERATE") {
      await deps.regenerateLesson(topic);
      result.lessonRegenerated = true;
    }
    if (plan.questionsToGenerate > 0) result.questionsPublished = await deps.generateQuestions(id, plan.questionsToGenerate);
    results.push(result);
  }
  return { mode: args.apply ? "APPLY" : "DRY_RUN", results };
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
      generateQuestions: async (topicId, count) => {
        const { drafts } = await questionGenerator.generateAutoQuestionBatch(topicId, count, CONTENT_AUTHORING_ACTOR_ID);
        for (const d of drafts) await questionPublisher.autoPublish(d.id);
        return drafts.length;
      },
    });
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("REGENERATION FAILED:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}

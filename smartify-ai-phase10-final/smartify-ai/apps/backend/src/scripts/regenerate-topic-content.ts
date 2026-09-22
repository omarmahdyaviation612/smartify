/**
 * Selective, deliberate regeneration of already-generated Topic content
 * (2026-09-19) — for when a Unit gains real textbook grounding AFTER some
 * of its Topics were already generated the old, title-only way. NEVER
 * invoked automatically; existing cached content keeps serving students
 * exactly as-is until an admin explicitly runs this for a specific
 * Topic/Unit. Reuses the exact same generateAutoDraft/
 * generateAutoQuestionBatch + autoPublishIntoTopic/autoPublish pipeline a
 * student's first-ever open would use — this is not a parallel pipeline,
 * just a manually-triggered re-run of it.
 *
 * Usage (via the root `content:regenerate` script — see root package.json):
 *   pnpm content:regenerate --topicId=<id>
 *   pnpm content:regenerate --unitId=<id> --grounded-only
 *
 * `--unitId` regenerates every Topic under that Unit; `--grounded-only`
 * (only meaningful with --unitId) skips any Topic whose
 * generationSource is already "TEXTBOOK_GROUNDED" — useful for topping up
 * only the ones still stuck on LEGACY_TITLE_ONLY after grounding was added.
 *
 * KNOWN LIMITATION: if real students already have StudentProgress rows
 * against the Topic's existing (AI-generated) Lesson, autoPublishIntoTopic
 * deleting that Lesson to make room for the regenerated one will fail on
 * the foreign-key constraint rather than silently discarding their
 * progress. This is intentional (fail loudly, never silently corrupt real
 * student data) — check for real student engagement before regenerating a
 * Topic that has actually been used, and manage the FK conflict manually
 * if it applies.
 */
import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";
import { LessonDraftGeneratorService } from "../interactive-lesson/lesson-draft-generator/lesson-draft-generator.service";
import { LessonPublishService } from "../interactive-lesson/lesson-draft-generator/lesson-publish.service";
import { QuestionDraftGeneratorService } from "../question-bank/question-draft-generator/question-draft-generator.service";
import { QuestionPublishService } from "../question-bank/question-draft-generator/question-publish.service";
import { CONTENT_AUTHORING_ACTOR_ID } from "../ai/content-authoring-actor.const";

function parseArgs(argv: string[]): { topicId?: string; unitId?: string; groundedOnly: boolean } {
  const flags = new Map<string, string>();
  let groundedOnly = false;
  for (const arg of argv) {
    if (arg === "--grounded-only") {
      groundedOnly = true;
      continue;
    }
    const match = arg.match(/^--([a-zA-Z]+)=(.*)$/);
    if (match) flags.set(match[1], match[2]);
  }
  const topicId = flags.get("topicId");
  const unitId = flags.get("unitId");
  if (!topicId && !unitId) {
    throw new Error("Must pass either --topicId=<id> or --unitId=<id>. Usage: pnpm content:regenerate --topicId=<id> | --unitId=<id> [--grounded-only]");
  }
  return { topicId, unitId, groundedOnly };
}

async function main() {
  const { topicId, unitId, groundedOnly } = parseArgs(process.argv.slice(2));

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn", "log"] });
  try {
    const prisma = app.get(PrismaService);
    const lessonGenerator = app.get(LessonDraftGeneratorService);
    const lessonPublisher = app.get(LessonPublishService);
    const questionGenerator = app.get(QuestionDraftGeneratorService);
    const questionPublisher = app.get(QuestionPublishService);

    let topicIds: string[];
    if (topicId) {
      topicIds = [topicId];
    } else {
      const topics = await prisma.client.topic.findMany({
        where: { unitId, ...(groundedOnly ? { generationSource: { not: "TEXTBOOK_GROUNDED" } } : {}) },
        select: { id: true },
      });
      topicIds = topics.map((t) => t.id);
      console.log(`Found ${topicIds.length} Topic(s) under Unit ${unitId} to regenerate${groundedOnly ? " (excluding already-grounded ones)" : ""}.`);
    }

    // Real Topic name/unitId are needed by generateAutoDraft — fetch each
    // one properly rather than relying on the placeholder passed above.
    for (const id of topicIds) {
      const topic = await prisma.client.topic.findUnique({ where: { id } });
      if (!topic) {
        console.warn(`Skipping ${id}: Topic not found.`);
        continue;
      }
      console.log(`Regenerating Topic ${id} ("${topic.nameEn}")...`);
      try {
        const { draft, generationSource, groundingVersionUsed, generationPromptVersion } = await lessonGenerator.generateAutoDraft(
          { id: topic.id, nameEn: topic.nameEn, nameAr: topic.nameAr, unitId: topic.unitId },
          { preferredLang: "en", studentAgeRange: "6-12" },
          CONTENT_AUTHORING_ACTOR_ID,
        );
        await lessonPublisher.autoPublishIntoTopic(draft.id, id, { generationSource, groundingVersionUsed, generationPromptVersion });
        await questionGenerator
          .generateAutoQuestionBatch(id, 8, CONTENT_AUTHORING_ACTOR_ID)
          .then(async ({ drafts: questionDrafts }) => {
            for (const questionDraft of questionDrafts) await questionPublisher.autoPublish(questionDraft.id);
          })
          .catch((err) => {
            console.warn(`  questions regeneration failed (lesson regeneration still succeeded): ${err instanceof Error ? err.message : err}`);
          });
        console.log(`  done — generationSource=${generationSource}`);
      } catch (err) {
        console.error(`  FAILED: ${err instanceof Error ? err.message : err}`);
      }
    }
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("REGENERATION FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });

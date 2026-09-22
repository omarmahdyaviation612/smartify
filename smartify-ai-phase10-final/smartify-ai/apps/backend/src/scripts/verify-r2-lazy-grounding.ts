/**
 * One-off verification script (2026-09-20) — confirms the real-cloud-backed
 * lazy-grounding path works end-to-end: British Year 5 Science's Subject.
 * sourceFile now points at a Cloudflare R2 object key (uploaded via
 * `pnpm curriculum:upload`), and this exercises the exact same
 * ensureTopicHasLesson path a student's first lesson-page visit triggers,
 * for a Unit ("The life cycle of a flowering plant") that has never been
 * grounded before — so it must actually fetch the PDF from R2 (not a local
 * fallback) to succeed. Not part of any pipeline; safe to delete after use.
 */
import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";
import { LessonDraftGeneratorService } from "../interactive-lesson/lesson-draft-generator/lesson-draft-generator.service";
import { CONTENT_AUTHORING_ACTOR_ID } from "../ai/content-authoring-actor.const";

const TOPIC_ID = "cmu8lpy9n0009ba3zc8k3j6ki"; // "The life cycle of a flowering plant" — ungrounded before this run
const UNIT_ID = "cmu8lpy9m0007ba3zkfeo797p";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn", "log"] });
  try {
    const prisma = app.get(PrismaService);

    const before = await prisma.client.unit.findUniqueOrThrow({ where: { id: UNIT_ID }, select: { groundingNotesJson: true, groundingSourceFingerprint: true } });
    console.log("BEFORE — unit already grounded:", !!before.groundingNotesJson);

    const service = app.get(LessonDraftGeneratorService);
    const topic = await service.ensureTopicHasLesson(TOPIC_ID, { preferredLang: "en", studentAgeRange: "9-10" }, CONTENT_AUTHORING_ACTOR_ID);

    const after = await prisma.client.unit.findUniqueOrThrow({ where: { id: UNIT_ID }, select: { groundingNotesJson: true, groundingSourceFingerprint: true, groundingModel: true } });

    console.log("AFTER — unit grounded:", !!after.groundingNotesJson);
    console.log("Grounding source fingerprint:", after.groundingSourceFingerprint);
    console.log("Grounding model:", after.groundingModel);
    console.log("HAS STEPS:", !!topic.teachingStepsJson);
    console.log("generationSource:", (topic as any).generationSource);
    console.log(JSON.stringify(topic.teachingStepsJson, null, 2));
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FAILED:", err);
    process.exit(1);
  });

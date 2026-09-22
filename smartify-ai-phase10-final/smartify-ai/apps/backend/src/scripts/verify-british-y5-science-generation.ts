/**
 * One-off verification script (2026-09-19) — confirms the newly-seeded
 * British Year 5 Science subject's first topic ("Plant parts") can
 * actually lazily generate a real lesson end-to-end, using the same
 * ensureTopicHasLesson path a student's first lesson-page visit triggers.
 * Not part of any pipeline; safe to delete after use.
 */
import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { LessonDraftGeneratorService } from "../interactive-lesson/lesson-draft-generator/lesson-draft-generator.service";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  const service = app.get(LessonDraftGeneratorService);
  const topic = await service.ensureTopicHasLesson(
    "cmu8lpy9j0005ba3z6fmhas0k",
    { preferredLang: "en", studentAgeRange: "9-10" },
    "cmu8g1qjf0000c0j6dr1ye5fn",
  );
  console.log("HAS STEPS:", !!topic.teachingStepsJson);
  console.log(JSON.stringify(topic.teachingStepsJson, null, 2));
  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});

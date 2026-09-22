/**
 * Grade 1 Arabic pilot, Unit 1 "أسرتي": generates LessonDraft rows for the
 * first two letter lessons (Alef, Baa), using the reusable
 * LessonDraftGeneratorService — real budget check, real AIUsage logging,
 * real provider — never a parallel content pipeline.
 *
 * Source: curriculum-pilot/egypt-primary/grade1-arabic-term1/curriculum-map.json
 * (Unit 1, lessons 1-1 and 1-2) — topic names and English learning
 * objectives only, never textbook prose.
 *
 * Persists LessonDraft rows with status "pending_review" only. Does NOT
 * call reviewObjectives(), approve(), or publish() — a human reviewer
 * must supply objectiveAr before any of that.
 */
import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { InteractiveLessonModule } from "../interactive-lesson/interactive-lesson.module";
import { LessonDraftGeneratorService, LessonDraftGenerationError } from "../interactive-lesson/lesson-draft-generator/lesson-draft-generator.service";
import type { LessonGenerationInput } from "../interactive-lesson/lesson-draft-generator/lesson-draft.types";

const ADMIN_USER_ID = "cmtz6270z0000u9c5h6ua0y67"; // the one SUPER_ADMIN account — content-authoring action, not a student one
const UNIT1_ID = "cmu78g0ki00035tap6x716e28"; // live-verified Unit 1 "أسرتي" id (Grade 1, Arabic Language, Egyptian National)

const INPUTS: LessonGenerationInput[] = [
  {
    topicNameEn: "Letter Alef (أ)",
    topicNameAr: "حرف الألف",
    // Original Smartify learning objectives — from curriculum-map.json's
    // provenance artifact (lesson 1-1), re-expressing the book's own
    // printed lesson-objective footer, not textbook prose.
    learningObjectives: [
      "Recognize the shape of the letter Alef through a variety of activities.",
      "Pronounce the sound of the letter Alef with each short vowel mark and with sukoon.",
      "Write the letter Alef correctly, following the correct writing-stroke direction.",
    ],
    preferredLang: "ar",
    studentAgeRange: "6-7",
    targetUnitId: UNIT1_ID,
  },
  {
    topicNameEn: "Letter Baa (ب)",
    topicNameAr: "حرف الباء",
    // From curriculum-map.json (lesson 1-2).
    learningObjectives: [
      "Recognize the isolated and connected written forms of the letter Baa.",
      "Pronounce the sound of the letter Baa with each short vowel mark and with sukoon.",
      "Write the letter Baa correctly, following the correct writing-stroke direction.",
    ],
    preferredLang: "ar",
    studentAgeRange: "6-7",
    targetUnitId: UNIT1_ID,
  },
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["warn", "error"] });
  const results: unknown[] = [];
  try {
    const generator = app.select(InteractiveLessonModule).get(LessonDraftGeneratorService, { strict: false });
    for (const input of INPUTS) {
      try {
        const { draft, attempts, callsMade } = await generator.generateDraft(input, ADMIN_USER_ID);
        results.push({
          ok: true,
          draftId: draft.id,
          topicNameEn: draft.topicNameEn,
          status: draft.status,
          attempts,
          callsMade,
          stepCount: (draft.teachingStepsJson as unknown[]).length,
        });
      } catch (err) {
        results.push({
          ok: false,
          topicNameEn: input.topicNameEn,
          error: err instanceof Error ? err.message : String(err),
          attempts: err instanceof LessonDraftGenerationError ? err.attempts : undefined,
          lastErrors: err instanceof LessonDraftGenerationError ? err.lastErrors : undefined,
        });
      }
    }
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await app.close();
  }
}

main();

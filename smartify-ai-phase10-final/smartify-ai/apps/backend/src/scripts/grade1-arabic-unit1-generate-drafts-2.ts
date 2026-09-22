/**
 * Grade 1 Arabic pilot, Unit 1 "أسرتي": generates LessonDraft rows for the
 * remaining six letter lessons (Meem, Haa, Jeem, Dal, Khaa, Taa), using
 * the reusable LessonDraftGeneratorService — same as
 * grade1-arabic-unit1-generate-drafts.ts (Alef, Baa), split into a second
 * script only because that first one already ran.
 *
 * Source: curriculum-pilot/egypt-primary/grade1-arabic-term1/curriculum-map.json
 * (Unit 1, lessons 1-3 through 1-8) — topic names and English learning
 * objectives only, never textbook prose.
 *
 * Persists LessonDraft rows with status "pending_review" only.
 */
import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { InteractiveLessonModule } from "../interactive-lesson/interactive-lesson.module";
import { LessonDraftGeneratorService, LessonDraftGenerationError } from "../interactive-lesson/lesson-draft-generator/lesson-draft-generator.service";
import type { LessonGenerationInput } from "../interactive-lesson/lesson-draft-generator/lesson-draft.types";

const ADMIN_USER_ID = "cmtz6270z0000u9c5h6ua0y67"; // the one SUPER_ADMIN account
const UNIT1_ID = "cmu78g0ki00035tap6x716e28"; // live-verified Unit 1 "أسرتي" id

const INPUTS: LessonGenerationInput[] = [
  {
    topicNameEn: "Letter Meem (م)",
    topicNameAr: "حرف الميم",
    learningObjectives: [
      "Recognize the isolated and connected written forms of the letter Meem.",
      "Pronounce the sound of the letter Meem with each short vowel mark and with sukoon.",
      "Write the letter Meem correctly, following the correct writing-stroke direction.",
    ],
    preferredLang: "ar",
    studentAgeRange: "6-7",
    targetUnitId: UNIT1_ID,
  },
  {
    topicNameEn: "Letter Haa (ح)",
    topicNameAr: "حرف الحاء",
    learningObjectives: [
      "Recognize the isolated and connected written forms of the letter Haa.",
      "Pronounce the sound of the letter Haa with each short vowel mark and with sukoon.",
      "Write the letter Haa correctly, following the correct writing-stroke direction.",
    ],
    preferredLang: "ar",
    studentAgeRange: "6-7",
    targetUnitId: UNIT1_ID,
  },
  {
    topicNameEn: "Letter Jeem (ج)",
    topicNameAr: "حرف الجيم",
    learningObjectives: [
      "Recognize the isolated and connected written forms of the letter Jeem.",
      "Pronounce the sound of the letter Jeem with each short vowel mark and with sukoon.",
      "Write the letter Jeem correctly, following the correct writing-stroke direction.",
    ],
    preferredLang: "ar",
    studentAgeRange: "6-7",
    targetUnitId: UNIT1_ID,
  },
  {
    topicNameEn: "Letter Dal (د)",
    topicNameAr: "حرف الدال",
    learningObjectives: [
      "Recognize the two written forms of the letter Dal (it never connects forward to the next letter).",
      "Pronounce the sound of the letter Dal with each short vowel mark and with sukoon.",
      "Write the letter Dal correctly, following the correct writing-stroke direction.",
    ],
    preferredLang: "ar",
    studentAgeRange: "6-7",
    targetUnitId: UNIT1_ID,
  },
  {
    topicNameEn: "Letter Khaa (خ)",
    topicNameAr: "حرف الخاء",
    learningObjectives: [
      "Recognize the isolated and connected written forms of the letter Khaa.",
      "Pronounce the sound of the letter Khaa with each short vowel mark and with sukoon.",
      "Write the letter Khaa correctly, following the correct writing-stroke direction.",
    ],
    preferredLang: "ar",
    studentAgeRange: "6-7",
    targetUnitId: UNIT1_ID,
  },
  {
    topicNameEn: "Letter Taa (ت)",
    topicNameAr: "حرف التاء",
    learningObjectives: [
      "Recognize the isolated and connected written forms of the letter Taa.",
      "Pronounce the sound of the letter Taa with each short vowel mark and with sukoon.",
      "Write the letter Taa correctly, following the correct writing-stroke direction.",
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

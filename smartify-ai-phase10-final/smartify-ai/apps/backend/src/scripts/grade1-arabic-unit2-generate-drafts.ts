/**
 * Grade 1 Arabic pilot, Unit 2 "حيواناتي": generates LessonDraft rows for
 * all seven letter lessons (Lam, Seen, Noon, Raa, Faa, Kaf, Qaf), using
 * the reusable LessonDraftGeneratorService.
 *
 * Source: curriculum-pilot/egypt-primary/grade1-arabic-term1/curriculum-map.json
 * (Unit 2, lessons 2-1 through 2-7) — topic names and English learning
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

const ADMIN_USER_ID = "cmtz6270z0000u9c5h6ua0y67";
const UNIT2_ID = "cmu797m5v0001ecd3lb4isdvp"; // live-verified Unit 2 "حيواناتي" id

function stdObjectives(letterEn: string) {
  return [
    `Recognize the isolated and connected written forms of the letter ${letterEn}.`,
    `Pronounce the sound of the letter ${letterEn} with each short vowel mark and with sukoon.`,
    `Use the letter ${letterEn} to complete or build a simple word.`,
    `Recognize the sound of the letter ${letterEn} within a spoken sentence or story.`,
  ];
}

const INPUTS: LessonGenerationInput[] = [
  { topicNameEn: "Letter Lam (ل)", topicNameAr: "حرف اللام", learningObjectives: stdObjectives("Lam"), preferredLang: "ar", studentAgeRange: "6-7", targetUnitId: UNIT2_ID },
  { topicNameEn: "Letter Seen (س)", topicNameAr: "حرف السين", learningObjectives: stdObjectives("Seen"), preferredLang: "ar", studentAgeRange: "6-7", targetUnitId: UNIT2_ID },
  { topicNameEn: "Letter Noon (ن)", topicNameAr: "حرف النون", learningObjectives: stdObjectives("Noon"), preferredLang: "ar", studentAgeRange: "6-7", targetUnitId: UNIT2_ID },
  {
    topicNameEn: "Letter Raa (ر)", topicNameAr: "حرف الراء",
    learningObjectives: [
      "Recognize the two written forms of the letter Raa (it never connects forward to the next letter).",
      "Pronounce the sound of the letter Raa with each short vowel mark and with sukoon.",
      "Use the letter Raa to complete or build a simple word.",
      "Recognize the sound of the letter Raa within a spoken sentence or story.",
    ],
    preferredLang: "ar", studentAgeRange: "6-7", targetUnitId: UNIT2_ID,
  },
  { topicNameEn: "Letter Faa (ف)", topicNameAr: "حرف الفاء", learningObjectives: stdObjectives("Faa"), preferredLang: "ar", studentAgeRange: "6-7", targetUnitId: UNIT2_ID },
  { topicNameEn: "Letter Kaf (ك)", topicNameAr: "حرف الكاف", learningObjectives: stdObjectives("Kaf"), preferredLang: "ar", studentAgeRange: "6-7", targetUnitId: UNIT2_ID },
  { topicNameEn: "Letter Qaf (ق)", topicNameAr: "حرف القاف", learningObjectives: stdObjectives("Qaf"), preferredLang: "ar", studentAgeRange: "6-7", targetUnitId: UNIT2_ID },
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

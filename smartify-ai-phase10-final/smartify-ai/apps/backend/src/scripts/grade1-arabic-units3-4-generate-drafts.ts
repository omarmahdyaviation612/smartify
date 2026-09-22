/**
 * Grade 1 Arabic pilot, Units 3 "أجزاء جسمي" and 4 "مدرستي": generates
 * LessonDraft rows for all thirteen remaining letter lessons.
 *
 * Speed-over-precision pass (explicit tradeoff, requested for launch
 * timeline): unlike Units 1-2, individual PDF pages were NOT opened for
 * these thirteen letters. Objectives are template-derived from the
 * confirmed six-activity pattern seen across all 15 letters already
 * published (see curriculum-map.json's Unit 1/2 notes), varying only by
 * letter name and by whether the letter connects forward to the next
 * letter (Waw, Dhal, and Zay do not — same non-connector pattern as
 * Alef/Dal/Raa). No textbook prose is used either way — only letter
 * names and generic phonics-lesson objectives.
 */
import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { InteractiveLessonModule } from "../interactive-lesson/interactive-lesson.module";
import { LessonDraftGeneratorService, LessonDraftGenerationError } from "../interactive-lesson/lesson-draft-generator/lesson-draft-generator.service";
import type { LessonGenerationInput } from "../interactive-lesson/lesson-draft-generator/lesson-draft.types";

const ADMIN_USER_ID = "cmtz6270z0000u9c5h6ua0y67";
const UNIT3_ID = "cmu79t5h20001f6fg0w875100"; // "أجزاء جسمي"
const UNIT4_ID = "cmu79t5h60003f6fgfwh6u309"; // "مدرستي"

function connectingObjectives(letterEn: string) {
  return [
    `Recognize the isolated and connected written forms of the letter ${letterEn}.`,
    `Pronounce the sound of the letter ${letterEn} with each short vowel mark and with sukoon.`,
    `Use the letter ${letterEn} to complete or build a simple word.`,
    `Recognize the sound of the letter ${letterEn} within a spoken sentence or story.`,
  ];
}

function nonConnectingObjectives(letterEn: string) {
  return [
    `Recognize the two written forms of the letter ${letterEn} (it never connects forward to the next letter).`,
    `Pronounce the sound of the letter ${letterEn} with each short vowel mark and with sukoon.`,
    `Use the letter ${letterEn} to complete or build a simple word.`,
    `Recognize the sound of the letter ${letterEn} within a spoken sentence or story.`,
  ];
}

const INPUTS: LessonGenerationInput[] = [
  // Unit 3 — أجزاء جسمي
  { topicNameEn: "Letter Yaa (ي)", topicNameAr: "حرف الياء", learningObjectives: connectingObjectives("Yaa"), preferredLang: "ar", studentAgeRange: "6-7", targetUnitId: UNIT3_ID },
  { topicNameEn: "Letter Ain (ع)", topicNameAr: "حرف العين", learningObjectives: connectingObjectives("Ain"), preferredLang: "ar", studentAgeRange: "6-7", targetUnitId: UNIT3_ID },
  { topicNameEn: "Letter Sheen (ش)", topicNameAr: "حرف الشين", learningObjectives: connectingObjectives("Sheen"), preferredLang: "ar", studentAgeRange: "6-7", targetUnitId: UNIT3_ID },
  { topicNameEn: "Letter Waw (و)", topicNameAr: "حرف الواو", learningObjectives: nonConnectingObjectives("Waw"), preferredLang: "ar", studentAgeRange: "6-7", targetUnitId: UNIT3_ID },
  { topicNameEn: "Letter Ha (ه)", topicNameAr: "حرف الهاء", learningObjectives: connectingObjectives("Ha"), preferredLang: "ar", studentAgeRange: "6-7", targetUnitId: UNIT3_ID },
  { topicNameEn: "Letter Dhal (ذ)", topicNameAr: "حرف الذال", learningObjectives: nonConnectingObjectives("Dhal"), preferredLang: "ar", studentAgeRange: "6-7", targetUnitId: UNIT3_ID },
  { topicNameEn: "Letter Dhaa (ظ)", topicNameAr: "حرف الظاء", learningObjectives: connectingObjectives("Dhaa"), preferredLang: "ar", studentAgeRange: "6-7", targetUnitId: UNIT3_ID },
  // Unit 4 — مدرستي
  { topicNameEn: "Letter Zay (ز)", topicNameAr: "حرف الزاي", learningObjectives: nonConnectingObjectives("Zay"), preferredLang: "ar", studentAgeRange: "6-7", targetUnitId: UNIT4_ID },
  { topicNameEn: "Letter Emphatic Ta (ط)", topicNameAr: "حرف الطاء", learningObjectives: connectingObjectives("Emphatic Ta"), preferredLang: "ar", studentAgeRange: "6-7", targetUnitId: UNIT4_ID },
  { topicNameEn: "Letter Sad (ص)", topicNameAr: "حرف الصاد", learningObjectives: connectingObjectives("Sad"), preferredLang: "ar", studentAgeRange: "6-7", targetUnitId: UNIT4_ID },
  { topicNameEn: "Letter Dad (ض)", topicNameAr: "حرف الضاد", learningObjectives: connectingObjectives("Dad"), preferredLang: "ar", studentAgeRange: "6-7", targetUnitId: UNIT4_ID },
  { topicNameEn: "Letter Thaa (ث)", topicNameAr: "حرف الثاء", learningObjectives: connectingObjectives("Thaa"), preferredLang: "ar", studentAgeRange: "6-7", targetUnitId: UNIT4_ID },
  { topicNameEn: "Letter Ghain (غ)", topicNameAr: "حرف الغين", learningObjectives: connectingObjectives("Ghain"), preferredLang: "ar", studentAgeRange: "6-7", targetUnitId: UNIT4_ID },
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["warn", "error"] });
  const results: unknown[] = [];
  try {
    const generator = app.select(InteractiveLessonModule).get(LessonDraftGeneratorService, { strict: false });
    for (const input of INPUTS) {
      try {
        const { draft, attempts, callsMade } = await generator.generateDraft(input, ADMIN_USER_ID);
        results.push({ ok: true, draftId: draft.id, topicNameEn: draft.topicNameEn, status: draft.status, attempts, callsMade });
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

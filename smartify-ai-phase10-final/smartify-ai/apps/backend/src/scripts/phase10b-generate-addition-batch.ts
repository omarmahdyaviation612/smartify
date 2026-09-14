/**
 * Phase 10B: generates exactly two LessonDraft rows for Unit 3 (Addition),
 * completing the four-lesson unit that generate-lesson-draft-phase5.ts's
 * lesson 3-3 started. Uses the reusable LessonDraftGeneratorService —
 * real budget check, real AIUsage logging, real provider — never a
 * parallel content pipeline.
 *
 * Source: curriculum-pilot/egypt-primary/grade1-math-term1/curriculum-map.json
 * (lessons 3-2 and 3-4 under Unit 3 "Addition") — topic names and English
 * learning objectives only, never textbook prose.
 *
 * Persists LessonDraft rows with status "pending_review" only. Does NOT
 * call reviewObjectives(), approve(), or publish() — objectiveAr stays
 * null on every objective until a human reviewer explicitly supplies it.
 */
import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { InteractiveLessonModule } from "../interactive-lesson/interactive-lesson.module";
import { LessonDraftGeneratorService, LessonDraftGenerationError } from "../interactive-lesson/lesson-draft-generator/lesson-draft-generator.service";
import type { LessonGenerationInput } from "../interactive-lesson/lesson-draft-generator/lesson-draft.types";

const ADMIN_USER_ID = "cmtz6270z0000u9c5h6ua0y67"; // the one SUPER_ADMIN account — content-authoring action, not a student one
const ADDITION_UNIT_ID = "cmtyw9x6j00059youvb8zt3r0"; // live-verified Addition unit id (Grade 1, Mathematics, Egyptian National)

const INPUTS: LessonGenerationInput[] = [
  {
    topicNameEn: "Addition (Part 2)",
    topicNameAr: "الجمع (الجزء الثاني)",
    // Original Smartify learning objective — from curriculum-map.json's
    // already-reviewed provenance artifact (lesson 3-2), not textbook text.
    learningObjectives: ["Solve a simple addition word problem and express the answer with the correct label (e.g., '5 pencils')."],
    preferredLang: "ar",
    studentAgeRange: "6-7",
    targetUnitId: ADDITION_UNIT_ID,
  },
  {
    topicNameEn: "Addition Stories",
    topicNameAr: "قصص الجمع",
    // From curriculum-map.json (lesson 3-4).
    learningObjectives: ["Invent an original short scenario that correctly matches a given addition sentence (e.g., 2 + 3 = 5)."],
    preferredLang: "ar",
    studentAgeRange: "6-7",
    targetUnitId: ADDITION_UNIT_ID,
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

/**
 * Phase 5, one-off runner (HISTORICAL RECORD — already run; do not re-run).
 * Generated exactly ONE lesson draft ("Addition with Zero", under the
 * existing Addition unit) using the reusable LessonDraftGeneratorService.
 * Persisted a LessonDraft row with status "pending_review" — never a real
 * Topic row, so it could never reach a student regardless of outcome.
 * That draft was later approved and published in Phase 6 — see
 * publish-lesson-draft-phase6.ts. Kept only for provenance; running it
 * again would violate Phase 6's "do not generate another draft" rule.
 *
 * Updated for Phase 6 Part A's input-contract change (curriculum/grade/
 * subject/unit names are now resolved live from targetUnitId, not
 * hand-typed) purely so this file keeps compiling as a historical record.
 */
import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { InteractiveLessonModule } from "../interactive-lesson/interactive-lesson.module";
import { LessonDraftGeneratorService } from "../interactive-lesson/lesson-draft-generator/lesson-draft-generator.service";
import type { LessonGenerationInput } from "../interactive-lesson/lesson-draft-generator/lesson-draft.types";

const ADMIN_USER_ID = "cmthp3g6d0000wlpcb10fpngr"; // the one SUPER_ADMIN account — this is a content-authoring action, not a student one
const ADDITION_UNIT_ID = "cmtxtrmeu000510sqey818ayj"; // the existing validated Addition unit — this draft would publish under it later, if approved

const INPUT: LessonGenerationInput = {
  topicNameEn: "Addition with Zero",
  topicNameAr: "الجمع مع العدد صفر",
  // Original Smartify learning objective — from curriculum-map.json's
  // already-reviewed Phase 1 artifact (lesson 3-3), not textbook text.
  learningObjectives: ["State and apply the rule that adding zero to a number does not change its value."],
  preferredLang: "ar",
  studentAgeRange: "6-7",
  targetUnitId: ADDITION_UNIT_ID,
};

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["warn", "error"] });
  try {
    const generator = app.select(InteractiveLessonModule).get(LessonDraftGeneratorService, { strict: false });
    const { draft, attempts, callsMade } = await generator.generateDraft(INPUT, ADMIN_USER_ID);
    console.log(
      JSON.stringify(
        {
          draftId: draft.id,
          status: draft.status,
          topicNameEn: draft.topicNameEn,
          aiProvider: draft.aiProvider,
          aiModel: draft.aiModel,
          attempts,
          callsMade,
          stepCount: (draft.teachingStepsJson as unknown[]).length,
        },
        null,
        2,
      ),
    );
  } catch (err) {
    console.error("LESSON DRAFT GENERATION FAILED:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main();

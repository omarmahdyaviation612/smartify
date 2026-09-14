/**
 * Phase R2 one-off runner: regenerates the lost Phase 5 lesson draft
 * ("Addition with Zero" / "الجمع مع العدد صفر") using the unchanged,
 * already-tested LessonDraftGeneratorService pipeline. This is
 * REGENERATION, not recovery — the original Phase 5 AI output was lost in
 * the 2026-09-12 database incident (see
 * docs/incident-2026-09-12-database-reset.md) and cannot be restored
 * byte-identical.
 *
 * targetUnitId is read from the current (R1-reconstructed) database
 * rather than hand-typed, since the generator's input contract already
 * requires it (Phase 6 Part A's resolveUnitContext) — this script does not
 * add or change any generator behavior.
 */
import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { InteractiveLessonModule } from "../interactive-lesson/interactive-lesson.module";
import { LessonDraftGeneratorService } from "../interactive-lesson/lesson-draft-generator/lesson-draft-generator.service";
import { PrismaService } from "../prisma/prisma.service";
import type { LessonGenerationInput } from "../interactive-lesson/lesson-draft-generator/lesson-draft.types";

// No real User rows exist post-incident (see R1's Part I — intentionally
// not recreated). AIUsage.userId has no foreign key (plain String column),
// so a clearly-labeled placeholder is safe and honest here — this is a
// content-authoring action, not a student one, exactly as in Phase 5.
const CONTENT_AUTHORING_ACTOR_ID = "r2-content-authoring";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["warn", "error"] });
  try {
    const prisma = app.get(PrismaService);
    const unit = await prisma.client.unit.findFirst({
      where: { nameEn: "Addition" },
      include: { subject: { include: { grade: { include: { curriculum: true } } } } },
    });
    if (!unit) throw new Error("Addition unit not found — pilot curriculum hierarchy is not intact.");
    if (unit.subject.nameEn !== "Mathematics" || unit.subject.grade.nameEn !== "Grade 1" || unit.subject.grade.curriculum.code !== "EG_NATIONAL") {
      throw new Error(
        `Unexpected hierarchy for Addition unit: ${unit.subject.grade.curriculum.code} / ${unit.subject.grade.nameEn} / ${unit.subject.nameEn} — refusing to generate against the wrong target.`,
      );
    }
    console.log(
      `Verified target hierarchy: ${unit.subject.grade.curriculum.code} -> ${unit.subject.grade.nameEn} -> ${unit.subject.nameEn} -> Unit "${unit.nameEn}" (${unit.id})`,
    );

    const INPUT: LessonGenerationInput = {
      topicNameEn: "Addition with Zero",
      topicNameAr: "الجمع مع العدد صفر",
      // Original Smartify learning objective — from curriculum-map.json's
      // already-reviewed Phase 1 artifact (lesson 3-3), not textbook text.
      // Unchanged from the accepted Phase 5 input.
      learningObjectives: ["State and apply the rule that adding zero to a number does not change its value."],
      preferredLang: "ar",
      studentAgeRange: "6-7",
      targetUnitId: unit.id,
    };

    const generator = app.select(InteractiveLessonModule).get(LessonDraftGeneratorService, { strict: false });
    const { draft, attempts, callsMade } = await generator.generateDraft(INPUT, CONTENT_AUTHORING_ACTOR_ID);

    console.log(
      JSON.stringify(
        {
          draftId: draft.id,
          status: draft.status,
          topicNameEn: draft.topicNameEn,
          topicNameAr: draft.topicNameAr,
          targetUnitId: draft.targetUnitId,
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
    console.error("LESSON DRAFT REGENERATION FAILED:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main();

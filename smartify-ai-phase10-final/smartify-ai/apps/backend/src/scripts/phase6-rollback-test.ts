/**
 * Phase 6, Part J: real transactional rollback test against the live dev
 * database — NOT a mock. Creates one disposable, clearly-labeled
 * LessonDraft (never the real "Addition with Zero" draft), publishes it
 * through the real LessonPublishService with an objective that has no
 * reviewed Arabic translation (a genuine, existing guard — see
 * lesson-publish.service.ts), which throws from *inside* the transaction
 * after Topic/Lesson have already been created in that same transaction.
 * Verifies Postgres actually rolled everything back, then deletes the
 * disposable draft row itself (not "real curriculum" — just test
 * scaffolding this script created). Historical record — do not re-run
 * against a database with real content without re-reading this comment.
 */
import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { InteractiveLessonModule } from "../interactive-lesson/interactive-lesson.module";
import { LessonPublishService } from "../interactive-lesson/lesson-draft-generator/lesson-publish.service";
import { PrismaService } from "../prisma/prisma.service";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["warn", "error"] });
  try {
    const prisma = app.get(PrismaService);
    const publisher = app.select(InteractiveLessonModule).get(LessonPublishService, { strict: false });

    const additionUnit = await prisma.client.unit.findFirstOrThrow({ where: { nameEn: "Addition" } });

    const before = {
      topic: await prisma.client.topic.count(),
      lesson: await prisma.client.lesson.count(),
      learningObjective: await prisma.client.learningObjective.count(),
    };

    const testDraft = await prisma.client.lessonDraft.create({
      data: {
        targetUnitId: additionUnit.id,
        topicNameEn: "Rollback Test — DO NOT KEEP",
        topicNameAr: "اختبار التراجع — لا تحتفظ به",
        learningObjectivesJson: ["An objective with no reviewed translation — used only to trigger a deliberate rollback test."],
        teachingStepsJson: [
          { id: "s1", type: "INTRO", order: 1, objective: "Greet." },
          { id: "s2", type: "EXPLAIN", order: 2, objective: "Explain." },
          { id: "s3", type: "CHECK", order: 3, objective: "Check.", checkType: "conceptual" },
          { id: "s4", type: "EXAMPLE", order: 4, objective: "Example." },
          { id: "s5", type: "CHECK", order: 5, objective: "Check applied.", checkType: "applied" },
          { id: "s6", type: "REVIEW", order: 6, objective: "Review." },
          { id: "s7", type: "COMPLETE", order: 7, objective: "Done." },
        ],
        status: "approved", // set directly — bypassing approve() is fine, this is a rollback test, not an approval test
        aiProvider: "test",
        aiModel: "test",
      },
    });

    let publishError: string | null = null;
    try {
      await publisher.publish(testDraft.id);
    } catch (err) {
      publishError = err instanceof Error ? err.message : String(err);
    }

    const after = {
      topic: await prisma.client.topic.count(),
      lesson: await prisma.client.lesson.count(),
      learningObjective: await prisma.client.learningObjective.count(),
    };

    const draftAfter = await prisma.client.lessonDraft.findUniqueOrThrow({ where: { id: testDraft.id } });
    const leakedTopic = await prisma.client.topic.findFirst({ where: { nameEn: "Rollback Test — DO NOT KEEP" } });

    // Cleanup: delete only the disposable test draft this script created.
    await prisma.client.lessonDraft.delete({ where: { id: testDraft.id } });

    console.log(
      JSON.stringify(
        {
          publishThrew: publishError !== null,
          publishErrorMessage: publishError,
          countsBefore: before,
          countsAfter: after,
          countsUnchanged: JSON.stringify(before) === JSON.stringify(after),
          draftStatusAfterFailedPublish: draftAfter.status,
          draftPublishedTopicIdAfterFailedPublish: draftAfter.publishedTopicId,
          draftPublishedAtAfterFailedPublish: draftAfter.publishedAt,
          leakedTopicFound: leakedTopic !== null,
          testDraftCleanedUp: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
}

main();

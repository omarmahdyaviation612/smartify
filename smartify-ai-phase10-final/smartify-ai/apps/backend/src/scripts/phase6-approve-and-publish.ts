/**
 * Phase 6, Parts E/F/I: approve and publish the single accepted
 * "Addition with Zero" LessonDraft (cmtyx1wnq0002w7iz5ru2l39f), then
 * immediately attempt a second publish of the same draft to prove
 * idempotency. No AI call anywhere in this script. Historical record —
 * do not re-run; a second run's "publish" call will simply hit the
 * idempotent already-published path harmlessly, but there is nothing
 * left to approve.
 */
import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { InteractiveLessonModule } from "../interactive-lesson/interactive-lesson.module";
import { LessonPublishService } from "../interactive-lesson/lesson-draft-generator/lesson-publish.service";
import { PrismaService } from "../prisma/prisma.service";

const DRAFT_ID = "cmtyx1wnq0002w7iz5ru2l39f";

async function counts(prisma: PrismaService) {
  return {
    lessonDraft: await prisma.client.lessonDraft.count(),
    topic: await prisma.client.topic.count(),
    lesson: await prisma.client.lesson.count(),
    learningObjective: await prisma.client.learningObjective.count(),
    aiUsage: await prisma.client.aIUsage.count(),
  };
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["warn", "error"] });
  try {
    const prisma = app.get(PrismaService);
    const publisher = app.select(InteractiveLessonModule).get(LessonPublishService, { strict: false });

    const before = await counts(prisma);

    const approved = await publisher.approve(DRAFT_ID);
    console.log("APPROVED:", JSON.stringify({ id: approved.id, status: approved.status, reviewedAt: approved.reviewedAt }, null, 2));

    const firstPublish = await publisher.publish(DRAFT_ID);
    console.log("FIRST PUBLISH:", JSON.stringify(firstPublish, null, 2));

    const afterFirst = await counts(prisma);

    const secondPublish = await publisher.publish(DRAFT_ID);
    console.log("SECOND PUBLISH (idempotency check):", JSON.stringify(secondPublish, null, 2));

    const afterSecond = await counts(prisma);

    const finalDraft = await prisma.client.lessonDraft.findUniqueOrThrow({ where: { id: DRAFT_ID } });

    console.log(
      "SUMMARY:",
      JSON.stringify(
        {
          countsBefore: before,
          countsAfterFirstPublish: afterFirst,
          countsAfterSecondPublish: afterSecond,
          firstVsSecondIdentical: JSON.stringify(afterFirst) === JSON.stringify(afterSecond),
          finalDraftStatus: finalDraft.status,
          finalPublishedTopicId: finalDraft.publishedTopicId,
          finalPublishedAt: finalDraft.publishedAt,
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

/**
 * Phase 8.1: minimal isolated live check for the strengthened NUMBER_LINE
 * prompt guidance. Reuses the EXISTING Phase 8 QA session (already sitting
 * at s3 "Addition with Zero" with strategy persisted as NUMBER_LINE from
 * the prior pilot run) — does NOT replay s1/s2/s3 delivery or the two
 * wrong-answer switch sequence. Sends the exact same two follow-up
 * messages the original pilot sent post-switch, for a direct before/after
 * comparison of the prompt fix. At most 2 real AI calls, no TTS, no image
 * generation.
 */
import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { InteractiveLessonModule } from "../interactive-lesson/interactive-lesson.module";
import { InteractiveLessonService } from "../interactive-lesson/interactive-lesson.service";
import { PrismaService } from "../prisma/prisma.service";

const TOPIC_ID = "cmtyxp0ip0002okuh8z7ufitp";
const QA_EMAIL = "qa-phase8-strategy-pilot@smartify.test";

function log(tag: string, data: unknown) {
  console.log(`\n===== ${tag} =====`);
  console.log(JSON.stringify(data, null, 2));
}

async function withFreshApp<T>(fn: (svc: InteractiveLessonService, prisma: PrismaService) => Promise<T>): Promise<T> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["warn", "error"] });
  try {
    return await fn(app.select(InteractiveLessonModule).get(InteractiveLessonService, { strict: false }), app.get(PrismaService));
  } finally {
    await app.close();
  }
}

async function main() {
  const { userId } = await withFreshApp(async (_svc, prisma) => {
    const user = await prisma.client.user.findUniqueOrThrow({ where: { email: QA_EMAIL } });
    return { userId: user.id };
  });

  const strategyBefore = await withFreshApp(async (_svc, prisma) => {
    const profile = await prisma.client.studentProfile.findUniqueOrThrow({ where: { userId } });
    const session = await prisma.client.lessonSession.findUniqueOrThrow({ where: { studentId_topicId: { studentId: profile.id, topicId: TOPIC_ID } } });
    const s3 = (session.stepResultsJson as any[]).find((r) => r.stepId === "s3");
    return { strategy: s3?.strategy, sessionStatus: session.status, currentStepIndex: session.currentStepIndex };
  });
  log("PRE-CHECK: strategy already persisted on existing QA session (no replay)", strategyBefore);
  if (strategyBefore.strategy !== "NUMBER_LINE") {
    throw new Error(`Expected existing session strategy to already be NUMBER_LINE, got ${strategyBefore.strategy}`);
  }

  const aiUsageBefore = await withFreshApp((_svc, prisma) => prisma.client.aIUsage.count());

  // Call 1: same clarifying question as the original pilot's step E.
  const call1 = await withFreshApp((svc) => svc.respond(userId, TOPIC_ID, "اشرحلي تاني إزاي؟"));
  log("CALL 1 (clarifying question, NUMBER_LINE forced/already-persisted)", { response: call1.content });

  // Call 2: same correct-answer message as the original pilot's step F.
  const call2 = await withFreshApp((svc) => svc.respond(userId, TOPIC_ID, "4"));
  log("CALL 2 (correct answer, NUMBER_LINE)", { response: call2.content });

  const aiUsageAfter = await withFreshApp(async (_svc, prisma) => {
    const profile = await prisma.client.studentProfile.findUniqueOrThrow({ where: { userId } });
    const rows = await prisma.client.aIUsage.findMany({
      where: { studentId: profile.id },
      orderBy: { createdAt: "asc" },
      take: 2,
      skip: Math.max(0, (await prisma.client.aIUsage.count({ where: { studentId: profile.id } })) - 2),
    });
    return { totalCountNow: await prisma.client.aIUsage.count(), newRows: rows };
  });
  log("AI USAGE (this check only)", { totalBefore: aiUsageBefore, totalAfter: aiUsageAfter.totalCountNow, newRows: aiUsageAfter.newRows });
}

main().catch((err) => {
  console.error("PHASE 8.1 CHECK FAILED:", err instanceof Error ? err.stack : err);
  process.exitCode = 1;
});

/**
 * Phase 8: live pilot of the Teaching Strategy Engine V1 on the real
 * published "Addition with Zero" topic, through the real
 * InteractiveLessonService (advance/respond) — same methodology as
 * Phase 7's live QA (direct service calls; Phase 7.1/7.2 already proved
 * the HTTP/Clerk/TTS layers separately, so this phase focuses the real
 * OpenAI calls on proving the strategy-switch logic itself).
 *
 * Creates one new, clearly-labeled QA account so the switch/no-switch
 * behavior can be observed from a clean slate (the Phase 7/7.1 accounts'
 * sessions on this topic are already resolved).
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
    const unit = await prisma.client.unit.findFirstOrThrow({ where: { nameEn: "Addition" }, include: { subject: { include: { grade: true } } } });
    const grade = unit.subject.grade;
    const existing = await prisma.client.user.findUnique({ where: { email: QA_EMAIL } });
    if (existing) return { userId: existing.id };
    const user = await prisma.client.user.create({ data: { clerkUserId: `qa-test-phase8-${Date.now()}`, email: QA_EMAIL, role: "STUDENT" } });
    await prisma.client.studentProfile.create({
      data: { userId: user.id, fullName: "[QA TEST] Phase 8 Reviewer", age: 7, country: "EG", preferredLang: "ar", curriculumId: grade.curriculumId, gradeId: grade.id },
    });
    return { userId: user.id };
  });

  const aiUsageBefore = await withFreshApp((_svc, prisma) => prisma.client.aIUsage.count());

  const stepA = await withFreshApp((svc) => svc.advance(userId, TOPIC_ID)); // s1
  await withFreshApp((svc) => svc.advance(userId, TOPIC_ID)); // s2
  const stepB = await withFreshApp((svc) => svc.advance(userId, TOPIC_ID)); // s3 CHECK delivered
  const strategyAtB = await withFreshApp(async (_svc, prisma) => {
    const profile = await prisma.client.studentProfile.findUniqueOrThrow({ where: { userId } });
    const session = await prisma.client.lessonSession.findUniqueOrThrow({ where: { studentId_topicId: { studentId: profile.id, topicId: TOPIC_ID } } });
    const s3 = (session.stepResultsJson as any[]).find((r) => r.stepId === "s3");
    return { strategy: s3?.strategy, delivered: s3?.delivered };
  });
  log("A/B: START + REACH CONCEPTUAL CHECK", { stepA: { stepType: stepA.stepType, content: stepA.content }, stepB: { stepType: stepB.stepType, content: stepB.content, isCheckPending: stepB.isCheckPending }, strategyAtB });

  const stepC = await withFreshApp((svc) => svc.respond(userId, TOPIC_ID, "5")); // first wrong
  const strategyAtC = await withFreshApp(async (_svc, prisma) => {
    const profile = await prisma.client.studentProfile.findUniqueOrThrow({ where: { userId } });
    const session = await prisma.client.lessonSession.findUniqueOrThrow({ where: { studentId_topicId: { studentId: profile.id, topicId: TOPIC_ID } } });
    return (session.stepResultsJson as any[]).find((r) => r.stepId === "s3");
  });
  log("C: FIRST WRONG ANSWER ('5')", { response: stepC.content, s3State: strategyAtC });

  const stepD = await withFreshApp((svc) => svc.respond(userId, TOPIC_ID, "5")); // second wrong -> switch
  const strategyAtD = await withFreshApp(async (_svc, prisma) => {
    const profile = await prisma.client.studentProfile.findUniqueOrThrow({ where: { userId } });
    const session = await prisma.client.lessonSession.findUniqueOrThrow({ where: { studentId_topicId: { studentId: profile.id, topicId: TOPIC_ID } } });
    return { s3: (session.stepResultsJson as any[]).find((r) => r.stepId === "s3"), sessionStatus: session.status, currentStepIndex: session.currentStepIndex };
  });
  log("D: SECOND WRONG ANSWER ('5') — EXPECT SWITCH", { response: stepD.content, afterState: strategyAtD });

  const stepE = await withFreshApp((svc) => svc.respond(userId, TOPIC_ID, "اشرحلي تاني إزاي؟")); // clarifying question -> next teaching/help response under new strategy
  log("E: NEXT TEACHING/HELP RESPONSE (clarifying question, post-switch)", { response: stepE.content });

  const stepF = await withFreshApp((svc) => svc.respond(userId, TOPIC_ID, "4")); // correct
  const finalState = await withFreshApp(async (_svc, prisma) => {
    const profile = await prisma.client.studentProfile.findUniqueOrThrow({ where: { userId } });
    const session = await prisma.client.lessonSession.findUniqueOrThrow({ where: { studentId_topicId: { studentId: profile.id, topicId: TOPIC_ID } } });
    return { s3: (session.stepResultsJson as any[]).find((r) => r.stepId === "s3"), sessionCount: await prisma.client.lessonSession.count({ where: { topicId: TOPIC_ID } }) };
  });
  log("F: CORRECT ANSWER AFTER SWITCH ('4')", { response: stepF.content, finalState });

  const resumeCheck = await withFreshApp((svc) => svc.getState(userId, TOPIC_ID)); // fresh app context = resume
  log("RESUME CHECK (fresh app context)", resumeCheck);

  const aiUsageAfter = await withFreshApp(async (_svc, prisma) => {
    const profile = await prisma.client.studentProfile.findUniqueOrThrow({ where: { userId } });
    const rows = await prisma.client.aIUsage.findMany({ where: { studentId: profile.id }, orderBy: { createdAt: "asc" } });
    return { totalCountNow: await prisma.client.aIUsage.count(), thisStudentRows: rows };
  });
  log("AI USAGE", { before: aiUsageBefore, after: aiUsageAfter.totalCountNow, thisSessionRows: aiUsageAfter.thisStudentRows });
}

main().catch((err) => {
  console.error("PILOT SCRIPT FAILED:", err instanceof Error ? err.stack : err);
  process.exitCode = 1;
});

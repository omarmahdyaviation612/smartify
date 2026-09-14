/**
 * Phase 7: live QA of the published "Addition with Zero" topic through
 * the REAL InteractiveLessonService (advance/respond/getState) — the
 * exact same methods the HTTP controller calls. The only deviation from
 * a real browser session is the transport: this calls the service layer
 * directly instead of going through Express + ClerkAuthGuard, since
 * standing up a real Clerk-verified browser session for a disposable QA
 * account is not practical in this environment. Every AI call, DB write,
 * validator, and state transition below is the real, unmodified engine.
 *
 * Creates one clearly-labeled QA User + StudentProfile (not a Clerk
 * identity — clerkUserId is a disposable "qa-test-..." string). No
 * historical/lost identity is recreated. This script does not fix
 * anything it observes — see docs referenced in the Phase 7 report for
 * findings.
 */
import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { InteractiveLessonModule } from "../interactive-lesson/interactive-lesson.module";
import { InteractiveLessonService } from "../interactive-lesson/interactive-lesson.service";
import { PrismaService } from "../prisma/prisma.service";

const TOPIC_ID = "cmtyxp0ip0002okuh8z7ufitp";
const QA_EMAIL = "qa-phase7-addition-with-zero@smartify.test";

function log(tag: string, data: unknown) {
  console.log(`\n===== ${tag} =====`);
  console.log(JSON.stringify(data, null, 2));
}

async function withFreshApp<T>(fn: (svc: InteractiveLessonService, prisma: PrismaService) => Promise<T>): Promise<T> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["warn", "error"] });
  try {
    const svc = app.select(InteractiveLessonModule).get(InteractiveLessonService, { strict: false });
    const prisma = app.get(PrismaService);
    return await fn(svc, prisma);
  } finally {
    await app.close();
  }
}

async function main() {
  // ---- Part A: pre-flight + baseline ----
  const preflight = await withFreshApp(async (_svc, prisma) => {
    const topic = await prisma.client.topic.findUnique({ where: { id: TOPIC_ID } });
    const lesson = await prisma.client.lesson.findFirst({ where: { topicId: TOPIC_ID } });
    const objectives = lesson ? await prisma.client.learningObjective.count({ where: { lessonId: lesson.id } }) : 0;
    const draft = await prisma.client.lessonDraft.findFirst({ where: { publishedTopicId: TOPIC_ID } });
    return {
      topicExists: !!topic,
      stepCount: topic ? (topic.teachingStepsJson as any[]).length : 0,
      lessonExists: !!lesson,
      objectiveCount: objectives,
      draftStatus: draft?.status,
      draftLinkedToThisTopic: draft?.publishedTopicId === TOPIC_ID,
      baseline: {
        lessonSession: await prisma.client.lessonSession.count(),
        studentProgress: await prisma.client.studentProgress.count(),
        aiUsage: await prisma.client.aIUsage.count(),
        lessonVisualAsset: await prisma.client.lessonVisualAsset.count(),
      },
    };
  });
  log("PART A: PRE-FLIGHT", preflight);

  // ---- Part B: QA account ----
  const { userId, curriculumId, gradeId } = await withFreshApp(async (_svc, prisma) => {
    const unit = await prisma.client.unit.findFirstOrThrow({
      where: { nameEn: "Addition" },
      include: { subject: { include: { grade: true } } },
    });
    const grade = unit.subject.grade;
    const existing = await prisma.client.user.findUnique({ where: { email: QA_EMAIL } });
    if (existing) {
      const profile = await prisma.client.studentProfile.findUniqueOrThrow({ where: { userId: existing.id } });
      return { userId: existing.id, curriculumId: profile.curriculumId, gradeId: profile.gradeId };
    }
    const user = await prisma.client.user.create({
      data: { clerkUserId: `qa-test-phase7-${Date.now()}`, email: QA_EMAIL, role: "STUDENT" },
    });
    await prisma.client.studentProfile.create({
      data: {
        userId: user.id,
        fullName: "[QA TEST] Phase 7 Reviewer",
        age: 7,
        country: "EG",
        preferredLang: "ar",
        curriculumId: grade.curriculumId,
        gradeId: grade.id,
      },
    });
    return { userId: user.id, curriculumId: grade.curriculumId, gradeId: grade.id };
  });
  log("PART B: QA ACCOUNT", { userId, curriculumId, gradeId, email: QA_EMAIL });

  // ---- Part C/D: start + steps 1-3 ----
  const step1 = await withFreshApp((svc) => svc.advance(userId, TOPIC_ID));
  log("STEP 1 (INTRO) via advance()", step1);

  const step2 = await withFreshApp((svc) => svc.advance(userId, TOPIC_ID));
  log("STEP 2 (EXPLAIN) via advance()", step2);

  const step3 = await withFreshApp((svc) => svc.advance(userId, TOPIC_ID));
  log("STEP 3 (CHECK conceptual) via advance()", step3);

  // ---- Part F: step 3 wrong then correct ----
  const step3Wrong = await withFreshApp((svc) => svc.respond(userId, TOPIC_ID, "5"));
  log("STEP 3 WRONG RESPONSE ('5')", step3Wrong);

  const step3Correct = await withFreshApp((svc) =>
    svc.respond(userId, TOPIC_ID, "4 apples, because we didn't add any more, so it stays the same"),
  );
  log("STEP 3 CORRECT RESPONSE", step3Correct);

  // ---- Resume check #1: close/reopen app, re-fetch state, advance past resolved check ----
  const resume1 = await withFreshApp(async (svc, prisma) => {
    const state = await svc.getState(userId, TOPIC_ID);
    const sessionCountNow = await prisma.client.lessonSession.count();
    return { state, sessionCountNow };
  });
  log("RESUME CHECK #1 (fresh app context, getState)", resume1);

  const step4 = await withFreshApp((svc) => svc.advance(userId, TOPIC_ID));
  log("STEP 4 (EXAMPLE) via advance()", step4);

  const step5 = await withFreshApp((svc) => svc.advance(userId, TOPIC_ID));
  log("STEP 5 (CHECK applied) via advance()", step5);

  // ---- Part G: step 5 wrong then correct (deterministic) ----
  const step5Wrong = await withFreshApp((svc) => svc.respond(userId, TOPIC_ID, "6"));
  log("STEP 5 WRONG RESPONSE ('6')", step5Wrong);

  const step5Correct = await withFreshApp((svc) => svc.respond(userId, TOPIC_ID, "5"));
  log("STEP 5 CORRECT RESPONSE ('5')", step5Correct);

  // ---- Resume check #2 ----
  const resume2 = await withFreshApp(async (svc, prisma) => {
    const state = await svc.getState(userId, TOPIC_ID);
    const sessionCountNow = await prisma.client.lessonSession.count();
    return { state, sessionCountNow };
  });
  log("RESUME CHECK #2 (fresh app context, getState)", resume2);

  const step6 = await withFreshApp((svc) => svc.advance(userId, TOPIC_ID));
  log("STEP 6 (REVIEW) via advance()", step6);

  const step7 = await withFreshApp((svc) => svc.advance(userId, TOPIC_ID));
  log("STEP 7 (COMPLETE) via advance()", step7);

  const completionAdvance = await withFreshApp((svc) => svc.advance(userId, TOPIC_ID));
  log("POST-COMPLETION advance() (should be idempotent, session already COMPLETED)", completionAdvance);

  // ---- Part J: completion/progress verification ----
  const finalState = await withFreshApp(async (_svc, prisma) => {
    const session = await prisma.client.lessonSession.findUnique({ where: { studentId_topicId: { studentId: (await prisma.client.studentProfile.findUniqueOrThrow({ where: { userId } })).id, topicId: TOPIC_ID } } });
    const lesson = await prisma.client.lesson.findFirstOrThrow({ where: { topicId: TOPIC_ID } });
    const progress = await prisma.client.studentProgress.findMany({ where: { lessonId: lesson.id } });
    const sessionCount = await prisma.client.lessonSession.count();
    const otherTopicsTouched = await prisma.client.studentProgress.count({ where: { lessonId: { not: lesson.id } } });
    return { session, progress, sessionCount, otherTopicsTouched };
  });
  log("PART J: FINAL SESSION/PROGRESS STATE", finalState);

  // ---- Part L: AI usage ledger for this QA student ----
  const aiUsage = await withFreshApp(async (_svc, prisma) => {
    const profile = await prisma.client.studentProfile.findUniqueOrThrow({ where: { userId } });
    const rows = await prisma.client.aIUsage.findMany({ where: { studentId: profile.id }, orderBy: { createdAt: "asc" } });
    const totalUsageCount = await prisma.client.aIUsage.count();
    const visualAssetCount = await prisma.client.lessonVisualAsset.count();
    return { rows, totalUsageCountNow: totalUsageCount, visualAssetCountNow: visualAssetCount };
  });
  log("PART L: AI USAGE LEDGER", aiUsage);
}

main().catch((err) => {
  console.error("QA SCRIPT FAILED:", err instanceof Error ? err.stack : err);
  process.exitCode = 1;
});

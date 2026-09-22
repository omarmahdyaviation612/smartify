import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@smartify/database";
import { PrismaService } from "../prisma/prisma.service";
import { TopicAccuracyService } from "../analytics/topic-accuracy.service";
import { QuestionDraftGeneratorService } from "../question-bank/question-draft-generator/question-draft-generator.service";
import { EmailService } from "../email/email.service";
import { shuffleQuestionPool } from "./shuffle-question-pool";
import { TrialService } from "../trial/trial.service";
import { hasSubjectEntitlementInList } from "../common/subject-entitlement.util";

type QuizType = "topic_assessment" | "mock_exam" | "lesson_check";

// Deliberately small — a "did you understand the lesson" spot-check, not a
// full assessment (that's what topic_assessment is for). 3 keeps the pool
// requirement realistic (ensurePoolForTopic's default target is 8) and the
// check itself quick right after finishing a lesson.
const LESSON_CHECK_QUESTION_COUNT = 3;

@Injectable()
export class QuizzesService {
  private readonly logger = new Logger(QuizzesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly topicAccuracy: TopicAccuracyService,
    private readonly questionGenerator: QuestionDraftGeneratorService,
    private readonly emailService: EmailService,
    // Defaulted (not required) so every existing direct `new
    // QuizzesService(...)` test construction keeps working unchanged —
    // see PracticeService's identical pattern for the rationale.
    private readonly trialService: TrialService = new TrialService(prisma),
  ) {}

  private async getProfileOrThrow(userId: string) {
    const profile = await this.prisma.client.studentProfile.findUnique({
      where: { userId },
      include: { subjects: true },
    });
    if (!profile) throw new NotFoundException("Complete onboarding before taking a quiz.");
    return profile;
  }

  private hasOwnedAccess(profile: { subjects: Array<{ subjectId: string; expiresAt?: Date | null }> }, subjectId: string): boolean {
    return hasSubjectEntitlementInList(profile.subjects, subjectId);
  }

  /**
   * Free Trial V1 (2026-09-20): a non-owned Subject/Topic is still
   * allowed through for "lesson_check"/"topic_assessment" (both always
   * carry a topicId) when it's the EXACT Topic the student's one free
   * trial lesson in that Subject was used on — "mock_exam" (whole-subject,
   * no topicId) is never trial-bypassable.
   */
  private async assertSubjectAccessible(profile: { id: string; subjects: Array<{ subjectId: string; expiresAt?: Date | null }> }, subjectId: string, topicId?: string) {
    if (this.hasOwnedAccess(profile, subjectId)) return;
    if (topicId && (await this.trialService.isTopicTrialAccessible(profile.id, subjectId, topicId))) return;
    throw new ForbiddenException("This subject is not part of your selected subjects.");
  }

  /**
   * Returns quiz questions WITHOUT correct answers — mirrors the same
   * stateless pattern as the onboarding diagnostic (see
   * onboarding.service.ts): no server-side "in-progress quiz" row is
   * created. The client holds the question set locally and submits
   * everything together via submitQuiz(), which is the only place
   * grading and QuizResult creation happen.
   *
   * Phase 10E hardening:
   *  - isPlaceholder: false is load-bearing (same rationale as the
   *    diagnostic's own filter, Phase 10D.1) — seed/demo placeholder
   *    content must never reach a real assessment flow.
   *  - the eligible pool is shuffled BEFORE `take` questions are sliced
   *    off, so repeated requests don't deterministically return the same
   *    first N rows just because DB order happens to be stable (Phase
   *    10D finding). `rng` is injectable for deterministic tests only —
   *    production callers always get the default Math.random.
   *  - the response now also reports requestedCount/availableCount/
   *    returnedCount/isFullAssessment so a caller can tell an undersized
   *    pool apart from a full assessment, rather than silently returning
   *    fewer questions and looking identical to a real 8/20-question quiz.
   *    Purely additive — existing clients reading only `.questions` are
   *    unaffected.
   */
  async getQuizQuestions(userId: string, subjectId: string, type: QuizType, topicId?: string, rng: () => number = Math.random) {
    const profile = await this.getProfileOrThrow(userId);

    if ((type === "topic_assessment" || type === "lesson_check") && !topicId) {
      throw new BadRequestException(`topicId is required for a ${type === "lesson_check" ? "lesson check" : "topic assessment"}.`);
    }
    // mock_exam never carries a topicId, so it's never trial-bypassable —
    // assertSubjectAccessible's own topicId-required check enforces that.
    await this.assertSubjectAccessible(profile, subjectId, topicId);

    const topicWhere = type === "mock_exam" ? { unit: { subjectId } } : { id: topicId, unit: { subjectId } };
    const topics = await this.prisma.client.topic.findMany({ where: topicWhere });
    if (topics.length === 0) throw new BadRequestException("No topics found for this quiz.");

    // Launch-speed lazy-generation path (2026-09-19): only for a single-
    // topic assessment/check — a mock_exam spans a whole subject's worth
    // of topics, and generating pools for all of them synchronously here
    // would make the request itself the bottleneck. No-op once a pool
    // exists, never throws.
    if (type !== "mock_exam" && topicId) await this.questionGenerator.ensurePoolForTopic(topicId, userId);

    const requestedCount = type === "mock_exam" ? 20 : type === "lesson_check" ? LESSON_CHECK_QUESTION_COUNT : 8;
    const eligible = await this.prisma.client.question.findMany({
      where: { topicId: { in: topics.map((t) => t.id) }, isPlaceholder: false },
      select: {
        id: true,
        topicId: true,
        type: true,
        difficulty: true,
        promptEn: true,
        promptAr: true,
        optionsJson: true,
        isPlaceholder: true,
      },
    });

    const questions = shuffleQuestionPool(eligible, rng).slice(0, requestedCount);

    return {
      quizType: type,
      subjectId,
      topicId: topicId ?? null,
      questions,
      requestedCount,
      availableCount: eligible.length,
      returnedCount: questions.length,
      isFullAssessment: questions.length === requestedCount,
    };
  }

  async submitQuiz(
    userId: string,
    input: { subjectId: string; type: QuizType; topicId?: string; answers: Array<{ questionId: string; answer: unknown }> },
  ) {
    const profile = await this.getProfileOrThrow(userId);
    await this.assertSubjectAccessible(profile, input.subjectId, input.topicId);
    if (input.answers.length === 0) throw new BadRequestException("No answers submitted.");

    // topic: { include: { unit: {...} } } still fetches all of topic's own
    // scalar fields (nameEn/nameAr, used in the breakdown below) exactly
    // as the previous `topic: true` did — this only ADDS unit.subjectId,
    // the one real source of truth for a Question's Subject. One query,
    // not one per question.
    const questions = await this.prisma.client.question.findMany({
      where: { id: { in: input.answers.map((a) => a.questionId) } },
      include: { topic: { include: { unit: { select: { subjectId: true } } } } },
    });
    const questionById = new Map(questions.map((q) => [q.id, q]));

    // Scope validation BEFORE any write (QuestionAttempt/QuizResult/parent
    // email). assertSubjectOwned above only proved input.subjectId itself
    // is owned — it says nothing about whether the submitted questions
    // actually belong to it. An unresolved questionId is not a scope
    // violation here — it's silently skipped below, exactly as before
    // this task.
    for (const a of input.answers) {
      const q = questionById.get(a.questionId);
      if (!q) continue;
      if (q.topic.unit.subjectId !== input.subjectId) {
        throw new ForbiddenException("One or more submitted questions are not part of this subject.");
      }
    }

    const breakdown: Array<{
      questionId: string;
      promptEn: string;
      isCorrect: boolean;
      yourAnswer: unknown;
      correctAnswer: unknown;
      explanationEn: string | null;
      explanationAr: string | null;
      topicNameEn: string;
      topicNameAr: string;
    }> = [];
    const attemptRows: Array<{ studentId: string; questionId: string; answerJson: any; isCorrect: boolean; source: string }> = [];

    for (const a of input.answers) {
      const q = questionById.get(a.questionId);
      if (!q) continue;
      const isCorrect = JSON.stringify(q.correctAnswerJson) === JSON.stringify(a.answer);
      attemptRows.push({ studentId: profile.id, questionId: q.id, answerJson: a.answer, isCorrect, source: "quiz" });
      breakdown.push({
        questionId: q.id,
        promptEn: q.promptEn,
        isCorrect,
        yourAnswer: a.answer,
        correctAnswer: q.correctAnswerJson,
        explanationEn: q.explanationEn,
        explanationAr: q.explanationAr,
        topicNameEn: q.topic.nameEn,
        topicNameAr: q.topic.nameAr,
      });
    }

    await this.prisma.client.questionAttempt.createMany({ data: attemptRows });

    const correctCount = breakdown.filter((b) => b.isCorrect).length;
    const score = Math.round((correctCount / breakdown.length) * 100);

    // Weak topics WITHIN this quiz (for immediate feedback) — distinct from
    // the dashboard's all-time weak topics, though both use the same
    // underlying accuracy definition via TopicAccuracyService for consistency.
    const perTopicInQuiz = new Map<string, { nameEn: string; nameAr: string; correct: number; total: number }>();
    for (const b of breakdown) {
      const entry = perTopicInQuiz.get(b.topicNameEn) ?? { nameEn: b.topicNameEn, nameAr: b.topicNameAr, correct: 0, total: 0 };
      entry.total += 1;
      if (b.isCorrect) entry.correct += 1;
      perTopicInQuiz.set(b.topicNameEn, entry);
    }
    const weakTopicsInQuiz = Array.from(perTopicInQuiz.values())
      .map((t) => ({ ...t, percent: Math.round((t.correct / t.total) * 100) }))
      .filter((t) => t.percent < 60)
      .sort((a, b) => a.percent - b.percent);

    const recommendedNextSteps =
      weakTopicsInQuiz.length > 0
        ? weakTopicsInQuiz.slice(0, 3).map((t) => `Review "${t.nameEn}" (${t.percent}% on this quiz)`)
        : ["Nice work — no weak topics identified on this quiz."];

    const resultJson = { breakdown, weakTopicsInQuiz, recommendedNextSteps };

    const quizResult = await this.prisma.client.quizResult.create({
      data: {
        studentId: profile.id,
        quizType: input.type,
        topicId: input.type === "lesson_check" ? (input.topicId ?? null) : null,
        score,
        totalQuestions: breakdown.length,
        correctCount,
        resultJson: resultJson as Prisma.InputJsonValue,
      },
    });

    // Launch-speed addition (2026-09-19): the one place a "lesson_check"
    // result triggers a parent-notification email — every other quiz type
    // (Practice's own topic_assessment, mock_exam) is student-initiated and
    // deliberately does NOT notify a parent, matching what was actually
    // asked for ("after each lesson, a simple check, and the RESULT of
    // that goes to the parent") rather than every quiz a student takes.
    let parentsNotified = 0;
    if (input.type === "lesson_check" && breakdown.length > 0) {
      parentsNotified = await this.notifyParentsOfLessonCheck(profile, {
        topicNameEn: breakdown[0].topicNameEn,
        topicNameAr: breakdown[0].topicNameAr,
        score,
        correctCount,
        total: breakdown.length,
      });
    }

    return { id: quizResult.id, score, correctCount, total: breakdown.length, parentsNotified, ...resultJson };
  }

  /**
   * Best-effort — a parent with no email on file can't happen (User.email
   * is required/unique), but a Resend outage or missing API key must never
   * fail the student's own quiz submission response. Returns how many
   * parents were actually emailed, purely for the frontend to show (or not
   * show) a "sent to your parent" confirmation.
   */
  private async notifyParentsOfLessonCheck(
    profile: { id: string; fullName: string },
    check: { topicNameEn: string; topicNameAr: string; score: number; correctCount: number; total: number },
  ): Promise<number> {
    const relations = await this.prisma.client.parentStudentRelation.findMany({
      where: { studentId: profile.id },
      include: { parent: { include: { user: { select: { email: true } } } } },
    });
    if (relations.length === 0) return 0;

    let sentCount = 0;
    for (const relation of relations) {
      const to = relation.parent.user.email;
      const subject = `${profile.fullName} finished a lesson: ${check.topicNameEn}`;
      const html = [
        `<p>Hi ${relation.parent.fullName},</p>`,
        `<p><strong>${profile.fullName}</strong> just finished the lesson "<strong>${check.topicNameEn}</strong>" (${check.topicNameAr}) and completed a short understanding check.</p>`,
        `<p>Result: <strong>${check.correctCount} / ${check.total}</strong> correct (${check.score}%).</p>`,
        `<p>— Smartify AI</p>`,
      ].join("\n");
      const result = await this.emailService.send({ to, subject, html }).catch((err) => {
        this.logger.warn(`Lesson-check email failed for parent ${relation.parentId}: ${err instanceof Error ? err.message : String(err)}`);
        return { sent: false };
      });
      if (result.sent) sentCount++;
    }
    return sentCount;
  }

  async getResult(userId: string, quizResultId: string) {
    const profile = await this.getProfileOrThrow(userId);
    const result = await this.prisma.client.quizResult.findUnique({ where: { id: quizResultId } });
    if (!result || result.studentId !== profile.id) throw new NotFoundException("Quiz result not found.");
    return result;
  }

  async listResults(userId: string) {
    const profile = await this.getProfileOrThrow(userId);
    return this.prisma.client.quizResult.findMany({
      where: { studentId: profile.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, quizType: true, score: true, totalQuestions: true, correctCount: true, createdAt: true },
    });
  }
}

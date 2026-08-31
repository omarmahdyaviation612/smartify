import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@smartify/database";
import { PrismaService } from "../prisma/prisma.service";
import { TopicAccuracyService } from "../analytics/topic-accuracy.service";

type QuizType = "topic_assessment" | "mock_exam";

@Injectable()
export class QuizzesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly topicAccuracy: TopicAccuracyService,
  ) {}

  private async getProfileOrThrow(userId: string) {
    const profile = await this.prisma.client.studentProfile.findUnique({
      where: { userId },
      include: { subjects: true },
    });
    if (!profile) throw new NotFoundException("Complete onboarding before taking a quiz.");
    return profile;
  }

  private assertSubjectOwned(profile: { subjects: Array<{ subjectId: string }> }, subjectId: string) {
    if (!profile.subjects.some((s) => s.subjectId === subjectId)) {
      throw new ForbiddenException("This subject is not part of your selected subjects.");
    }
  }

  /**
   * Returns quiz questions WITHOUT correct answers — mirrors the same
   * stateless pattern as the onboarding diagnostic (see
   * onboarding.service.ts): no server-side "in-progress quiz" row is
   * created. The client holds the question set locally and submits
   * everything together via submitQuiz(), which is the only place
   * grading and QuizResult creation happen.
   */
  async getQuizQuestions(userId: string, subjectId: string, type: QuizType, topicId?: string) {
    const profile = await this.getProfileOrThrow(userId);
    this.assertSubjectOwned(profile, subjectId);

    if (type === "topic_assessment" && !topicId) {
      throw new BadRequestException("topicId is required for a topic assessment.");
    }

    const topicWhere = type === "topic_assessment" ? { id: topicId, unit: { subjectId } } : { unit: { subjectId } };
    const topics = await this.prisma.client.topic.findMany({ where: topicWhere });
    if (topics.length === 0) throw new BadRequestException("No topics found for this quiz.");

    const take = type === "mock_exam" ? 20 : 8;
    const questions = await this.prisma.client.question.findMany({
      where: { topicId: { in: topics.map((t) => t.id) } },
      take,
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

    return { quizType: type, subjectId, topicId: topicId ?? null, questions };
  }

  async submitQuiz(
    userId: string,
    input: { subjectId: string; type: QuizType; topicId?: string; answers: Array<{ questionId: string; answer: unknown }> },
  ) {
    const profile = await this.getProfileOrThrow(userId);
    this.assertSubjectOwned(profile, input.subjectId);
    if (input.answers.length === 0) throw new BadRequestException("No answers submitted.");

    const questions = await this.prisma.client.question.findMany({
      where: { id: { in: input.answers.map((a) => a.questionId) } },
      include: { topic: true },
    });
    const questionById = new Map(questions.map((q) => [q.id, q]));

    const breakdown: Array<{
      questionId: string;
      promptEn: string;
      isCorrect: boolean;
      yourAnswer: unknown;
      correctAnswer: unknown;
      explanationEn: string | null;
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
        score,
        totalQuestions: breakdown.length,
        correctCount,
        resultJson: resultJson as Prisma.InputJsonValue,
      },
    });

    return { id: quizResult.id, score, correctCount, total: breakdown.length, ...resultJson };
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

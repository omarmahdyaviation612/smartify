import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TopicAccuracyService } from "../analytics/topic-accuracy.service";
import { Difficulty } from "@smartify/shared-types";
import { pickDifficultyWeights } from "./difficulty-weights";

@Injectable()
export class PracticeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly topicAccuracy: TopicAccuracyService,
  ) {}

  private async getProfileOrThrow(userId: string) {
    const profile = await this.prisma.client.studentProfile.findUnique({
      where: { userId },
      include: { subjects: true },
    });
    if (!profile) throw new NotFoundException("Complete onboarding before practicing.");
    return profile;
  }

  private assertSubjectOwned(profile: { subjects: Array<{ subjectId: string }> }, subjectId: string) {
    if (!profile.subjects.some((s) => s.subjectId === subjectId)) {
      throw new ForbiddenException("This subject is not part of your selected subjects.");
    }
  }

  /** Topics for a subject, annotated with the student's real accuracy so the UI can highlight weak spots. */
  async getTopicsForSubject(userId: string, subjectId: string) {
    const profile = await this.getProfileOrThrow(userId);
    this.assertSubjectOwned(profile, subjectId);

    const topics = await this.prisma.client.topic.findMany({
      where: { unit: { subjectId } },
      orderBy: { order: "asc" },
    });
    const accuracy = await this.topicAccuracy.getPerTopicAccuracy(profile.id, [subjectId]);
    const accuracyByTopic = new Map(accuracy.map((a) => [a.topicId, a.percent]));

    return topics.map((t) => ({
      id: t.id,
      nameEn: t.nameEn,
      nameAr: t.nameAr,
      accuracyPercent: accuracyByTopic.get(t.id) ?? null,
    }));
  }

  // Rule-based adaptive difficulty selection lives in ./difficulty-weights.ts
  // (extracted as a pure function so it's independently unit-testable —
  // see difficulty-weights.spec.ts). See 07-phase7-decisions.md for why
  // this is a rule-based lookup rather than an AI call.

  async getAdaptiveQuestions(userId: string, subjectId: string, topicId: string | undefined, count = 8) {
    const profile = await this.getProfileOrThrow(userId);
    this.assertSubjectOwned(profile, subjectId);

    const topicWhere = topicId ? { id: topicId, unit: { subjectId } } : { unit: { subjectId } };
    const topics = await this.prisma.client.topic.findMany({ where: topicWhere });
    if (topics.length === 0) throw new BadRequestException("No topics found for this selection.");

    const topicIds = topics.map((t) => t.id);
    const avgAccuracy =
      topicId != null
        ? await this.topicAccuracy.getTopicAccuracy(profile.id, topicId)
        : (await this.topicAccuracy.getPerTopicAccuracy(profile.id, [subjectId]))
            .filter((a) => topicIds.includes(a.topicId))
            .reduce<number | null>((acc, t, _i, arr) => (acc ?? 0) + t.percent / arr.length, null);

    const weights = pickDifficultyWeights(avgAccuracy);
    const allQuestions = await this.prisma.client.question.findMany({
      where: { topicId: { in: topicIds } },
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

    // Weighted random sample without replacement, honoring difficulty weights loosely.
    const byDifficulty: Record<string, typeof allQuestions> = { EASY: [], MEDIUM: [], HARD: [] };
    for (const q of allQuestions) byDifficulty[q.difficulty].push(q);

    const selected: typeof allQuestions = [];
    const difficulties = Object.keys(weights) as Difficulty[];
    while (selected.length < count && allQuestions.length > selected.length) {
      const roll = Math.random();
      let cumulative = 0;
      let chosenDifficulty: Difficulty = difficulties[0];
      for (const d of difficulties) {
        cumulative += weights[d];
        if (roll <= cumulative) {
          chosenDifficulty = d;
          break;
        }
      }
      const pool = byDifficulty[chosenDifficulty].filter((q) => !selected.includes(q));
      const fallbackPool = pool.length > 0 ? pool : allQuestions.filter((q) => !selected.includes(q));
      if (fallbackPool.length === 0) break;
      selected.push(fallbackPool[Math.floor(Math.random() * fallbackPool.length)]);
    }

    return { averageAccuracy: avgAccuracy, questions: selected };
  }

  async submitPractice(userId: string, answers: Array<{ questionId: string; answer: unknown }>) {
    const profile = await this.getProfileOrThrow(userId);
    if (answers.length === 0) throw new BadRequestException("No answers submitted.");

    const questions = await this.prisma.client.question.findMany({
      where: { id: { in: answers.map((a) => a.questionId) } },
    });
    const questionById = new Map(questions.map((q) => [q.id, q]));

    const feedback: Array<{ questionId: string; isCorrect: boolean; correctAnswer: unknown; explanationEn: string | null }> = [];
    const attemptRows: Array<{ studentId: string; questionId: string; answerJson: any; isCorrect: boolean; source: string }> = [];

    for (const a of answers) {
      const q = questionById.get(a.questionId);
      if (!q) continue;
      const isCorrect = JSON.stringify(q.correctAnswerJson) === JSON.stringify(a.answer);
      attemptRows.push({ studentId: profile.id, questionId: q.id, answerJson: a.answer, isCorrect, source: "practice" });
      feedback.push({ questionId: q.id, isCorrect, correctAnswer: q.correctAnswerJson, explanationEn: q.explanationEn });
    }

    await this.prisma.client.questionAttempt.createMany({ data: attemptRows });

    const correctCount = feedback.filter((f) => f.isCorrect).length;
    return { correctCount, total: feedback.length, feedback };
  }
}

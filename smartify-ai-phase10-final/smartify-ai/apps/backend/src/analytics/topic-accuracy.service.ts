import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface TopicAccuracy {
  topicId: string;
  nameEn: string;
  nameAr: string;
  subjectId: string;
  subjectNameEn: string;
  subjectNameAr: string;
  correct: number;
  total: number;
  percent: number;
}

/**
 * Shared per-topic accuracy computation from real QuestionAttempt data —
 * used by the dashboard (weak-topic widget), the practice engine (to
 * pick adaptive difficulty), and quizzes (to compute weak-topic results).
 * Extracted here once so the definition of "accuracy" and "weak" can't
 * drift between those three call sites.
 */
@Injectable()
export class TopicAccuracyService {
  constructor(private readonly prisma: PrismaService) {}

  async getPerTopicAccuracy(studentId: string, subjectIds?: string[]): Promise<TopicAccuracy[]> {
    const attempts = await this.prisma.client.questionAttempt.findMany({
      where: { studentId },
      include: {
        question: { include: { topic: { include: { unit: { include: { subject: true } } } } } },
      },
    });

    const stats = new Map<string, TopicAccuracy>();
    for (const a of attempts) {
      const topic = a.question.topic;
      const subject = topic.unit.subject;
      if (subjectIds && !subjectIds.includes(subject.id)) continue;

      const entry =
        stats.get(topic.id) ??
        ({
          topicId: topic.id,
          nameEn: topic.nameEn,
          nameAr: topic.nameAr,
          subjectId: subject.id,
          subjectNameEn: subject.nameEn,
          subjectNameAr: subject.nameAr,
          correct: 0,
          total: 0,
          percent: 0,
        } as TopicAccuracy);

      entry.total += 1;
      if (a.isCorrect) entry.correct += 1;
      stats.set(topic.id, entry);
    }

    return Array.from(stats.values())
      .map((s) => ({ ...s, percent: Math.round((s.correct / s.total) * 100) }))
      .sort((a, b) => a.percent - b.percent);
  }

  /** Convenience: accuracy for a single topic, or null if the student hasn't attempted anything there yet. */
  async getTopicAccuracy(studentId: string, topicId: string): Promise<number | null> {
    const attempts = await this.prisma.client.questionAttempt.findMany({
      where: { studentId, question: { topicId } },
    });
    if (attempts.length === 0) return null;
    const correct = attempts.filter((a) => a.isCorrect).length;
    return Math.round((correct / attempts.length) * 100);
  }
}

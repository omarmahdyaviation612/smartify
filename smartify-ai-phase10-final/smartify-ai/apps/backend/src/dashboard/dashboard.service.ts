import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TopicAccuracyService } from "../analytics/topic-accuracy.service";

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly topicAccuracy: TopicAccuracyService,
  ) {}

  /**
   * Dashboard summary — deliberately returns null/empty for anything not
   * yet actually implemented (streaks, weekly study time, achievements,
   * upcoming exams, AI tutor) rather than a plausible-looking fake value.
   * The frontend renders those as explicit "coming soon" states. Only
   * profile, subjects, diagnostic-derived progress, weak topics, the
   * initial rule-based plan, and real recent activity are populated here.
   */
  async getSummary(userId: string) {
    const profile = await this.prisma.client.studentProfile.findUnique({
      where: { userId },
      include: {
        curriculum: true,
        grade: true,
        subjects: { include: { subject: true } },
        learningPlans: { where: { isActive: true }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    if (!profile) {
      throw new NotFoundException("No student profile yet — complete onboarding first.");
    }

    const latestAssessment = await this.prisma.client.assessment.findFirst({
      where: { studentId: profile.id, type: "diagnostic" },
      orderBy: { createdAt: "desc" },
    });

    // Per-topic accuracy from real QuestionAttempt data, used to surface
    // weak topics. Empty until the student has actually answered questions
    // (diagnostic or practice) — no synthetic topics are ever invented.
    const subjectIds = profile.subjects.map((s) => s.subjectId);
    const topicStats = await this.topicAccuracy.getPerTopicAccuracy(profile.id, subjectIds);
    const weakTopics = topicStats.filter((t) => t.percent < 60).slice(0, 5);

    const attempts = await this.prisma.client.questionAttempt.findMany({
      where: { studentId: profile.id },
      orderBy: { attemptedAt: "desc" },
      take: 5,
      include: {
        question: { include: { topic: { include: { unit: { include: { subject: true } } } } } },
      },
    });

    const recentActivity = attempts.slice(0, 5).map((a) => ({
      questionPromptEn: a.question.promptEn,
      questionPromptAr: a.question.promptAr,
      subjectNameEn: a.question.topic.unit.subject.nameEn,
      subjectNameAr: a.question.topic.unit.subject.nameAr,
      isCorrect: a.isCorrect,
      attemptedAt: a.attemptedAt,
    }));

    // Phase 4: the small multi-topic Interactive Lesson pilot. Every
    // interactive topic in the system today belongs to this one pilot (a
    // handful of rows total), so listing them all directly is correct and
    // far simpler than wiring proper StudentSubject-based scoping for a
    // set this small — that scoping belongs to a later phase once
    // interactive topics actually span more than one pilot subject.
    // Prisma's JSON-column null filters need the Prisma.JsonNull sentinel,
    // not a plain `null`, to distinguish SQL NULL from a JSON "null" value —
    // simplest to just filter in JS instead of fighting that at the query
    // level; ~50 topics total at this pilot's scale, cheap either way.
    const allTopics = await this.prisma.client.topic.findMany({
      include: { unit: true },
      orderBy: [{ unit: { order: "asc" } }, { order: "asc" }],
    });
    const interactiveTopics = allTopics.filter((t) => t.teachingStepsJson !== null);
    const interactiveTopicIds = interactiveTopics.map((t) => t.id);
    const sessions = interactiveTopicIds.length
      ? await this.prisma.client.lessonSession.findMany({
          where: { studentId: profile.id, topicId: { in: interactiveTopicIds } },
        })
      : [];
    const sessionByTopic = new Map(sessions.map((s) => [s.topicId, s]));
    const pilotLessons = interactiveTopics.map((t) => ({
      topicId: t.id,
      nameEn: t.nameEn,
      nameAr: t.nameAr,
      unitNameEn: t.unit.nameEn,
      unitNameAr: t.unit.nameAr,
      status: sessionByTopic.get(t.id)?.status ?? "NOT_STARTED",
    }));

    return {
      fullName: profile.fullName,
      curriculum: { nameEn: profile.curriculum.nameEn, nameAr: profile.curriculum.nameAr },
      grade: { nameEn: profile.grade.nameEn, nameAr: profile.grade.nameAr },
      subjects: profile.subjects.map((s) => ({ id: s.subject.id, nameEn: s.subject.nameEn, nameAr: s.subject.nameAr })),
      diagnosticScore: (latestAssessment?.scoreJson as any) ?? null,
      recommendedFocus: (profile.learningPlans[0]?.planJson as any)?.recommendedFocus ?? null,
      weakTopics,
      recentActivity,
      pilotLessons,
      // Explicitly not-yet-implemented — see class docstring.
      streak: null,
      weeklyStudyMinutes: null,
      achievements: [],
      upcomingExams: [],
      aiTutorAvailable: true, // Phase 6: the Tutor endpoint now exists — see apps/backend/src/tutor
    };
  }
}

import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TopicAccuracyService } from "../analytics/topic-accuracy.service";
import { isTestStudent, subjectDiscoveryWhere } from "../common/subject-access";
import { hasSubjectEntitlementInList } from "../common/subject-entitlement.util";

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
        user: { select: { role: true, isTestStudent: true } },
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
    const publishedSubjects = await this.prisma.client.subject.findMany({ where: subjectDiscoveryWhere(profile), orderBy: { nameEn: "asc" } });
    const subjects = publishedSubjects.map((subject) => ({ id: subject.id, nameEn: subject.nameEn, nameAr: subject.nameAr,
      entitlement: isTestStudent(profile) || hasSubjectEntitlementInList(profile.subjects, subject.id) ? "ACTIVE" as const : "LOCKED" as const }));
    const subjectIds = subjects.filter(s => s.entitlement === "ACTIVE").map(s => s.id);
    const topicStats = await this.topicAccuracy.getPerTopicAccuracy(profile.id, subjectIds);
    const weakTopics = topicStats.filter((t) => t.percent < 60).slice(0, 5);

    const attempts = await this.prisma.client.questionAttempt.findMany({
      where: { studentId: profile.id, question: { topic: { unit: { subjectId: { in: subjectIds } } } } },
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

    // Phase 10C: scoped strictly to the student's own selected subjects —
    // and, defensively, to their own grade too (never trusting subjectIds
    // alone to already be grade-correct, in case a future bug elsewhere
    // ever lets a StudentSubject point at the wrong grade's subject).
    // Relational IDs only, never a name match. `subjectIds` empty (no
    // subjects selected yet) naturally yields zero topics via `{ in: [] }`
    // — no separate "incomplete profile" branch needed; this is the
    // fail-closed behavior by construction, not a special case.
    //
    // Prisma's JSON-column null filters need the Prisma.JsonNull sentinel,
    // not a plain `null`, to distinguish SQL NULL from a JSON "null" value —
    // simplest to just filter in JS instead of fighting that at the query
    // level; cheap at this scale either way.
    const allTopics = await this.prisma.client.topic.findMany({
      where: { unit: { subjectId: { in: subjectIds }, subject: { gradeId: profile.gradeId } } },
      include: { unit: true },
      orderBy: [{ unit: { order: "asc" } }, { order: "asc" }],
    });
    // Launch-speed lazy-generation path (2026-09-19): this used to filter
    // to `teachingStepsJson !== null` — i.e. only topics someone had
    // ALREADY opened once before. That made every topic invisible here
    // until it was already generated, which nothing but this same list
    // could ever trigger — a real student had no way to discover or start
    // any lesson beyond the handful already seeded with content. Every
    // real Topic (not just already-generated ones) is listed now; opening
    // one via its Lesson link is exactly what triggers
    // InteractiveLessonService.ensureTopicHasSteps() to generate it on
    // the spot.
    const allTopicIds = allTopics.map((t) => t.id);
    const sessions = allTopicIds.length
      ? await this.prisma.client.lessonSession.findMany({
          where: { studentId: profile.id, topicId: { in: allTopicIds } },
        })
      : [];
    const sessionByTopic = new Map(sessions.map((s) => [s.topicId, s]));
    const pilotLessons = allTopics.map((t) => ({
      topicId: t.id,
      subjectId: t.unit.subjectId, // lets the frontend group/filter this flat list by subject — see `subjects` above for id -> name
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
      subjects,
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

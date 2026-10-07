import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { TopicAccuracyService } from "../analytics/topic-accuracy.service";
import { AIUsageService } from "../ai/usage/ai-usage.service";

@Injectable()
export class ParentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly topicAccuracy: TopicAccuracyService,
    private readonly aiUsage: AIUsageService,
  ) {}
  private get db(): any { return this.prisma.client as any; }

  async bootstrapProfile(userId: string, fullName: string) {
    if (!fullName?.trim()) throw new BadRequestException("A parent name is required.");
    return this.db.parentProfile.upsert({
      where: { userId },
      update: { fullName: fullName.trim() },
      create: { userId, fullName: fullName.trim() },
    });
  }

  async createStudentCode(userId: string) {
    const student = await this.db.studentProfile.findUnique({ where: { userId } });
    if (!student) throw new NotFoundException("Complete student onboarding before linking a parent.");
    const code = randomBytes(5).toString("hex").toUpperCase();
    const invitation = await this.db.parentLinkInvitation.create({
      data: { code, studentId: student.id, createdByUserId: userId, expiresAt: new Date(Date.now() + 7 * 86400000) },
    });
    return { code: invitation.code, expiresAt: invitation.expiresAt };
  }

  async acceptCode(userId: string, rawCode: string) {
    const code = rawCode?.trim().toUpperCase();
    if (!code) throw new BadRequestException("A link code is required.");
    return this.db.$transaction(async (tx: any) => {
      const now = new Date();
      const invitation = await tx.parentLinkInvitation.findUnique({ where: { code } });
      if (!invitation || invitation.usedAt || invitation.expiresAt <= now) {
        throw new BadRequestException("This link code is invalid or expired.");
      }
      if (invitation.createdByUserId === userId) throw new BadRequestException("You cannot link your own account.");

      const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true, email: true } });
      if (!user || !["STUDENT", "PARENT"].includes(user.role)) {
        throw new BadRequestException("This invitation can only be used by a parent account.");
      }

      // Do not convert an account that already owns a student profile. This
      // lets newly invited users (whose default role is STUDENT) become
      // parents without taking over an active student account.
      if (user.role === "STUDENT") {
        const studentProfile = await tx.studentProfile.findUnique({ where: { userId }, select: { id: true } });
        if (studentProfile) throw new BadRequestException("Use a separate parent account to accept this invitation.");
      }

      // Claim the invitation inside this transaction before creating the
      // relationship, preventing two accounts from consuming one code.
      const claimed = await tx.parentLinkInvitation.updateMany({
        where: { id: invitation.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) throw new BadRequestException("This link code is invalid or expired.");

      const parent = await tx.parentProfile.upsert({
        where: { userId },
        update: {},
        create: { userId, fullName: user.email.split("@")[0] || "Parent" },
      });
      if (user.role === "STUDENT") {
        await tx.user.update({ where: { id: userId }, data: { role: "PARENT" } });
      }
      const relation = await tx.parentStudentRelation.upsert({
        where: { parentId_studentId: { parentId: parent.id, studentId: invitation.studentId } },
        update: {},
        create: { parentId: parent.id, studentId: invitation.studentId },
      });
      return { id: relation.id, studentId: relation.studentId, canViewConversations: relation.canViewConversations };
    });
  }

  async listStudents(userId: string) {
    const parent = await this.getParent(userId);
    const links = await this.db.parentStudentRelation.findMany({
      where: { parentId: parent.id },
      include: { student: { include: { curriculum: true, grade: true, subjects: { include: { subject: true } } } } },
      orderBy: { createdAt: "desc" },
    });
    return links.map((link: any) => ({
      id: link.student.id,
      fullName: link.student.fullName,
      age: link.student.age,
      curriculum: { nameEn: link.student.curriculum.nameEn, nameAr: link.student.curriculum.nameAr },
      grade: { nameEn: link.student.grade.nameEn, nameAr: link.student.grade.nameAr },
      subjects: link.student.subjects.map((s: any) => ({ id: s.subject.id, nameEn: s.subject.nameEn, nameAr: s.subject.nameAr })),
      canViewConversations: link.canViewConversations,
    }));
  }

  async dashboardSummary(userId: string) {
    const parent = await this.getParent(userId);
    const links = await this.db.parentStudentRelation.findMany({
      where: { parentId: parent.id },
      include: { student: { include: {
        curriculum: true,
        grade: true,
        subjects: { include: { subject: true } },
        _count: { select: { questionAttempts: true, quizResults: true } },
      } } },
    });
    return {
      parent: { fullName: parent.fullName },
      students: await Promise.all(links.map(async (link: any) => {
        const recent = await this.db.questionAttempt.findMany({
          where: { studentId: link.studentId },
          orderBy: { attemptedAt: "desc" },
          take: 5,
          select: { isCorrect: true, attemptedAt: true },
        });
        const [completedLessonsCount, completedLessons, examResults] = await Promise.all([
          this.db.lessonSession.count({ where: { studentId: link.studentId, status: "COMPLETED" } }),
          this.db.lessonSession.findMany({
            where: { studentId: link.studentId, status: "COMPLETED" },
            orderBy: { completedAt: "desc" },
            take: 10,
            select: {
              id: true,
              completedAt: true,
              topic: {
                select: {
                  nameEn: true,
                  nameAr: true,
                  unit: { select: { subject: { select: { nameEn: true, nameAr: true } } } },
                },
              },
            },
          }),
          this.db.quizResult.findMany({
            where: { studentId: link.studentId, quizType: { in: ["quiz", "topic_assessment", "mock_exam"] } },
            orderBy: { createdAt: "desc" },
            take: 10,
            select: {
              id: true,
              quizType: true,
              score: true,
              correctCount: true,
              totalQuestions: true,
              createdAt: true,
              topic: { select: { nameEn: true, nameAr: true } },
            },
          }),
        ]);
        const selectedSubjects = link.student.subjects.map((studentSubject: any) => studentSubject.subject);
        const subjectUsage = await Promise.all(selectedSubjects.map(async (subject: any) => ({
          subjectId: subject.id,
          nameEn: subject.nameEn,
          nameAr: subject.nameAr,
          ...(await this.aiUsage.getRemainingToday(link.studentId, subject.id)),
        })));
        const canonicalSubjectIds: string[] = Array.from(new Set<string>(selectedSubjects.map((subject: any) => subject.sharedContentSubjectId ?? subject.id)));
        const topicAccuracy = canonicalSubjectIds.length
          ? await this.topicAccuracy.getPerTopicAccuracy(link.studentId, canonicalSubjectIds)
          : [];
        const weakTopics = topicAccuracy
          .filter((topic) => topic.total >= 3 && topic.percent < 60)
          .slice(0, 5);
        const result: any = {
          id: link.student.id, fullName: link.student.fullName,
          attempts: link.student._count.questionAttempts, quizzes: link.student._count.quizResults,
          curriculum: { nameEn: link.student.curriculum.nameEn, nameAr: link.student.curriculum.nameAr },
          grade: { nameEn: link.student.grade.nameEn, nameAr: link.student.grade.nameAr },
          subjects: selectedSubjects.map((subject: any) => ({ id: subject.id, nameEn: subject.nameEn, nameAr: subject.nameAr })),
          subjectUsage,
          weakTopics,
          recentActivity: recent,
          completedLessonsCount,
          completedLessons,
          examResults,
        };
        return result;
      })),
    };
  }

  private async getParent(userId: string) {
    const parent = await this.db.parentProfile.findUnique({ where: { userId } });
    if (!parent) throw new NotFoundException("Create your parent profile first.");
    return parent;
  }
}

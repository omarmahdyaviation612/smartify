import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class ParentService {
  constructor(private readonly prisma: PrismaService) {}
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
    const parent = await this.db.parentProfile.findUnique({ where: { userId } });
    if (!parent) throw new NotFoundException("Create your parent profile before linking a student.");
    const code = rawCode?.trim().toUpperCase();
    if (!code) throw new BadRequestException("A link code is required.");
    const invitation = await this.db.parentLinkInvitation.findUnique({ where: { code } });
    if (!invitation || invitation.usedAt || invitation.expiresAt < new Date()) {
      throw new BadRequestException("This link code is invalid or expired.");
    }
    if (invitation.createdByUserId === userId) throw new BadRequestException("You cannot link your own account.");
    const relation = await this.db.parentStudentRelation.upsert({
      where: { parentId_studentId: { parentId: parent.id, studentId: invitation.studentId } },
      update: {},
      create: { parentId: parent.id, studentId: invitation.studentId },
    });
    await this.db.parentLinkInvitation.update({ where: { id: invitation.id }, data: { usedAt: new Date() } });
    return { id: relation.id, studentId: relation.studentId, canViewConversations: relation.canViewConversations };
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
      include: { student: { include: { _count: { select: { questionAttempts: true, quizResults: true } } } } },
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
        const result: any = {
          id: link.student.id, fullName: link.student.fullName,
          attempts: link.student._count.questionAttempts, quizzes: link.student._count.quizResults,
          recentActivity: recent,
          canViewConversations: link.canViewConversations,
        };
        if (link.canViewConversations) {
          result.conversations = await this.db.aIConversation.findMany({
            where: { studentId: link.studentId }, orderBy: { updatedAt: "desc" }, take: 5,
            select: { id: true, title: true, updatedAt: true },
          });
        }
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

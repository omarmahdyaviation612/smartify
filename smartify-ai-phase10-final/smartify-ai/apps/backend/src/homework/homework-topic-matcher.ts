import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { resolveSubjectAccess } from "../common/subject-access";
import { assignedGroundingSliceOrNull } from "../ai/context/topic-grounding-assignment.util";

@Injectable()
export class HomeworkTopicMatcher {
  constructor(private readonly prisma: PrismaService) {}

  async eligibleSubjects(userId: string) {
    const profile = await this.prisma.client.studentProfile.findUnique({
      where: { userId }, include: { subjects: true, user: { select: { role: true, isTestStudent: true } } },
    });
    if (!profile) throw new NotFoundException("Complete onboarding first.");
    const rows = await this.prisma.client.subject.findMany({
      where: { gradeId: profile.gradeId, isActive: true },
      select: { id: true, nameEn: true, nameAr: true },
    });
    const entitled = new Set((profile.subjects ?? []).filter((s: any) => !s.expiresAt || s.expiresAt > new Date()).map((s: any) => s.subjectId));
    const isTest = profile.user?.role === "STUDENT" && profile.user.isTestStudent === true;
    return { profile, subjects: rows.filter((s: any) => isTest || entitled.has(s.id)) };
  }

  async requireSubject(userId: string, subjectId: string) {
    const { profile } = await this.eligibleSubjects(userId);
    const access = await resolveSubjectAccess(this.prisma, profile, subjectId);
    if (!access.active) throw new ForbiddenException("You need an active subject subscription.");
    return { profile, contentSubjectId: access.contentSubjectId };
  }

  async findGroundedCandidates(subjectId: string, query: string) {
    const topics = await this.prisma.client.topic.findMany({
      where: { unit: { subjectId } },
      select: { id: true, nameEn: true, nameAr: true, unitId: true, unit: { select: { id: true, nameEn: true, nameAr: true, groundingVersion: true, groundingSourceFingerprint: true, groundingNotesJson: true } }, groundingAssignment: true, topicSourceEvidence: true },
      take: 1000,
    });
    const queryTokens = new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
    const ranked = topics.filter((topic: any) => assignedGroundingSliceOrNull(topic.groundingAssignment, topic.unit, topic.topicSourceEvidence))
      .map((topic: any) => {
        const titleTokens = new Set(`${topic.nameEn ?? ""} ${topic.nameAr ?? ""}`.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
        return { id: topic.id, nameEn: topic.nameEn, nameAr: topic.nameAr, unitId: topic.unitId, unitNameEn: topic.unit.nameEn, unitNameAr: topic.unit.nameAr,
          score: [...queryTokens].filter(token => titleTokens.has(token)).length };
      }).sort((a: any, b: any) => b.score - a.score);
    return ranked[0]?.score > 0 ? ranked.filter((topic: any) => topic.score > 0).slice(0, 5) : ranked.slice(0, 100);
  }

  async requireGroundedTopic(topicId: string, subjectId: string) {
    const include = {
      groundingAssignment: true,
      topicSourceEvidence: true,
      unit: { include: { subject: { include: { grade: { include: { curriculum: true } } } } } },
    };
    const topic = await this.prisma.client.topic.findFirst({
      where: { id: topicId, unit: { subjectId } },
      include,
    });
    if (!topic || !assignedGroundingSliceOrNull(topic.groundingAssignment as any, topic.unit as any, topic.topicSourceEvidence as any)) {
      throw new NotFoundException("This topic is not available for Homework Help.");
    }
    return topic;
  }
}

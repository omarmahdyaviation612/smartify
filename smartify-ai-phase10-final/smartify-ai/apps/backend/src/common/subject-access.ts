import { ForbiddenException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { hasSubjectEntitlementInList, isStudentSubjectRowActive } from "./subject-entitlement.util";
import { canonicalContentSubjectId } from "./shared-content-subject.util";

export type AccessProfile = { id: string; gradeId: string; curriculumId: string;
  user?: { role: string; isTestStudent?: boolean };
  subjects?: Array<{ subjectId: string; expiresAt?: Date | null }> };

export function subjectDiscoveryWhere(profile: Pick<AccessProfile, "gradeId" | "curriculumId">) {
  return { gradeId: profile.gradeId, isActive: true, grade: { curriculumId: profile.curriculumId, isActive: true, curriculum: { isActive: true } } };
}
export function isTestStudent(profile: Pick<AccessProfile, "user">): boolean {
  return profile.user?.role === "STUDENT" && profile.user.isTestStudent === true;
}
/** Always checks publication and relational scope before considering any grant. */
export async function resolveSubjectAccess(prisma: PrismaService, profile: AccessProfile, subjectId: string) {
  const shareRelations = {
    grade: { select: { level: true } },
    sharedContentSubject: { select: { id: true, nameEn: true, nameAr: true, isActive: true, sharedContentSubjectId: true, grade: { select: { level: true, isActive: true, curriculum: { select: { code: true, isActive: true } } } } } },
  };
  let subject = await prisma.client.subject.findFirst({ where: { id: subjectId, ...subjectDiscoveryWhere(profile) }, include: shareRelations });
  // A Topic belongs to the canonical MOE Subject. Let a student reach it
  // only through an explicitly linked target Subject in their own scope.
  if (!subject) {
    subject = await prisma.client.subject.findFirst({
      where: { sharedContentSubjectId: subjectId, ...subjectDiscoveryWhere(profile) },
      include: shareRelations,
    });
  }
  if (!subject) throw new ForbiddenException("This subject is not available for your curriculum and grade.");
  const contentSubjectId = canonicalContentSubjectId(subject);
  if (!contentSubjectId) throw new ForbiddenException("This shared subject is not configured for your curriculum and grade.");
  // Entitlement always belongs to the in-scope subject: the direct subject
  // for ordinary requests, or the target alias for a canonical Topic.
  const active = isTestStudent(profile) || (profile.subjects
    ? hasSubjectEntitlementInList(profile.subjects, subject.id)
    : isStudentSubjectRowActive(await prisma.client.studentSubject.findUnique({ where: { studentId_subjectId: { studentId: profile.id, subjectId: subject.id } } })));
  return { subject, contentSubjectId, active };
}

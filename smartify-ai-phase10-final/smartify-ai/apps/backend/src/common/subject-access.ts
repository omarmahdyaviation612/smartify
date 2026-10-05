import { ForbiddenException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { hasSubjectEntitlementInList, isStudentSubjectRowActive } from "./subject-entitlement.util";

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
  const subject = await prisma.client.subject.findFirst({ where: { id: subjectId, ...subjectDiscoveryWhere(profile) } });
  if (!subject) throw new ForbiddenException("This subject is not available for your curriculum and grade.");
  const active = isTestStudent(profile) || (profile.subjects
    ? hasSubjectEntitlementInList(profile.subjects, subjectId)
    : isStudentSubjectRowActive(await prisma.client.studentSubject.findUnique({ where: { studentId_subjectId: { studentId: profile.id, subjectId } } })));
  return { subject, active };
}

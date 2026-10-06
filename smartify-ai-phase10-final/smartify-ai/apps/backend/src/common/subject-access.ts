import { ForbiddenException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { hasSubjectEntitlementInList, isStudentSubjectRowActive } from "./subject-entitlement.util";

export type AccessProfile = { id: string; gradeId: string; curriculumId: string;
  user?: { role: string; isTestStudent?: boolean };
  subjects?: Array<{ subjectId: string; expiresAt?: Date | null }> };

/**
 * The GradeSubject filter for "what may this student's grade see" (2026-10-06,
 * shared subjects Phase 2 merge).
 *
 * This used to be `{ gradeId: profile.gradeId, isActive: true, grade: {...} }`
 * on `subject.findMany` — i.e. "the Subject's own gradeId is this grade".
 * `subject.gradeId` is now the subject's CONTENT HOME, which for the shared
 * subjects (Arabic Language / Social Studies) is the Egyptian grade even when a
 * British grade offers it, so that filter hid exactly the content this work
 * exists to deliver. The offering is the availability rule; `gradeId` is no
 * longer part of it. The publication gate main introduced (active grade under an
 * active curriculum) is preserved by walking through `grade`.
 *
 * Call sites therefore query `gradeSubject`, not `subject`, and read
 * `.subject` off each row.
 */
export function subjectDiscoveryWhere(profile: Pick<AccessProfile, "gradeId" | "curriculumId">) {
  return {
    gradeId: profile.gradeId,
    isActive: true,
    subject: { isActive: true },
    grade: { curriculumId: profile.curriculumId, isActive: true, curriculum: { isActive: true } },
  };
}
export function isTestStudent(profile: Pick<AccessProfile, "user">): boolean {
  return profile.user?.role === "STUDENT" && profile.user.isTestStudent === true;
}
/** Always checks publication and relational scope before considering any grant. */
export async function resolveSubjectAccess(prisma: PrismaService, profile: AccessProfile, subjectId: string) {
  const offering = await prisma.client.gradeSubject.findFirst({
    where: { ...subjectDiscoveryWhere(profile), subjectId },
    include: { subject: true },
  });
  if (!offering) throw new ForbiddenException("This subject is not available for your curriculum and grade.");
  const subject = offering.subject;
  const active = isTestStudent(profile) || (profile.subjects
    ? hasSubjectEntitlementInList(profile.subjects, subjectId)
    : isStudentSubjectRowActive(await prisma.client.studentSubject.findUnique({ where: { studentId_subjectId: { studentId: profile.id, subjectId } } })));
  return { subject, active };
}

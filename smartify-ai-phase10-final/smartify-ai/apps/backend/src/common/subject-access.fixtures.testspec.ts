/** Catalog boundary for older service fixtures that predate the subject publication query.
 * Those suites exercise quotas/content/grading; the query-applied security catalog is
 * independently exercised in subject-discovery.spec.ts. No entitlement grants are added.
 *
 * 2026-10-06 (shared subjects Phase 2 merge): the availability query moved from
 * `subject.findFirst({ id, ...subjectDiscoveryWhere })` to
 * `gradeSubject.findFirst({ ...subjectDiscoveryWhere, subjectId }, include: { subject: true })`,
 * because a Subject's own `gradeId` is now its CONTENT HOME and is no longer the
 * availability rule. Both are provided so fixture callers keep working, and
 * `resolveSubjectAccess` reads `.subject` off the offering row.
 */
export function subjectAccessFixture(prisma: any) {
  const client = prisma.client;
  client.subject ??= {};
  client.subject.findFirst ??= jest.fn(async ({ where }: any) => {
    const implementation = client.studentProfile?.findUnique?.getMockImplementation?.();
    const profile = implementation ? await implementation({ where: { userId: "user-1" } }) : null;
    const owned = profile?.subjects?.find((s: any) => s.subjectId === where.id)?.subject;
    return { id: where.id, nameEn: owned?.nameEn ?? "Mathematics", nameAr: owned?.nameAr ?? "", gradeId: where.gradeId,
      isActive: true, grade: { curriculumId: where.grade.curriculumId, isActive: true } };
  });
  client.gradeSubject ??= {};
  client.gradeSubject.findFirst ??= jest.fn(async ({ where }: any) => {
    const implementation = client.studentProfile?.findUnique?.getMockImplementation?.();
    const profile = implementation ? await implementation({ where: { userId: "user-1" } }) : null;
    const owned = profile?.subjects?.find((s: any) => s.subjectId === where.subjectId)?.subject;
    const subject = { id: where.subjectId, nameEn: owned?.nameEn ?? "Mathematics", nameAr: owned?.nameAr ?? "",
      gradeId: where.gradeId, isActive: true, grade: { curriculumId: where.grade.curriculumId, isActive: true } };
    return { id: `offering-${where.subjectId}`, gradeId: where.gradeId, subjectId: where.subjectId, isActive: true, subject };
  });
  client.gradeSubject.findMany ??= jest.fn(async () => []);
  return prisma;
}

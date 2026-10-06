/** Catalog boundary for older service fixtures that predate the subject publication query.
 * Those suites exercise quotas/content/grading; the query-applied security catalog is
 * independently exercised in subject-discovery.spec.ts. No entitlement grants are added.
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
  return prisma;
}

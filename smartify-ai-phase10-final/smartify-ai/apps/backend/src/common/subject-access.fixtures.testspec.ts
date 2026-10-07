/** Catalog boundary for older service fixtures that predate the subject publication query.
 * Those suites exercise quotas/content/grading; the query-applied security catalog is
 * independently exercised in subject-discovery.spec.ts. No entitlement grants are added.
 */
export function subjectAccessFixture(prisma: any) {
  const client = prisma.client;
  client.$transaction ??= jest.fn(async (callback: (tx: any) => Promise<any>) => callback(client));
  client.practiceSubmission ??= {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn(async ({ data }: any) => ({ id: "practice-submission-test", ...data })),
  };
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

import { SchoolsService } from "./schools.service";

describe("SchoolsService", () => {
  function makePrismaMock(schools: any[] = []) {
    return {
      client: {
        school: {
          findMany: jest.fn().mockImplementation(({ where, take }: any) => {
            let results = schools.filter((s) => s.governorate === where.governorate && s.isActive === where.isActive);
            if (where.area) results = results.filter((s) => s.area === where.area);
            if (where.OR) {
              const q = where.OR[0].nameEn.contains.toLowerCase();
              results = results.filter(
                (s) => s.nameEn.toLowerCase().includes(q) || (s.nameAr ?? "").toLowerCase().includes(q),
              );
            }
            return results.slice(0, take);
          }),
        },
      },
    } as any;
  }

  const schoolsFixture = [
    { id: "s1", nameEn: "Cairo Modern School", nameAr: "مدرسة القاهرة الحديثة", governorate: "CAIRO", area: "Nasr City", isActive: true },
    { id: "s2", nameEn: "Giza International", nameAr: null, governorate: "GIZA", area: "Dokki", isActive: true },
    { id: "s3", nameEn: "Old Cairo School", nameAr: null, governorate: "CAIRO", area: "Maadi", isActive: false },
  ];

  it("filters strictly by governorate — only Smartify's own School table, no cross-governorate leakage", async () => {
    const prisma = makePrismaMock(schoolsFixture);
    const service = new SchoolsService(prisma);

    const results = await service.search({ governorate: "CAIRO" as any });

    expect(results.every((r) => r.governorate === "CAIRO")).toBe(true);
    expect(results.some((r) => r.id === "s2")).toBe(false);
  });

  it("excludes inactive schools", async () => {
    const prisma = makePrismaMock(schoolsFixture);
    const service = new SchoolsService(prisma);

    const results = await service.search({ governorate: "CAIRO" as any });

    expect(results.some((r) => r.id === "s3")).toBe(false);
  });

  it("is case-insensitive on the search term", async () => {
    const prisma = makePrismaMock(schoolsFixture);
    const service = new SchoolsService(prisma);

    const results = await service.search({ governorate: "CAIRO" as any, q: "MODERN" });

    expect(results.map((r) => r.id)).toEqual(["s1"]);
  });

  it("applies the optional area filter", async () => {
    const prisma = makePrismaMock(schoolsFixture);
    const service = new SchoolsService(prisma);

    const results = await service.search({ governorate: "CAIRO" as any, area: "Nasr City" });

    expect(results.map((r) => r.id)).toEqual(["s1"]);
  });

  it("bounds the result count via take, never returning an unbounded scan", async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      id: `bulk-${i}`,
      nameEn: `School ${i}`,
      nameAr: null,
      governorate: "CAIRO",
      area: null,
      isActive: true,
    }));
    const prisma = makePrismaMock(many);
    const service = new SchoolsService(prisma);

    const results = await service.search({ governorate: "CAIRO" as any });

    expect(results.length).toBeLessThanOrEqual(20);
    expect(prisma.client.school.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20 }),
    );
  });
});

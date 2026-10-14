import { AdminRevenueService } from "./admin-revenue.service";

describe("AdminRevenueService.getRevenueAnalytics", () => {
  it("groups active monthly subscription revenue by area, curriculum, age band, and subject", async () => {
    const prisma = { client: {
      subscription: { findMany: jest.fn().mockResolvedValue([
        { monthlyTotalEGP: 300, selectedSubjectIds: ["math", "science"], student: { age: 9, governorate: "Giza", area: "Dokki", curriculum: { nameEn: "British" } } },
      ]) },
      subject: { findMany: jest.fn().mockResolvedValue([
        { id: "math", nameEn: "Math", nameAr: "رياضيات", priceEGP: 200 },
        { id: "science", nameEn: "Science", nameAr: "علوم", priceEGP: 100 },
      ]) },
    } } as any;
    const result = await new AdminRevenueService(prisma).getRevenueAnalytics();
    expect(result.monthlyRecurringRevenueEGP).toBe(300);
    expect(result.byArea).toEqual([expect.objectContaining({ governorate: "Giza", area: "Dokki", revenueEGP: 300 })]);
    expect(result.byCurriculum).toEqual([expect.objectContaining({ name: "British", revenueEGP: 300 })]);
    expect(result.byAgeGroup).toEqual([expect.objectContaining({ ageGroup: "6–10", revenueEGP: 300 })]);
    expect(result.bySubject).toEqual([
      expect.objectContaining({ nameEn: "Math", revenueEGP: 200 }),
      expect.objectContaining({ nameEn: "Science", revenueEGP: 100 }),
    ]);
  });

  it("keeps missing area and legacy subject revenue visible instead of dropping it", async () => {
    const prisma = { client: {
      subscription: { findMany: jest.fn().mockResolvedValue([
        { monthlyTotalEGP: 250, selectedSubjectIds: null, student: { age: 16, governorate: null, area: null, curriculum: { nameEn: "Egyptian" } } },
      ]) },
      subject: { findMany: jest.fn().mockResolvedValue([]) },
    } } as any;
    const result = await new AdminRevenueService(prisma).getRevenueAnalytics();
    expect(result.byArea[0]).toEqual(expect.objectContaining({ governorate: "Unknown", area: "Unknown", revenueEGP: 250 }));
    expect(result.byAgeGroup[0]).toEqual(expect.objectContaining({ ageGroup: "16+", revenueEGP: 250 }));
    expect(result.unattributedSubjectRevenueEGP).toBe(250);
  });
});

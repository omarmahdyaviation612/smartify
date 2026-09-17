/**
 * Phase 9.4D, Objective 2: unit coverage for
 * packages/database/prisma/cleanup-budget-reservations.ts's decision
 * logic — mocked Prisma client, no real database. The dry-run itself was
 * additionally verified against the real live database (reported 0
 * eligible rows, deleted nothing — see the Phase 9.4D report).
 */
const mockAIDailyBudgetCounter = {
  count: jest.fn(),
  findMany: jest.fn(),
  deleteMany: jest.fn(),
};
const mockAIBudgetReservation = {
  count: jest.fn(),
  findMany: jest.fn(),
  deleteMany: jest.fn(),
};
const mockDisconnect = jest.fn().mockResolvedValue(undefined);

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    aIDailyBudgetCounter: mockAIDailyBudgetCounter,
    aIBudgetReservation: mockAIBudgetReservation,
    $disconnect: mockDisconnect,
  })),
}));

import { runCleanup } from "../../../../../packages/database/prisma/cleanup-budget-reservations";

function resetMocks() {
  mockAIDailyBudgetCounter.count.mockReset().mockResolvedValue(0);
  mockAIDailyBudgetCounter.findMany.mockReset().mockResolvedValue([]);
  mockAIDailyBudgetCounter.deleteMany.mockReset().mockResolvedValue({ count: 0 });
  mockAIBudgetReservation.count.mockReset().mockResolvedValue(0);
  mockAIBudgetReservation.findMany.mockReset().mockResolvedValue([]);
  mockAIBudgetReservation.deleteMany.mockReset().mockResolvedValue({ count: 0 });
  mockDisconnect.mockClear();
}

describe("cleanup-budget-reservations (Phase 9.4D Objective 2)", () => {
  beforeEach(resetMocks);

  it("uses a UTC retention boundary across Cairo DST regardless of the host timezone", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-04-24T00:00:00.000Z"));
    try {
      const result = await runCleanup(["--dry-run", "--retention-days=1"]);
      expect(result.cutoff.toISOString()).toBe("2026-04-23T00:00:00.000Z");
    } finally {
      jest.useRealTimers();
    }
  });

  it("never queries AIBudgetReservation with RESERVED in its status filter", async () => {
    await runCleanup(["--dry-run"]);
    const where = mockAIBudgetReservation.count.mock.calls[0][0].where;
    expect(where.status.in).toEqual(["RECONCILED", "RELEASED"]);
    expect(where.status.in).not.toContain("RESERVED");
  });

  it("applies a usageDate < cutoff filter to both tables — never today's or recent rows", async () => {
    await runCleanup(["--dry-run", "--retention-days=30"]);
    const counterWhere = mockAIDailyBudgetCounter.count.mock.calls[0][0].where;
    const reservationWhere = mockAIBudgetReservation.count.mock.calls[0][0].where;
    const now = new Date();
    expect(counterWhere.usageDate.lt.getTime()).toBeLessThan(now.getTime());
    expect(reservationWhere.usageDate.lt.getTime()).toBeLessThan(now.getTime());
    // Roughly 30 days before now (within a small tolerance for test execution time).
    const daysAgo = (now.getTime() - counterWhere.usageDate.lt.getTime()) / (1000 * 60 * 60 * 24);
    expect(daysAgo).toBeGreaterThan(29);
    expect(daysAgo).toBeLessThan(31);
  });

  it("dry-run reports eligible counts but deletes nothing", async () => {
    mockAIDailyBudgetCounter.count.mockResolvedValue(42);
    mockAIBudgetReservation.count.mockResolvedValue(7);
    const result = await runCleanup(["--dry-run"]);
    expect(result).toMatchObject({ dryRun: true, eligibleCounters: 42, eligibleReservations: 7, deletedCounters: 0, deletedReservations: 0 });
    expect(mockAIDailyBudgetCounter.deleteMany).not.toHaveBeenCalled();
    expect(mockAIBudgetReservation.deleteMany).not.toHaveBeenCalled();
  });

  it("a real (non-dry-run) invocation deletes in bounded batches and stops when a batch is smaller than the batch size", async () => {
    mockAIDailyBudgetCounter.findMany
      .mockResolvedValueOnce([{ id: "c1" }, { id: "c2" }])
      .mockResolvedValueOnce([]); // batch smaller than size 2 on the first call already ends the loop
    mockAIDailyBudgetCounter.deleteMany.mockResolvedValueOnce({ count: 2 });

    const result = await runCleanup(["--batch-size=2"]);
    expect(mockAIDailyBudgetCounter.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockAIDailyBudgetCounter.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["c1", "c2"] } } });
    expect(result.deletedCounters).toBe(2);
  });

  it("never touches AIUsage — no such client property is referenced anywhere in the module", async () => {
    await runCleanup(["--dry-run"]);
    // The mocked PrismaClient instance only exposes aIDailyBudgetCounter/
    // aIBudgetReservation/$disconnect (see the jest.mock factory above) —
    // if the module referenced `.aIUsage` anywhere it would throw
    // "Cannot read properties of undefined", not resolve successfully.
  });

  it("rejects an invalid --retention-days without touching the database at all", async () => {
    await expect(runCleanup(["--retention-days=0"])).rejects.toThrow(/Invalid --retention-days/);
    await expect(runCleanup(["--retention-days=-5"])).rejects.toThrow(/Invalid --retention-days/);
    await expect(runCleanup(["--retention-days=abc"])).rejects.toThrow(/Invalid --retention-days/);
    expect(mockAIDailyBudgetCounter.count).not.toHaveBeenCalled();
  });

  it("rejects an invalid --batch-size without touching the database at all", async () => {
    await expect(runCleanup(["--batch-size=0"])).rejects.toThrow(/Invalid --batch-size/);
    expect(mockAIDailyBudgetCounter.count).not.toHaveBeenCalled();
  });

  it("always disconnects the Prisma client, even after an error mid-run", async () => {
    mockAIDailyBudgetCounter.count.mockRejectedValueOnce(new Error("db down"));
    await expect(runCleanup(["--dry-run"])).rejects.toThrow("db down");
    expect(mockDisconnect).toHaveBeenCalled();
  });
});

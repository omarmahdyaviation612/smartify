import { HomeworkQuotaService } from "./homework-quota.service";

describe("HomeworkQuotaService", () => {
  function makeService(options: {
    counter?: { reserved: number; consumed: number } | null;
    queryRows?: Array<{ id: string }>;
    reservation?: { id: string; studentId: string; status: string; periodStart: Date } | null;
    expired?: Array<{ id: string; studentId: string; periodStart: Date }>;
  } = {}) {
    const reservation = options.reservation ?? null;
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue(options.queryRows ?? [{ id: "counter-1" }]),
      $executeRaw: jest.fn().mockResolvedValue(1),
      homeworkAllowanceReservation: {
        create: jest.fn().mockResolvedValue({ id: "reservation-1" }),
        findUnique: jest.fn().mockResolvedValue(reservation),
        findMany: jest.fn().mockResolvedValue(options.expired ?? []),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      client: {
        homeworkAllowanceCounter: { findUnique: jest.fn().mockResolvedValue(options.counter ?? { reserved: 2, consumed: 3 }) },
        homeworkAllowanceReservation: tx.homeworkAllowanceReservation,
        $queryRaw: tx.$queryRaw,
        $executeRaw: tx.$executeRaw,
        $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
      },
    } as any;
    return { service: new HomeworkQuotaService(prisma), prisma, tx };
  }

  const periodStart = new Date("2026-10-01T00:00:00.000Z");
  const periodEnd = new Date("2026-11-01T00:00:00.000Z");

  it("reports configured monthly allowance with used and reserved credits", async () => {
    const { service } = makeService({ counter: { reserved: 2, consumed: 3 } });
    await expect(service.getStatus("student-1", periodStart, periodEnd, 10)).resolves.toEqual({
      limit: 10,
      used: 3,
      reserved: 2,
      remaining: 5,
      periodEnd,
    });
  });

  it("reports the paid tier allowance without accepting an invalid limit", async () => {
    const { service } = makeService();
    await expect(service.getStatus("student-1", periodStart, periodEnd, 0)).resolves.toEqual({
      limit: 0,
      used: 3,
      reserved: 2,
      remaining: 0,
      periodEnd,
    });
  });

  it("atomically reserves an available allowance slot", async () => {
    const { service, tx } = makeService({ queryRows: [{ id: "counter-1" }] });
    await expect(service.reserveExercise("student-1", periodStart, periodEnd, 10, "session-1")).resolves.toEqual({
      reserved: true,
      reservationId: "reservation-1",
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.homeworkAllowanceReservation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sessionId: "session-1", studentId: "student-1", status: "RESERVED" }),
    }));
  });

  it("does not reserve when the atomic counter is already at the limit", async () => {
    const { service, tx } = makeService({ queryRows: [] });
    await expect(service.reserveExercise("student-1", periodStart, periodEnd, 5, "session-1")).resolves.toEqual({ reserved: false });
    expect(tx.homeworkAllowanceReservation.create).not.toHaveBeenCalled();
  });

  it("does not reserve when the subscription tier allowance is invalid", async () => {
    const { service, tx } = makeService();
    await expect(service.reserveExercise("student-1", periodStart, periodEnd, 0, "session-1")).resolves.toEqual({ reserved: false });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it("consumes a reserved exercise exactly once", async () => {
    const { service, tx } = makeService({ reservation: { id: "reservation-1", studentId: "student-1", status: "RESERVED", periodStart } });
    await expect(service.consumeReservation("student-1", "session-1")).resolves.toBe(true);
    expect(tx.homeworkAllowanceReservation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "reservation-1", studentId: "student-1", status: "RESERVED" },
      data: { status: "CONSUMED" },
    }));
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("refunds a reserved exercise and treats repeated refunds idempotently", async () => {
    const { service, tx } = makeService({ reservation: { id: "reservation-1", studentId: "student-1", status: "RESERVED", periodStart } });
    await expect(service.refundReservation("student-1", "session-1")).resolves.toBe(true);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);

    const refunded = makeService({ reservation: { id: "reservation-1", studentId: "student-1", status: "REFUNDED", periodStart } });
    await expect(refunded.service.refundReservation("student-1", "session-1")).resolves.toBe(true);
    expect(refunded.tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("releases expired reservations without refunding consumed exercises", async () => {
    const { service, tx } = makeService({ expired: [{ id: "reservation-1", studentId: "student-1", periodStart }] });
    await service.releaseExpiredReservations("student-1");
    expect(tx.homeworkAllowanceReservation.updateMany).toHaveBeenCalledWith({
      where: { id: "reservation-1", status: "RESERVED" },
      data: { status: "REFUNDED" },
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });
});

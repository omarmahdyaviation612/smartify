import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

const RESERVATION_TTL_MS = 15 * 60 * 1000;

export interface HomeworkAllowanceStatus {
  limit: number;
  used: number;
  reserved: number;
  remaining: number;
  periodEnd: Date;
}

@Injectable()
export class HomeworkQuotaService {
  constructor(private readonly prisma: PrismaService) {}

  async getStatus(studentId: string, periodStart: Date, periodEnd: Date, limit: number): Promise<HomeworkAllowanceStatus> {
    await this.releaseExpiredReservations(studentId);
    const [counter] = await Promise.all([
      this.prisma.client.homeworkAllowanceCounter.findUnique({
        where: { studentId_periodStart: { studentId, periodStart } },
      }),
    ]);
    const used = counter?.consumed ?? 0;
    const reserved = counter?.reserved ?? 0;
    return {
      limit,
      used,
      reserved,
      remaining: Math.max(0, limit - used - reserved),
      periodEnd,
    };
  }

  async reserveExercise(studentId: string, periodStart: Date, periodEnd: Date, limit: number, sessionId: string): Promise<{ reserved: boolean; reservationId?: string }> {
    await this.releaseExpiredReservations(studentId);
    if (!Number.isSafeInteger(limit) || limit <= 0) return { reserved: false };

    return this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.homeworkAllowanceReservation.findUnique({ where: { sessionId } });
      if (existing) {
        return existing.studentId === studentId && existing.status === "RESERVED"
          ? { reserved: true, reservationId: existing.id }
          : { reserved: false };
      }

      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "HomeworkAllowanceCounter" ("id", "studentId", "periodStart", "periodEnd", "reserved", "consumed", "updatedAt")
        VALUES (gen_random_uuid()::text, ${studentId}, ${periodStart.toISOString()}::timestamp, ${periodEnd.toISOString()}::timestamp, 1, 0, now())
        ON CONFLICT ("studentId", "periodStart")
        DO UPDATE SET "reserved" = "HomeworkAllowanceCounter"."reserved" + 1,
          "periodEnd" = EXCLUDED."periodEnd", "updatedAt" = now()
        WHERE "HomeworkAllowanceCounter"."reserved" + "HomeworkAllowanceCounter"."consumed" < ${limit}
        RETURNING "id";
      `;
      if (rows.length === 0) return { reserved: false };

      const created = await tx.homeworkAllowanceReservation.create({
        data: {
          sessionId,
          studentId,
          periodStart,
          status: "RESERVED",
          expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
        },
        select: { id: true },
      });
      return { reserved: true, reservationId: created.id };
    });
  }

  async consumeReservation(studentId: string, sessionId: string): Promise<boolean> {
    await this.releaseExpiredReservations(studentId);
    return this.prisma.client.$transaction(async (tx) => {
      const reservation = await tx.homeworkAllowanceReservation.findUnique({ where: { sessionId } });
      if (!reservation || reservation.studentId !== studentId) return false;
      if (reservation.status === "CONSUMED") return true;
      if (reservation.status !== "RESERVED") return false;

      const changed = await tx.homeworkAllowanceReservation.updateMany({
        where: { id: reservation.id, studentId, status: "RESERVED" },
        data: { status: "CONSUMED" },
      });
      if (changed.count !== 1) return false;

      await tx.$executeRaw`
        UPDATE "HomeworkAllowanceCounter"
        SET "reserved" = GREATEST("reserved" - 1, 0), "consumed" = "consumed" + 1, "updatedAt" = now()
        WHERE "studentId" = ${studentId} AND "periodStart" = ${reservation.periodStart.toISOString()}::timestamp;
      `;
      return true;
    });
  }

  async refundReservation(studentId: string, sessionId: string): Promise<boolean> {
    return this.prisma.client.$transaction(async (tx) => {
      const reservation = await tx.homeworkAllowanceReservation.findUnique({ where: { sessionId } });
      if (!reservation || reservation.studentId !== studentId) return false;
      if (reservation.status === "REFUNDED") return true;
      if (reservation.status !== "RESERVED") return false;

      const changed = await tx.homeworkAllowanceReservation.updateMany({
        where: { id: reservation.id, studentId, status: "RESERVED" },
        data: { status: "REFUNDED" },
      });
      if (changed.count !== 1) return false;

      await tx.$executeRaw`
        UPDATE "HomeworkAllowanceCounter"
        SET "reserved" = GREATEST("reserved" - 1, 0), "updatedAt" = now()
        WHERE "studentId" = ${studentId} AND "periodStart" = ${reservation.periodStart.toISOString()}::timestamp;
      `;
      return true;
    });
  }

  async releaseExpiredReservations(studentId: string, now = new Date()): Promise<void> {
    const expired = await this.prisma.client.homeworkAllowanceReservation.findMany({
      where: { studentId, status: "RESERVED", expiresAt: { lte: now } },
      select: { id: true, periodStart: true },
    });

    for (const reservation of expired) {
      await this.prisma.client.$transaction(async (tx) => {
        const changed = await tx.homeworkAllowanceReservation.updateMany({
          where: { id: reservation.id, status: "RESERVED" },
          data: { status: "REFUNDED" },
        });
        if (changed.count !== 1) return;
        await tx.$executeRaw`
          UPDATE "HomeworkAllowanceCounter"
          SET "reserved" = GREATEST("reserved" - 1, 0), "updatedAt" = now()
          WHERE "studentId" = ${studentId} AND "periodStart" = ${reservation.periodStart.toISOString()}::timestamp;
        `;
      });
    }
  }
}

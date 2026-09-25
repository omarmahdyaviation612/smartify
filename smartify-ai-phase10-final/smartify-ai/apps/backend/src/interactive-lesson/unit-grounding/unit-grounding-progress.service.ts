import { Injectable } from "@nestjs/common";
import { Prisma } from "@smartify/database";
import { PrismaService } from "../../prisma/prisma.service";

export type GroundingProgressStatus = "IN_PROGRESS" | "RETRYABLE_FAILURE" | "CONFIGURATION_ERROR" | "READY";
export interface GroundingProgressIdentity {
  sourceKey: string; sourceFingerprint: string; sourcePageStart: number; sourcePageEnd: number;
  promptVersion: string; providerModel: string; rendererVersion: string;
}
export interface GroundingChunkResult { chunkId: string; pageStart: number; pageEnd: number; notes: unknown; }

@Injectable()
export class UnitGroundingProgressService {
  constructor(private readonly prisma: PrismaService) {}

  async get(unitId: string) {
    return this.prisma.client.unitGroundingProgress.findUnique({ where: { unitId } });
  }

  async initialize(unitId: string, identity: GroundingProgressIdentity, chunkPlan: unknown[]) {
    const existing = await this.get(unitId);
    if (existing && this.sameIdentity(existing, identity)) {
      if (existing.status === "RETRYABLE_FAILURE" && (!existing.nextEligibleAt || existing.nextEligibleAt <= new Date())) {
        return this.prisma.client.unitGroundingProgress.update({ where: { unitId }, data: { status: "IN_PROGRESS", lastErrorCode: null } });
      }
      return existing;
    }
    if (existing) await this.prisma.client.unitGroundingProgress.delete({ where: { unitId } });
    return this.prisma.client.unitGroundingProgress.create({
      data: {
        unitId, status: "IN_PROGRESS", ...identity,
        chunkPlanJson: chunkPlan as Prisma.InputJsonValue,
        completedChunksJson: [] as Prisma.InputJsonValue,
        retryCount: 0,
      },
    });
  }

  async claimNextChunk(unitId: string, leaseOwner: string, leaseMs: number) {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs);
    const claimed = await this.prisma.client.unitGroundingProgress.updateMany({
      where: {
        unitId,
        status: "IN_PROGRESS",
        OR: [{ nextEligibleAt: null }, { nextEligibleAt: { lte: now } }],
        AND: [{ OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] }],
      },
      data: { leaseOwner, leaseExpiresAt },
    });
    if (claimed.count === 0) return null;
    const progress = await this.get(unitId);
    if (!progress) return null;
    const completed = Array.isArray(progress.completedChunksJson) ? progress.completedChunksJson as any[] : [];
    const plan = Array.isArray(progress.chunkPlanJson) ? progress.chunkPlanJson as any[] : [];
    return plan.find((chunk) => !completed.some((done) => done.chunkId === chunk.chunkId)) ?? null;
  }

  async persistChunk(unitId: string, leaseOwner: string, result: GroundingChunkResult, releaseLease = true) {
    const progress = await this.get(unitId);
    if (!progress || progress.leaseOwner !== leaseOwner) return false;
    const completed = Array.isArray(progress.completedChunksJson) ? progress.completedChunksJson as any[] : [];
    if (!completed.some((chunk) => chunk.chunkId === result.chunkId)) completed.push(result);
    await this.prisma.client.unitGroundingProgress.updateMany({
      where: { unitId, leaseOwner, status: "IN_PROGRESS" },
      data: { completedChunksJson: completed as Prisma.InputJsonValue, ...(releaseLease ? { leaseOwner: null, leaseExpiresAt: null } : {}) },
    });
    return true;
  }

  async markRetryable(unitId: string, leaseOwner: string, nextEligibleAt: Date, errorCode: string) {
    await this.prisma.client.unitGroundingProgress.updateMany({ where: { unitId, leaseOwner }, data: { status: "RETRYABLE_FAILURE", nextEligibleAt, lastErrorCode: errorCode, retryCount: { increment: 1 }, leaseOwner: null, leaseExpiresAt: null } });
  }

  async markConfigurationError(unitId: string, leaseOwner: string, errorCode: string) {
    await this.prisma.client.unitGroundingProgress.updateMany({ where: { unitId, leaseOwner }, data: { status: "CONFIGURATION_ERROR", lastErrorCode: errorCode, leaseOwner: null, leaseExpiresAt: null } });
  }

  async releaseLease(unitId: string, leaseOwner: string) {
    await this.prisma.client.unitGroundingProgress.updateMany({ where: { unitId, leaseOwner }, data: { leaseOwner: null, leaseExpiresAt: null } });
  }

  async finalize(unitId: string, leaseOwner: string, grounding: { groundingNotesJson: Prisma.InputJsonValue; groundingVersion: number; groundingModel: string; groundingPromptVersion: string; groundingSourceFingerprint: string }) {
    return this.prisma.client.$transaction(async (tx) => {
      const claimed = await tx.unitGroundingProgress.updateMany({ where: { unitId, leaseOwner, status: "IN_PROGRESS" }, data: { status: "READY", leaseOwner: null, leaseExpiresAt: null } });
      if (claimed.count !== 1) return false;
      await tx.unit.update({ where: { id: unitId }, data: { ...grounding, groundingGeneratedAt: new Date() } });
      await tx.unitGroundingProgress.delete({ where: { unitId } });
      return true;
    });
  }

  private sameIdentity(row: any, identity: GroundingProgressIdentity) {
    return row.sourceKey === identity.sourceKey && row.sourceFingerprint === identity.sourceFingerprint && row.sourcePageStart === identity.sourcePageStart && row.sourcePageEnd === identity.sourcePageEnd && row.promptVersion === identity.promptVersion && row.providerModel === identity.providerModel && row.rendererVersion === identity.rendererVersion;
  }
}

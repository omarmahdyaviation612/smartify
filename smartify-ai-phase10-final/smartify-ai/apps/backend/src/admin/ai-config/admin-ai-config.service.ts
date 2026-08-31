import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class AdminAIConfigService {
  constructor(private readonly prisma: PrismaService) {}

  listProviders() {
    return this.prisma.client.aIProviderConfig.findMany();
  }

  async updateProvider(
    providerKey: string,
    data: { model?: string; isActive?: boolean; costPerInputToken?: number; costPerOutputToken?: number },
  ) {
    // Phase 10 concurrency fix: the previous implementation did
    // updateMany(deactivate others) THEN update(activate target) inside a
    // transaction — but two concurrent activations of two DIFFERENT
    // providers could each run their own "deactivate everyone else" step
    // and, depending on commit ordering, leave BOTH providers active
    // (each transaction's updateMany would undo the other's activation,
    // but only if it ran first — the actual outcome is order-dependent
    // and not safely predictable under READ COMMITTED). A single UPDATE
    // statement that sets every row's isActive based on a comparison
    // against the target key is atomic by construction — one SQL
    // statement, one indivisible operation — so there is no window where
    // two providers can end up simultaneously active.
    if (data.isActive) {
      await this.prisma.client.$executeRaw`
        UPDATE "AIProviderConfig" SET "isActive" = ("providerKey" = ${providerKey}), "updatedAt" = now();
      `;
    }

    const { isActive, ...otherFields } = data;
    if (Object.keys(otherFields).length > 0) {
      return this.prisma.client.aIProviderConfig.update({ where: { providerKey }, data: otherFields });
    }
    return this.prisma.client.aIProviderConfig.findUnique({ where: { providerKey } });
  }

  async getSystemConfig(key: string) {
    return this.prisma.client.systemConfig.findUnique({ where: { key } });
  }

  async updateSystemConfig(key: string, value: unknown, description?: string) {
    return this.prisma.client.systemConfig.upsert({
      where: { key },
      update: { value: value as any, ...(description ? { description } : {}) },
      create: { key, value: value as any, description },
    });
  }

  /**
   * Aggregate AI usage/cost — the "revenue > AI cost" monitoring the spec
   * requires. Computed from real AIUsage rows, not estimated.
   */
  async getUsageSummary(days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const usage = await this.prisma.client.aIUsage.findMany({ where: { createdAt: { gte: since } } });

    const totalCostUsd = usage.reduce((sum, u) => sum + Number(u.costUsd), 0);
    const totalInputTokens = usage.reduce((sum, u) => sum + u.inputTokens, 0);
    const totalOutputTokens = usage.reduce((sum, u) => sum + u.outputTokens, 0);
    const totalRequests = usage.length;

    const byFeature = new Map<string, { requests: number; costUsd: number }>();
    for (const u of usage) {
      const entry = byFeature.get(u.feature) ?? { requests: 0, costUsd: 0 };
      entry.requests += 1;
      entry.costUsd += Number(u.costUsd);
      byFeature.set(u.feature, entry);
    }

    // "Suspicious usage" — simple MVP flag: students with unusually high
    // request counts in the window. Not a real anomaly-detection system,
    // just a sortable list an admin can eyeball.
    const byStudent = new Map<string, number>();
    for (const u of usage) {
      if (!u.studentId) continue;
      byStudent.set(u.studentId, (byStudent.get(u.studentId) ?? 0) + 1);
    }
    const topUsageStudents = Array.from(byStudent.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([studentId, requests]) => ({ studentId, requests }));

    return {
      windowDays: days,
      totalRequests,
      totalCostUsd,
      totalInputTokens,
      totalOutputTokens,
      byFeature: Object.fromEntries(byFeature),
      topUsageStudents,
    };
  }
}

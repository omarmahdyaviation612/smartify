import { AIDailyTopUpService } from "./ai-daily-topup.service";
import { AIUsageService } from "../ai/usage/ai-usage.service";
import { AI_DAILY_LIMIT_REACHED_CODE } from "../ai/usage/ai-daily-limit";

jest.mock("@smartify/config", () => ({
  loadBackendEnv: () => ({ INSTAPAY_RECIPIENT_NAME: "Smartify", INSTAPAY_RECIPIENT_HANDLE: "smartify@instapay" }),
}));

function utcToday() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

describe("AIDailyTopUpService", () => {
  function makeService(purchase?: any) {
    const prisma: any = {
      client: {
        studentProfile: { findUnique: jest.fn().mockResolvedValue({ id: "profile-1", userId: "user-1" }) },
        aIDailyTopUpPurchase: {
          create: jest.fn().mockResolvedValue({ id: "p1" }),
          findUnique: jest.fn().mockResolvedValue(purchase ?? null),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          count: jest.fn().mockResolvedValue(0),
        },
        instapayPaymentSubmission: { count: jest.fn().mockResolvedValue(0) },
      },
    };
    const usage = { getPaidTopUpsToday: jest.fn().mockResolvedValue(1) } as unknown as AIUsageService;
    return { service: new AIDailyTopUpService(prisma, usage), prisma, usage };
  }

  it("issues an SMAI-D reference for 50 EGP and creates a pending purchase", async () => {
    const { service, prisma } = makeService();
    const result = await service.startInstapayPurchase("user-1");
    expect(result.referenceId).toMatch(/^SMAI-D-[0-9A-F]{8}$/);
    expect(result.expectedAmountEGP).toBe(50);
    expect(prisma.client.aIDailyTopUpPurchase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ studentId: "profile-1", userId: "user-1", amountEGP: 50, status: "pending", externalSessionId: result.referenceId }),
    });
  });

  it("activates a pending purchase for today's UTC day only once", async () => {
    const { service, prisma } = makeService({ id: "p1", status: "pending", amountEGP: { toString: () => "50" } });
    await service.applyPaidPurchase("instapay", "p1", "instapay:sub-1");
    expect(prisma.client.aIDailyTopUpPurchase.updateMany).toHaveBeenCalledWith({
      where: { id: "p1", status: "pending" },
      data: expect.objectContaining({ status: "paid", grantedUsageDate: utcToday() }),
    });
  });

  it("is a no-op for an already-paid purchase", async () => {
    const { service, prisma } = makeService({ id: "p1", status: "paid", amountEGP: { toString: () => "50" } });
    await service.applyPaidPurchase("instapay", "p1", "instapay:sub-1");
    expect(prisma.client.aIDailyTopUpPurchase.updateMany).not.toHaveBeenCalled();
  });

  it("reports price, active top-ups and pending review", async () => {
    const { service, prisma } = makeService();
    prisma.client.instapayPaymentSubmission.count.mockResolvedValue(1);
    await expect(service.getStatus("user-1")).resolves.toEqual({ priceEGP: 50, activeToday: 1, pendingReview: true });
  });
});

describe("AIUsageService per-user cap with paid top-ups", () => {
  function makeUsage(opts: { perUserBudget: number; userSpend: number; topUps: number }) {
    const prisma: any = {
      client: {
        systemConfig: {
          findUnique: jest.fn().mockImplementation(({ where: { key } }: any) => {
            const values: Record<string, number> = { global_daily_ai_budget_usd: 100, per_user_daily_ai_budget_usd: opts.perUserBudget };
            return Promise.resolve(key in values ? { key, value: values[key] } : null);
          }),
        },
        aIUsage: {
          aggregate: jest.fn().mockImplementation(({ where }: any) =>
            Promise.resolve({ _sum: { costUsd: where.userId ? opts.userSpend : 0 } }),
          ),
        },
        aIDailyTopUpPurchase: { count: jest.fn().mockResolvedValue(opts.topUps) },
      },
    };
    return new AIUsageService(prisma, { getCostRates: jest.fn() } as any);
  }

  it("blocks with the AI_DAILY_LIMIT_REACHED code when the base cap is spent and no top-up exists", async () => {
    const usage = makeUsage({ perUserBudget: 0.5, userSpend: 0.5, topUps: 0 });
    await expect(usage.assertWithinBudget("user-1")).rejects.toMatchObject({
      response: expect.objectContaining({ code: AI_DAILY_LIMIT_REACHED_CODE, topUpPriceEGP: 50 }),
    });
  });

  it("allows another full allowance after one paid top-up", async () => {
    const usage = makeUsage({ perUserBudget: 0.5, userSpend: 0.6, topUps: 1 });
    await expect(usage.assertWithinBudget("user-1")).resolves.toBeUndefined();
  });

  it("blocks again once the topped-up allowance is also spent", async () => {
    const usage = makeUsage({ perUserBudget: 0.5, userSpend: 1.0, topUps: 1 });
    await expect(usage.assertWithinBudget("user-1")).rejects.toMatchObject({
      response: expect.objectContaining({ code: AI_DAILY_LIMIT_REACHED_CODE }),
    });
  });
});

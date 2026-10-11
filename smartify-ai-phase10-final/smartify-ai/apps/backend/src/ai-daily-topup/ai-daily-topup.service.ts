import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { loadBackendEnv } from "@smartify/config";
import { PrismaService } from "../prisma/prisma.service";
import { AIUsageService } from "../ai/usage/ai-usage.service";
import { AI_DAILY_TOPUP_PRICE_EGP } from "../ai/usage/ai-daily-limit";

/**
 * Extra daily AI allowance, bought manually via InstaPay. A paid purchase
 * adds one full base per-user AI budget for the UTC day it is approved on
 * (see AIUsageService.getEffectivePerUserDailyBudgetUsd). Nothing is granted
 * until an admin confirms the receipt.
 */
@Injectable()
export class AIDailyTopUpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usageService: AIUsageService,
  ) {}

  private startOfToday() {
    const date = new Date();
    // Same UTC day as every other daily AI cap.
    date.setUTCHours(0, 0, 0, 0);
    return date;
  }

  private async getProfile(userId: string) {
    const profile = await this.prisma.client.studentProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException("Complete onboarding before buying extra AI time.");
    return profile;
  }

  /** What the "daily limit reached" card needs: the price, and whether a receipt is already waiting for review. */
  async getStatus(userId: string) {
    const profile = await this.prisma.client.studentProfile.findUnique({ where: { userId } });
    const usageDate = this.startOfToday();
    if (!profile) return { priceEGP: AI_DAILY_TOPUP_PRICE_EGP, activeToday: 0, pendingReview: false };
    const [activeToday, pending] = await Promise.all([
      this.usageService.getPaidTopUpsToday(userId, usageDate),
      this.prisma.client.instapayPaymentSubmission.count({
        where: { studentId: profile.id, kind: "AI_DAILY_TOPUP", status: "PENDING_VERIFICATION" },
      }),
    ]);
    return { priceEGP: AI_DAILY_TOPUP_PRICE_EGP, activeToday, pendingReview: pending > 0 };
  }

  /** Manual InstaPay checkout — same response shape as the subscription and question-pack initiators. */
  async startInstapayPurchase(userId: string) {
    const env = loadBackendEnv();
    if (!env.INSTAPAY_RECIPIENT_NAME || !env.INSTAPAY_RECIPIENT_HANDLE) {
      throw new ServiceUnavailableException("InstaPay is not configured on this environment yet.");
    }
    const profile = await this.getProfile(userId);
    // "D-" prefix lets InstapayService resolve the purchase table unambiguously.
    const referenceId = `SMAI-D-${randomUUID().slice(0, 8).toUpperCase()}`;
    await this.prisma.client.aIDailyTopUpPurchase.create({
      data: {
        studentId: profile.id,
        userId,
        amountEGP: AI_DAILY_TOPUP_PRICE_EGP,
        status: "pending",
        paymentProvider: "instapay",
        externalSessionId: referenceId,
      },
    });
    return {
      referenceId,
      expectedAmountEGP: AI_DAILY_TOPUP_PRICE_EGP,
      recipientName: env.INSTAPAY_RECIPIENT_NAME,
      recipientHandle: env.INSTAPAY_RECIPIENT_HANDLE,
      instructionsEn: env.INSTAPAY_INSTRUCTIONS_EN ?? "",
      instructionsAr: env.INSTAPAY_INSTRUCTIONS_AR ?? "",
    };
  }

  /**
   * Idempotent activation (admin confirm). The pending -> paid transition is
   * the guard, so a retried confirm can never grant a second allowance.
   */
  async applyPaidPurchase(providerKey: string, purchaseId: string, externalEventId: string) {
    const purchase = await this.prisma.client.aIDailyTopUpPurchase.findUnique({ where: { id: purchaseId } });
    if (!purchase) throw new NotFoundException("AI top-up purchase not found.");
    if (purchase.status === "paid") return;
    if (purchase.amountEGP.toString() !== String(AI_DAILY_TOPUP_PRICE_EGP)) {
      throw new BadRequestException("Invalid AI top-up purchase.");
    }
    await this.prisma.client.aIDailyTopUpPurchase.updateMany({
      where: { id: purchaseId, status: "pending" },
      data: { status: "paid", paymentProvider: providerKey, externalEventId, grantedUsageDate: this.startOfToday() },
    });
  }
}

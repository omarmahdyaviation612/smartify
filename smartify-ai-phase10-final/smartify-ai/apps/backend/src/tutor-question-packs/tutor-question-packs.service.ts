import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AIUsageService } from "../ai/usage/ai-usage.service";
import { PaymentProviderFactory } from "../payments/payment-provider.factory";
import { loadBackendEnv } from "@smartify/config";

const PACK_SIZE = 10;
const PACK_PRICE_EGP = 50;

@Injectable()
export class TutorQuestionPacksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usageService: AIUsageService,
    private readonly providerFactory: PaymentProviderFactory,
  ) {}

  private startOfToday() {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private async getStudentSubject(userId: string, subjectId: string) {
    const profile = await this.prisma.client.studentProfile.findUnique({
      where: { userId },
      include: { subjects: true },
    });
    if (!profile) throw new NotFoundException("Complete onboarding before buying question packs.");
    if (!profile.subjects.some((subject) => subject.subjectId === subjectId)) {
      throw new ForbiddenException("This subject is not part of your selected subjects.");
    }
    return profile;
  }

  async getRemaining(userId: string, subjectId: string) {
    const profile = await this.getStudentSubject(userId, subjectId);
    const daily = await this.usageService.getRemainingToday(profile.id, subjectId);
    const credits = await this.prisma.client.tutorExtraQuestionCredit.findUnique({
      where: { studentId_subjectId_usageDate: { studentId: profile.id, subjectId, usageDate: this.startOfToday() } },
    });
    const extraRemaining = credits?.remaining ?? 0;
    return {
      dailyRemaining: daily.remaining,
      extraRemaining,
      totalRemaining: daily.remaining + extraRemaining,
      packPriceEGP: PACK_PRICE_EGP,
      packSize: PACK_SIZE,
    };
  }

  async consumeForTutor(studentId: string, subjectId: string): Promise<{ source: "daily" | "extra"; limit: number }> {
    const daily = await this.usageService.reserveDailySlot(studentId, subjectId);
    if (daily.reserved) return { source: "daily", limit: daily.limit };

    const credits = await this.prisma.client.tutorExtraQuestionCredit.updateMany({
      where: { studentId, subjectId, usageDate: this.startOfToday(), remaining: { gt: 0 } },
      data: { remaining: { decrement: 1 } },
    });
    if (credits.count === 0) {
      throw new ForbiddenException(`You've used today's ${daily.limit} AI questions for this subject. Buy 10 more questions for 50 EGP.`);
    }
    return { source: "extra", limit: daily.limit };
  }

  async refundExtraCredit(studentId: string, subjectId: string) {
    await this.prisma.client.tutorExtraQuestionCredit.updateMany({
      where: { studentId, subjectId, usageDate: this.startOfToday() },
      data: { remaining: { increment: 1 } },
    });
  }

  private async createPendingPurchase(userId: string, subjectId: string) {
    const profile = await this.getStudentSubject(userId, subjectId);
    const purchase = await this.prisma.client.tutorQuestionPackPurchase.create({
      data: { studentId: profile.id, subjectId, quantity: PACK_SIZE, amountEGP: PACK_PRICE_EGP, status: "pending" },
    });
    return purchase;
  }

  async startPurchase(userId: string, subjectId: string) {
    const purchase = await this.createPendingPurchase(userId, subjectId);
    const { provider, providerKey } = await this.providerFactory.getActiveProvider();
    const env = loadBackendEnv();
    const session = await provider.createCheckoutSession({
      studentUserId: userId,
      subscriptionId: purchase.id,
      amountEGP: PACK_PRICE_EGP,
      description: "Smartify AI - 10 extra tutor questions",
      successUrl: `${env.FRONTEND_URL}/billing/success`,
      cancelUrl: `${env.FRONTEND_URL}/tutor`,
      metadata: { purchaseType: "tutor_question_pack", purchaseId: purchase.id },
    });
    await this.prisma.client.tutorQuestionPackPurchase.update({
      where: { id: purchase.id },
      data: { paymentProvider: providerKey, externalSessionId: session.externalSessionId },
    });
    return { checkoutUrl: session.checkoutUrl };
  }

  /** Manual InstaPay counterpart to startPurchase — see BillingService.startInstapayCheckout for the shared rationale. */
  async startInstapayPurchase(userId: string, subjectId: string) {
    const env = loadBackendEnv();
    if (!env.INSTAPAY_RECIPIENT_NAME || !env.INSTAPAY_RECIPIENT_HANDLE) {
      throw new ServiceUnavailableException("InstaPay is not configured on this environment yet.");
    }
    const purchase = await this.createPendingPurchase(userId, subjectId);
    // "P-" prefix distinguishes this from a subscription reference so
    // InstapayService can resolve which table to query without ambiguity.
    const referenceId = `SMAI-P-${randomUUID().slice(0, 8).toUpperCase()}`;
    await this.prisma.client.tutorQuestionPackPurchase.update({
      where: { id: purchase.id },
      data: { paymentProvider: "instapay", externalSessionId: referenceId },
    });
    return {
      referenceId,
      expectedAmountEGP: PACK_PRICE_EGP,
      recipientName: env.INSTAPAY_RECIPIENT_NAME,
      recipientHandle: env.INSTAPAY_RECIPIENT_HANDLE,
      instructionsEn: env.INSTAPAY_INSTRUCTIONS_EN ?? "",
      instructionsAr: env.INSTAPAY_INSTRUCTIONS_AR ?? "",
    };
  }

  async applyPaidPurchase(providerKey: string, purchaseId: string, externalEventId: string) {
    const purchase = await this.prisma.client.tutorQuestionPackPurchase.findUnique({ where: { id: purchaseId } });
    if (!purchase) throw new NotFoundException("Question pack purchase not found.");
    if (purchase.status === "paid") return;
    if (purchase.amountEGP.toString() !== String(PACK_PRICE_EGP) || purchase.quantity !== PACK_SIZE) {
      throw new BadRequestException("Invalid question pack purchase.");
    }
    await this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.tutorQuestionPackPurchase.updateMany({
        where: { id: purchaseId, status: "pending" },
        data: { status: "paid", paymentProvider: providerKey, externalEventId },
      });
      if (updated.count === 0) return;
      await tx.tutorExtraQuestionCredit.upsert({
        where: {
          studentId_subjectId_usageDate: {
            studentId: purchase.studentId,
            subjectId: purchase.subjectId,
            usageDate: this.startOfToday(),
          },
        },
        update: { remaining: { increment: PACK_SIZE }, purchaseId },
        create: {
          studentId: purchase.studentId,
          subjectId: purchase.subjectId,
          usageDate: this.startOfToday(),
          remaining: PACK_SIZE,
          purchaseId,
        },
      });
    });
  }
}

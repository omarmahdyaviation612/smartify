import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { BillingService } from "../../billing/billing.service";
import { TutorQuestionPacksService } from "../../tutor-question-packs/tutor-question-packs.service";

const LIST_SELECT = {
  id: true,
  kind: true,
  referenceId: true,
  expectedAmountEGP: true,
  submittedAmountEGP: true,
  senderName: true,
  note: true,
  status: true,
  createdAt: true,
  verifiedAt: true,
  verifiedByUserId: true,
  rejectedAt: true,
  rejectedByUserId: true,
  rejectionReason: true,
  student: { select: { id: true, fullName: true, user: { select: { email: true } } } },
} as const;

@Injectable()
export class AdminInstapayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billingService: BillingService,
    private readonly questionPacks: TutorQuestionPacksService,
  ) {}

  listPending() {
    return this.prisma.client.instapayPaymentSubmission.findMany({
      where: { status: "PENDING_VERIFICATION" },
      orderBy: { createdAt: "asc" },
      select: LIST_SELECT,
    });
  }

  async getPendingCount() {
    return { count: await this.prisma.client.instapayPaymentSubmission.count({ where: { status: "PENDING_VERIFICATION" } }) };
  }

  listHistory() {
    return this.prisma.client.instapayPaymentSubmission.findMany({
      where: { status: { in: ["VERIFIED", "REJECTED"] } },
      orderBy: { createdAt: "desc" },
      select: LIST_SELECT,
    });
  }

  async getReceipt(id: string) {
    const submission = await this.prisma.client.instapayPaymentSubmission.findUnique({
      where: { id },
      select: { receiptImage: true, receiptMimeType: true },
    });
    if (!submission) throw new NotFoundException("Submission not found.");
    return submission;
  }

  /**
   * Activation happens BEFORE the submission is marked VERIFIED. If the
   * process dies in between, the entitlement is already active and the
   * submission is retried as PENDING_VERIFICATION — a retried confirm call
   * is a safe no-op on activation (existing idempotency in
   * BillingService.applyWebhookEvent / TutorQuestionPacksService.
   * applyPaidPurchase, unchanged here) and simply completes the status
   * update. It can never double-activate.
   */
  async confirm(id: string, adminUserId: string) {
    const submission = await this.prisma.client.instapayPaymentSubmission.findUnique({ where: { id } });
    if (!submission) throw new NotFoundException("Submission not found.");
    if (submission.status !== "PENDING_VERIFICATION") {
      throw new BadRequestException("This payment has already been processed.");
    }

    const externalEventId = `instapay:${submission.id}`;
    if (submission.kind === "SUBSCRIPTION") {
      await this.billingService.applyWebhookEvent("instapay", {
        type: "subscription.activated",
        externalSubscriptionId: submission.referenceId,
        externalEventId,
      });
    } else {
      if (!submission.packPurchaseId) throw new BadRequestException("Malformed submission: missing pack purchase.");
      await this.questionPacks.applyPaidPurchase("instapay", submission.packPurchaseId, externalEventId);
    }

    const updated = await this.prisma.client.instapayPaymentSubmission.updateMany({
      where: { id, status: "PENDING_VERIFICATION" },
      data: { status: "VERIFIED", verifiedAt: new Date(), verifiedByUserId: adminUserId },
    });

    await this.prisma.client.auditLog.create({
      data: {
        userId: adminUserId,
        action: "instapay.confirm",
        entityType: "InstapayPaymentSubmission",
        entityId: submission.id,
        metadata: { referenceId: submission.referenceId, kind: submission.kind, alreadyVerified: updated.count === 0 },
      },
    });

    return this.prisma.client.instapayPaymentSubmission.findUnique({ where: { id }, select: LIST_SELECT });
  }

  async reject(id: string, adminUserId: string, reason: string | undefined) {
    const submission = await this.prisma.client.instapayPaymentSubmission.findUnique({ where: { id } });
    if (!submission) throw new NotFoundException("Submission not found.");
    if (submission.status !== "PENDING_VERIFICATION") {
      throw new BadRequestException("This payment has already been processed.");
    }

    await this.prisma.client.instapayPaymentSubmission.updateMany({
      where: { id, status: "PENDING_VERIFICATION" },
      data: { status: "REJECTED", rejectedAt: new Date(), rejectedByUserId: adminUserId, rejectionReason: reason },
    });

    await this.prisma.client.auditLog.create({
      data: {
        userId: adminUserId,
        action: "instapay.reject",
        entityType: "InstapayPaymentSubmission",
        entityId: submission.id,
        metadata: { referenceId: submission.referenceId, kind: submission.kind, reason: reason ?? null },
      },
    });

    return this.prisma.client.instapayPaymentSubmission.findUnique({ where: { id }, select: LIST_SELECT });
  }
}

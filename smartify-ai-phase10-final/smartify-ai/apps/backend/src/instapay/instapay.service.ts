import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { BillingService } from "../billing/billing.service";
import { TutorQuestionPacksService } from "../tutor-question-packs/tutor-question-packs.service";
import { loadBackendEnv } from "@smartify/config";
import { InstapayAdminAlertService } from "./instapay-admin-alert.service";

const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png"]);

// Magic-byte signatures — the declared Content-Type/mimetype on a Multer
// upload is client-supplied and trivially spoofable, so it's checked
// against the file's actual leading bytes before it's ever trusted.
function sniffImageMimeType(buffer: Buffer): "image/jpeg" | "image/png" | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) return "image/png";
  return null;
}

export interface ReceiptFile {
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class InstapayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billingService: BillingService,
    private readonly questionPacks: TutorQuestionPacksService,
    // Optional so existing unit tests that build the service by hand keep working.
    @Optional() private readonly adminAlert?: InstapayAdminAlertService,
  ) {}

  isConfigured() {
    const env = loadBackendEnv();
    return Boolean(env.INSTAPAY_RECIPIENT_NAME && env.INSTAPAY_RECIPIENT_HANDLE);
  }

  async initiateSubscription(userId: string, input: { subjectIds: string[]; homeworkAddon?: boolean; homeworkAddonAllowance?: number }) {
    return this.billingService.startInstapayCheckout(userId, input);
  }

  async initiateQuestionPack(userId: string, subjectId: string) {
    return this.questionPacks.startInstapayPurchase(userId, subjectId);
  }

  /** Own submissions only — never another student's. */
  async listMine(userId: string) {
    const profile = await this.prisma.client.studentProfile.findUnique({ where: { userId } });
    if (!profile) return [];
    return this.prisma.client.instapayPaymentSubmission.findMany({
      where: { studentId: profile.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, kind: true, referenceId: true, expectedAmountEGP: true, submittedAmountEGP: true,
        status: true, createdAt: true, verifiedAt: true, rejectedAt: true, rejectionReason: true,
      },
    });
  }

  async submitReceipt(
    userId: string,
    input: { referenceId: string; submittedAmountEGP: number; senderName?: string; note?: string },
    file: ReceiptFile | undefined,
  ) {
    if (!Number.isFinite(input.submittedAmountEGP) || input.submittedAmountEGP <= 0) {
      throw new BadRequestException("Enter the amount you actually transferred.");
    }
    if (!file) throw new BadRequestException("Upload a receipt image.");
    if (file.size > MAX_RECEIPT_BYTES) throw new BadRequestException("Receipt image must be smaller than 5 MB.");
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) throw new BadRequestException("Only JPEG or PNG receipts are supported.");
    const sniffed = sniffImageMimeType(file.buffer);
    if (!sniffed) throw new BadRequestException("The uploaded file is not a valid JPEG or PNG image.");

    const profile = await this.prisma.client.studentProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException("Complete onboarding before submitting a payment.");

    const referenceId = input.referenceId?.trim();
    if (!referenceId) throw new BadRequestException("A payment reference is required.");

    // Reference-based lookup, scoped to the caller's OWN profile — never
    // trusts a client-supplied subscription/purchase ID directly, so a
    // student can only submit a receipt against a reference they were
    // actually issued.
    let kind: "SUBSCRIPTION" | "QUESTION_PACK";
    let subscriptionId: string | undefined;
    let packPurchaseId: string | undefined;
    let expectedAmountEGP: number;

    if (referenceId.startsWith("SMAI-S-")) {
      const subscription = await this.prisma.client.subscription.findFirst({
        where: { studentId: profile.id, paymentProvider: "instapay", externalSubscriptionId: referenceId },
      });
      if (!subscription) throw new ForbiddenException("This payment reference does not belong to your account.");
      kind = "SUBSCRIPTION";
      subscriptionId = subscription.id;
      expectedAmountEGP = Number((subscription.pendingSubjectChange as any)?.monthlyTotalEGP ?? subscription.monthlyTotalEGP);
    } else if (referenceId.startsWith("SMAI-P-")) {
      const purchase = await this.prisma.client.tutorQuestionPackPurchase.findFirst({
        where: { studentId: profile.id, paymentProvider: "instapay", externalSessionId: referenceId },
      });
      if (!purchase) throw new ForbiddenException("This payment reference does not belong to your account.");
      kind = "QUESTION_PACK";
      packPurchaseId = purchase.id;
      expectedAmountEGP = Number(purchase.amountEGP);
    } else {
      throw new BadRequestException("Unrecognized payment reference.");
    }

    let created: { id: string; status: any; referenceId: string; createdAt: Date };
    try {
      created = await this.prisma.client.instapayPaymentSubmission.create({
        data: {
          studentId: profile.id,
          kind,
          subscriptionId,
          packPurchaseId,
          referenceId,
          expectedAmountEGP,
          submittedAmountEGP: input.submittedAmountEGP,
          senderName: input.senderName,
          note: input.note,
          receiptImage: file.buffer,
          receiptMimeType: sniffed,
        },
        select: { id: true, status: true, referenceId: true, createdAt: true },
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        throw new BadRequestException("A receipt has already been submitted for this payment reference.");
      }
      throw err;
    }
    // Fire-and-forget: the admin email must never slow down or fail the student's submit.
    void this.adminAlert?.notifyNewSubmission({
      submissionId: created.id,
      kind,
      referenceId,
      expectedAmountEGP,
      submittedAmountEGP: input.submittedAmountEGP,
      studentName: (profile as any).fullName ?? null,
      senderName: input.senderName ?? null,
    });
    return created;
  }
}

/**
 * Phase 9.2: local, no-real-money dry run of the manual InstaPay flow
 * (submission -> admin review -> confirm/reject -> entitlement), exercised
 * through the real service layer exactly as the controllers call it
 * (InstapayService / AdminInstapayService / BillingService underneath) —
 * same NestFactory.createApplicationContext methodology already used and
 * accepted for Phase 7/8's live QA scripts, since no real Clerk credentials
 * exist in this sandbox to drive the HTTP+auth layer directly. RolesGuard
 * itself is not re-exercised live here — it already has 5 passing unit
 * tests (roles.guard.spec.ts) — this script exercises the InstaPay
 * business logic those guards sit in front of.
 *
 * Creates three CLEARLY LABELED, brand-new development-test identities
 * (never promotes an existing account): one ADMIN bootstrap account, and
 * two STUDENT payer accounts (one for the confirm path, one for the
 * reject path, since a Subscription is unique per student and both paths
 * needed to be exercised independently). Receipts submitted are synthetic
 * placeholder image bytes, explicitly labeled as test/no-real-transfer in
 * their sender name and note fields — no real payment is claimed or made.
 */
import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { InstapayModule } from "../instapay/instapay.module";
import { InstapayService } from "../instapay/instapay.service";
import { AdminInstapayModule } from "../admin/instapay/admin-instapay.module";
import { AdminInstapayService } from "../admin/instapay/admin-instapay.service";
import { PrismaService } from "../prisma/prisma.service";

const EG_NATIONAL_CURRICULUM_ID = "cmtyw8hn1000zuk62jeoyx33g";
const REAL_GRADE_1_ID = "cmtyw9x6d00019youemjroiml";
// Subject-based pricing (2026-09-20) replaced PricingPlan-based checkout —
// this pre-existing hardcoded id is stale (this whole script predates that
// change and hardcodes several dev-database-specific ids already). Left as
// an explicitly empty placeholder rather than guessing real Subject ids;
// re-running this dry run meaningfully now requires supplying real, priced
// Subject ids for REAL_GRADE_1_ID below.
const DRY_RUN_SUBJECT_IDS: string[] = [];

const ADMIN_EMAIL = "qa-phase92-admin-bootstrap@smartify.test";
const PAYER_CONFIRM_EMAIL = "qa-phase92-instapay-confirm@smartify.test";
const PAYER_REJECT_EMAIL = "qa-phase92-instapay-reject@smartify.test";

// Minimal valid PNG signature (magic bytes only — passes InstapayService's
// sniffImageMimeType check) followed by a few padding bytes. Deliberately
// synthetic: this is a placeholder byte buffer for testing the upload/
// storage/retrieval path, NOT a real receipt image and NOT evidence of any
// real transfer.
const SYNTHETIC_RECEIPT_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);

function log(tag: string, data: unknown) {
  console.log(`\n===== ${tag} =====`);
  console.log(JSON.stringify(data, null, 2));
}

async function withFreshApp<T>(
  fn: (svc: { instapay: InstapayService; admin: AdminInstapayService }, prisma: PrismaService) => Promise<T>,
): Promise<T> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["warn", "error"] });
  try {
    return await fn(
      {
        instapay: app.select(InstapayModule).get(InstapayService, { strict: false }),
        admin: app.select(AdminInstapayModule).get(AdminInstapayService, { strict: false }),
      },
      app.get(PrismaService),
    );
  } finally {
    await app.close();
  }
}

async function ensureUser(prisma: PrismaService, email: string, role: "ADMIN" | "STUDENT", label: string) {
  const existing = await prisma.client.user.findUnique({ where: { email } });
  if (existing) return existing;
  return prisma.client.user.create({
    data: { clerkUserId: `qa-test-phase92-${label}-${Date.now()}`, email, role },
  });
}

async function ensureStudentProfile(prisma: PrismaService, userId: string, fullName: string) {
  const existing = await prisma.client.studentProfile.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.client.studentProfile.create({
    data: {
      userId,
      fullName,
      age: 7,
      country: "EG",
      preferredLang: "ar",
      curriculumId: EG_NATIONAL_CURRICULUM_ID,
      gradeId: REAL_GRADE_1_ID,
    },
  });
}

async function main() {
  const ids = await withFreshApp(async (_svc, prisma) => {
    const admin = await ensureUser(prisma, ADMIN_EMAIL, "ADMIN", "admin");
    const payerConfirm = await ensureUser(prisma, PAYER_CONFIRM_EMAIL, "STUDENT", "payer-confirm");
    const payerReject = await ensureUser(prisma, PAYER_REJECT_EMAIL, "STUDENT", "payer-reject");
    await ensureStudentProfile(prisma, payerConfirm.id, "[QA TEST] Phase 9.2 Confirm-Path Payer");
    await ensureStudentProfile(prisma, payerReject.id, "[QA TEST] Phase 9.2 Reject-Path Payer");
    return { adminId: admin.id, payerConfirmId: payerConfirm.id, payerRejectId: payerReject.id };
  });
  log("BOOTSTRAPPED IDENTITIES (dev-test only, never an existing/arbitrary account)", {
    admin: ADMIN_EMAIL,
    payerConfirm: PAYER_CONFIRM_EMAIL,
    payerReject: PAYER_REJECT_EMAIL,
  });

  // ---------- CONFIRM PATH ----------
  const initiateConfirm = await withFreshApp((svc) =>
    svc.instapay.initiateSubscription(ids.payerConfirmId, { subjectIds: DRY_RUN_SUBJECT_IDS }),
  );
  log("CONFIRM-PATH: subscription initiated (InstaPay instructions shown to student)", initiateConfirm);

  const submitConfirm = await withFreshApp((svc) =>
    svc.instapay.submitReceipt(
      ids.payerConfirmId,
      {
        referenceId: initiateConfirm.referenceId,
        submittedAmountEGP: initiateConfirm.expectedAmountEGP,
        senderName: "PHASE 9.2 TEST — NO REAL TRANSFER",
        note: "Synthetic test receipt for Phase 9.2 dry run. No real money was transferred.",
      },
      { mimetype: "image/png", size: SYNTHETIC_RECEIPT_PNG.length, buffer: SYNTHETIC_RECEIPT_PNG },
    ),
  );
  log("CONFIRM-PATH: receipt submitted", submitConfirm);

  const pendingAfterSubmit = await withFreshApp((svc) => svc.admin.listPending());
  log("ADMIN: pending queue after both submissions will be checked below (this is confirm-path only so far)", { count: pendingAfterSubmit.length, referenceIds: pendingAfterSubmit.map((p) => p.referenceId) });

  const confirmResult = await withFreshApp((svc) => svc.admin.confirm(submitConfirm.id, ids.adminId));
  log("ADMIN: confirmed submission", confirmResult);

  const subscriptionAfterConfirm = await withFreshApp(async (_svc, prisma) => {
    const profile = await prisma.client.studentProfile.findUniqueOrThrow({ where: { userId: ids.payerConfirmId } });
    return prisma.client.subscription.findUnique({ where: { studentId: profile.id } });
  });
  log("ENTITLEMENT CHECK: subscription status after confirm (expect active)", { status: subscriptionAfterConfirm?.status });

  let duplicateConfirmError: string | null = null;
  try {
    await withFreshApp((svc) => svc.admin.confirm(submitConfirm.id, ids.adminId));
  } catch (err: any) {
    duplicateConfirmError = err?.message ?? String(err);
  }
  const subscriptionAfterDuplicateConfirm = await withFreshApp(async (_svc, prisma) => {
    const profile = await prisma.client.studentProfile.findUniqueOrThrow({ where: { userId: ids.payerConfirmId } });
    return prisma.client.subscription.findUnique({ where: { studentId: profile.id } });
  });
  log("DUPLICATE CONFIRM ATTEMPT (expect rejection, no change)", {
    threwError: duplicateConfirmError,
    subscriptionStatusUnchanged: subscriptionAfterDuplicateConfirm?.status,
    subscriptionUpdatedAtUnchanged: subscriptionAfterConfirm?.updatedAt === subscriptionAfterDuplicateConfirm?.updatedAt,
  });

  // ---------- REJECT PATH ----------
  const initiateReject = await withFreshApp((svc) =>
    svc.instapay.initiateSubscription(ids.payerRejectId, { subjectIds: DRY_RUN_SUBJECT_IDS }),
  );
  log("REJECT-PATH: subscription initiated", initiateReject);

  const submitReject = await withFreshApp((svc) =>
    svc.instapay.submitReceipt(
      ids.payerRejectId,
      {
        referenceId: initiateReject.referenceId,
        submittedAmountEGP: initiateReject.expectedAmountEGP,
        senderName: "PHASE 9.2 TEST — NO REAL TRANSFER",
        note: "Synthetic test receipt for Phase 9.2 dry run (reject path). No real money was transferred.",
      },
      { mimetype: "image/png", size: SYNTHETIC_RECEIPT_PNG.length, buffer: SYNTHETIC_RECEIPT_PNG },
    ),
  );
  log("REJECT-PATH: receipt submitted", submitReject);

  const rejectResult = await withFreshApp((svc) => svc.admin.reject(submitReject.id, ids.adminId, "Phase 9.2 test rejection — synthetic receipt, verifying no entitlement is granted."));
  log("ADMIN: rejected submission", rejectResult);

  const subscriptionAfterReject = await withFreshApp(async (_svc, prisma) => {
    const profile = await prisma.client.studentProfile.findUniqueOrThrow({ where: { userId: ids.payerRejectId } });
    return prisma.client.subscription.findUnique({ where: { studentId: profile.id } });
  });
  log("ENTITLEMENT CHECK: subscription status after reject (expect still pending, no entitlement)", { status: subscriptionAfterReject?.status });

  // ---------- ADMIN REVIEW SURFACE ----------
  const [finalPending, finalHistory, receiptCheck] = await withFreshApp(async (svc) => {
    const pending = await svc.admin.listPending();
    const history = await svc.admin.listHistory();
    const receipt = await svc.admin.getReceipt(submitConfirm.id);
    return [pending, history, { mimeType: receipt.receiptMimeType, bytes: receipt.receiptImage.length }];
  });
  log("ADMIN REVIEW SURFACE: final pending/history/receipt-retrieval check", {
    pendingCount: finalPending.length,
    historyCount: finalHistory.length,
    historyStatuses: finalHistory.map((h) => h.status),
    receiptCheck,
  });

  const auditLogCount = await withFreshApp((_svc, prisma) =>
    prisma.client.auditLog.count({ where: { action: { in: ["instapay.confirm", "instapay.reject"] } } }),
  );
  log("AUDIT LOG COUNT (confirm + reject actions, expect exactly 2 — duplicate confirm must not add a third)", { count: auditLogCount });
}

main().catch((err) => {
  console.error("PHASE 9.2 DRY RUN FAILED:", err instanceof Error ? err.stack : err);
  process.exitCode = 1;
});

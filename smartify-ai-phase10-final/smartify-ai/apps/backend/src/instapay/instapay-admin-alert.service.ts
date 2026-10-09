import { Injectable, Logger } from "@nestjs/common";
import { loadBackendEnv } from "@smartify/config";
import { PrismaService } from "../prisma/prisma.service";
import { EmailService } from "../email/email.service";

export interface NewInstapaySubmission {
  submissionId: string;
  kind: "SUBSCRIPTION" | "QUESTION_PACK";
  referenceId: string;
  expectedAmountEGP: number;
  submittedAmountEGP: number;
  studentName: string | null;
  senderName?: string | null;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Recipients: ADMIN_ALERT_EMAILS (comma separated) when set, otherwise every active SUPER_ADMIN / ADMIN. */
export function parseAlertEmails(raw: string | undefined): string[] {
  return [...new Set((raw ?? "").split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
}

export function buildInstapayAlertEmail(input: NewInstapaySubmission, adminUrl: string) {
  const kindAr = input.kind === "SUBSCRIPTION" ? "اشتراك" : "باقة أسئلة";
  const mismatch = Math.abs(input.submittedAmountEGP - input.expectedAmountEGP) >= 0.01;
  const who = input.studentName?.trim() || "طالب";
  const subject = `💳 دفعة InstaPay جديدة: ${input.submittedAmountEGP} ج.م — ${who}${mismatch ? " ⚠️ المبلغ مختلف" : ""}`;
  const rows: Array<[string, string]> = [
    ["الطالب", who],
    ["النوع", kindAr],
    ["المبلغ المحوَّل", `${input.submittedAmountEGP} ج.م`],
    ["المبلغ المطلوب", `${input.expectedAmountEGP} ج.م${mismatch ? " ⚠️" : ""}`],
    ["المرجع", input.referenceId],
    ...(input.senderName ? ([["اسم المحوِّل", input.senderName]] as Array<[string, string]>) : []),
  ];
  const html = `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;color:#0f172a">
<h2 style="margin:0 0 12px">دفعة InstaPay جديدة مستنية المراجعة</h2>
<table style="border-collapse:collapse">${rows
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#64748b">${escapeHtml(k)}</td><td style="padding:4px 0"><b>${escapeHtml(v)}</b></td></tr>`)
    .join("")}</table>
<p style="margin:20px 0"><a href="${escapeHtml(adminUrl)}" style="background:#7c3aed;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">افتح المراجعة</a></p>
</div>`;
  return { subject, html };
}

/**
 * Emails the admins the moment a student or parent submits an InstaPay receipt, so it can be
 * approved quickly. Best effort: it never throws and never delays the student's response
 * (the caller does not await it).
 */
@Injectable()
export class InstapayAdminAlertService {
  private readonly logger = new Logger(InstapayAdminAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async recipients(): Promise<string[]> {
    const configured = parseAlertEmails(loadBackendEnv().ADMIN_ALERT_EMAILS);
    if (configured.length) return configured;
    const admins = await this.prisma.client.user.findMany({
      where: { role: { in: ["SUPER_ADMIN", "ADMIN"] }, isActive: true, deletedAt: null },
      select: { email: true },
    });
    return [...new Set(admins.map((a) => a.email.toLowerCase()))];
  }

  async notifyNewSubmission(input: NewInstapaySubmission): Promise<void> {
    try {
      const to = await this.recipients();
      if (!to.length) {
        this.logger.warn("New InstaPay submission but no admin alert recipient is configured.");
        return;
      }
      const adminUrl = `${loadBackendEnv().FRONTEND_URL.replace(/\/$/, "")}/ar/admin/instapay`;
      const { subject, html } = buildInstapayAlertEmail(input, adminUrl);
      const results = await Promise.allSettled(to.map((address) => this.email.send({ to: address, subject, html })));
      const sent = results.filter((r) => r.status === "fulfilled" && r.value.sent).length;
      this.logger.log(`InstaPay admin alert for ${input.submissionId}: sent ${sent}/${to.length}.`);
    } catch {
      this.logger.warn(`InstaPay admin alert for ${input.submissionId} failed.`);
    }
  }
}

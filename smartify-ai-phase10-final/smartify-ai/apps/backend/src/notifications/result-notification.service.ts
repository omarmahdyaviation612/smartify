import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { EmailService } from "../email/email.service";

export type ResultSummary = {
  studentName: string;
  score: number;
  subject: { en: string[]; ar: string[] };
  completedAt: string;
};

export type ResultNotificationInput = {
  eventKey: string;
  studentId: string;
  studentName: string;
  subjectNames: { en: string[]; ar: string[] };
  score: number;
  completedAt: Date;
  quizResultId?: string;
  practiceSubmissionId?: string;
};

@Injectable()
export class ResultNotificationService {
  private readonly logger = new Logger(ResultNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async notifyResult(input: ResultNotificationInput): Promise<void> {
    try {
      const relations = await this.prisma.client.parentStudentRelation.findMany({
        where: { studentId: input.studentId },
        include: { parent: { include: { user: { select: { email: true } } } } },
      });
      const summary: ResultSummary = {
        studentName: input.studentName,
        score: input.score,
        subject: { en: [...new Set(input.subjectNames.en)], ar: [...new Set(input.subjectNames.ar)] },
        completedAt: input.completedAt.toISOString(),
      };

      for (const relation of relations) {
        const delivery = await this.prisma.client.parentResultNotification.upsert({
          where: { parentId_eventKey: { parentId: relation.parentId, eventKey: input.eventKey } },
          create: {
            parentId: relation.parentId,
            eventKey: input.eventKey,
            quizResultId: input.quizResultId ?? null,
            practiceSubmissionId: input.practiceSubmissionId ?? null,
            summaryJson: summary,
          },
          update: {},
        });
        const parent = relation.parent;
        if (delivery.emailStatus === "PENDING") {
          const claimed = await this.prisma.client.parentResultNotification.updateMany({
            where: { id: delivery.id, emailStatus: "PENDING" }, data: { emailStatus: "SENDING" },
          });
          if (claimed.count === 1) await this.deliverEmail(delivery.id, parent.user.email, parent.notificationLocale ?? "ar", summary);
        }
      }
    } catch {
      // Result delivery must never change the student's successful submission response.
      this.logger.error("Parent result notification processing failed.");
    }
  }

  async listFailed() {
    const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
    const rows = await this.prisma.client.parentResultNotification.findMany({
      where: { OR: [
        { emailStatus: "FAILED" },
        { emailStatus: "SENDING", updatedAt: { lt: staleBefore } },
      ] },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: { id: true, summaryJson: true, createdAt: true, updatedAt: true, emailStatus: true, emailFailureCode: true },
    });
    return rows.map((row: any) => ({
      id: row.id,
      studentName: (row.summaryJson as ResultSummary).studentName,
      completedAt: (row.summaryJson as ResultSummary).completedAt,
      channels: [
        ...(row.emailStatus === "FAILED" ? [{ channel: "email", status: row.emailFailureCode ?? "PROVIDER_ERROR" }] : row.emailStatus === "SENDING" && row.updatedAt < staleBefore ? [{ channel: "email", status: "DELIVERY_STALLED" }] : []),
      ],
    }));
  }

  async retry(notificationId: string): Promise<{ retried: boolean }> {
    const row = await this.prisma.client.parentResultNotification.findUnique({
      where: { id: notificationId },
      include: { parent: { include: { user: { select: { email: true } } } } },
    });
    if (!row) return { retried: false };
    const summary = row.summaryJson as ResultSummary;
    const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
    if (row.emailStatus === "SENDING" && row.updatedAt < staleBefore) {
      const stalled = await this.prisma.client.parentResultNotification.updateMany({ where: { id: row.id, emailStatus: "SENDING", updatedAt: { lt: staleBefore } }, data: { emailStatus: "FAILED", emailFailureCode: "DELIVERY_STALLED" } });
      if (stalled.count !== 1) return { retried: false };
      row.emailStatus = "FAILED";
    }
    if (row.emailStatus !== "FAILED") return { retried: false };
    const claimed = await this.prisma.client.parentResultNotification.updateMany({ where: { id: row.id, emailStatus: "FAILED" }, data: { emailStatus: "SENDING" } });
    if (claimed.count !== 1) return { retried: false };
    await this.deliverEmail(row.id, row.parent.user.email, row.parent.notificationLocale ?? "ar", summary);
    return { retried: true };
  }

  private async deliverEmail(id: string, to: string, locale: string, summary: ResultSummary) {
    const isAr = locale !== "en";
    const subject = isAr ? "نتيجة جديدة من Smartify" : "A new Smartify result";
    const date = this.formatDate(summary.completedAt, isAr ? "ar-EG" : "en-GB");
    const student = this.escapeHtml(summary.studentName);
    const subjects = this.escapeHtml((isAr ? summary.subject.ar : summary.subject.en).join("، "));
    const labels = isAr
      ? [`اسم الطالب: ${student}`, `النتيجة: ${summary.score}%`, `المادة: ${subjects}`, `التاريخ والوقت: ${date}`]
      : [`Student: ${student}`, `Score: ${summary.score}%`, `Subject: ${subjects}`, `Date and time: ${date}`];
    const sent = await this.email.send({ to, subject, html: `<ul>${labels.map((label) => `<li>${label}</li>`).join("")}</ul>` });
    await this.prisma.client.parentResultNotification.update({
      where: { id }, data: { emailStatus: sent.sent ? "SENT" : "FAILED", emailFailureCode: sent.sent ? null : "PROVIDER_ERROR" },
    });
  }

  private formatDate(value: string, locale: string) {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo" }).format(new Date(value));
  }

  private escapeHtml(value: string) {
    return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
  }
}

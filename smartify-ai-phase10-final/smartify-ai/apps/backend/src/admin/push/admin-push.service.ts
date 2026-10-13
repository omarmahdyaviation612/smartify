import { Injectable, Logger } from "@nestjs/common";
import * as webpush from "web-push";
import { loadBackendEnv } from "@smartify/config";
import type { AdminPushSubscriptionInput } from "@smartify/validation";
import { PrismaService } from "../../prisma/prisma.service";

export interface AdminPushPayload {
  title: string;
  body: string;
  /** Page opened when the notification is tapped. */
  url: string;
  /** Notifications with the same tag replace each other on the device. */
  tag?: string;
}

interface StoredSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

const DEFAULT_SUBJECT = "mailto:admin@smartify-ai.com";

/**
 * Browser push for admins (2026-10-13): a pop-up on every device an admin
 * enabled, even when the site is closed. Same optionality as EmailService —
 * without WEB_PUSH_PUBLIC_KEY / WEB_PUSH_PRIVATE_KEY it reports itself as
 * disabled and sending is a no-op. Sending never throws.
 */
@Injectable()
export class AdminPushService {
  private readonly logger = new Logger(AdminPushService.name);

  constructor(private readonly prisma: PrismaService) {}

  private vapid() {
    const env = loadBackendEnv();
    if (!env.WEB_PUSH_PUBLIC_KEY || !env.WEB_PUSH_PRIVATE_KEY) return null;
    return { subject: env.WEB_PUSH_SUBJECT || DEFAULT_SUBJECT, publicKey: env.WEB_PUSH_PUBLIC_KEY, privateKey: env.WEB_PUSH_PRIVATE_KEY };
  }

  async config(userId: string) {
    const vapid = this.vapid();
    const devices = await this.prisma.client.adminPushSubscription.count({ where: { userId } });
    return { enabled: !!vapid, publicKey: vapid?.publicKey ?? null, devices };
  }

  async subscribe(userId: string, input: AdminPushSubscriptionInput, userAgent?: string) {
    const data = { userId, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: userAgent?.slice(0, 300) ?? null };
    await this.prisma.client.adminPushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: { endpoint: input.endpoint, ...data },
      update: data,
    });
    return this.config(userId);
  }

  async unsubscribe(userId: string, endpoint: string) {
    await this.prisma.client.adminPushSubscription.deleteMany({ where: { userId, endpoint } });
    return this.config(userId);
  }

  /** Every device of every active Super Admin / Admin. */
  async sendToAdmins(payload: AdminPushPayload) {
    const subscriptions = await this.prisma.client.adminPushSubscription.findMany({
      where: { user: { role: { in: ["SUPER_ADMIN", "ADMIN"] }, isActive: true, deletedAt: null } },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    return this.deliver(subscriptions, payload);
  }

  /** The caller's own devices — the "send test" button. */
  async sendTest(userId: string, payload: AdminPushPayload) {
    const subscriptions = await this.prisma.client.adminPushSubscription.findMany({
      where: { userId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    return this.deliver(subscriptions, payload);
  }

  private async deliver(subscriptions: StoredSubscription[], payload: AdminPushPayload) {
    const vapid = this.vapid();
    if (!vapid || subscriptions.length === 0) return { sent: 0, total: subscriptions.length };
    const body = JSON.stringify(payload);
    let sent = 0;
    await Promise.all(
      subscriptions.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
            vapidDetails: vapid,
            TTL: 6 * 60 * 60,
            urgency: "high",
          });
          sent++;
          await this.prisma.client.adminPushSubscription.update({ where: { id: s.id }, data: { lastSuccessAt: new Date() } }).catch(() => undefined);
        } catch (error: any) {
          const status = Number(error?.statusCode);
          if (status === 404 || status === 410) {
            await this.prisma.client.adminPushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
          } else {
            this.logger.warn(`Admin push to one device failed${status ? ` (HTTP ${status})` : ""}.`);
          }
        }
      }),
    );
    return { sent, total: subscriptions.length };
  }
}

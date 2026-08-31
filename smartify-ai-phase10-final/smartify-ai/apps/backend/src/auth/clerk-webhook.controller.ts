import {
  BadRequestException,
  Controller,
  Headers,
  Post,
  Req,
} from "@nestjs/common";
import { Request } from "express";
import { Webhook } from "svix";
import { SkipThrottle } from "@nestjs/throttler";
import { loadBackendEnv } from "@smartify/config";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Receives Clerk's user.created / user.updated / user.deleted events and
 * keeps the local User table in sync. This is a SYNC boundary only —
 * it never writes a `role`; new users always land as STUDENT and role
 * changes happen exclusively through an authenticated admin action.
 */
@Controller("webhooks/clerk")
@SkipThrottle() // provider webhooks shouldn't be subject to per-IP rate limits — the endpoint is protected by signature verification instead
export class ClerkWebhookController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  async handle(
    @Req() req: Request,
    @Headers("svix-id") svixId: string,
    @Headers("svix-timestamp") svixTimestamp: string,
    @Headers("svix-signature") svixSignature: string,
  ) {
    const env = loadBackendEnv();
    const wh = new Webhook(env.CLERK_WEBHOOK_SIGNING_SECRET);

    let event: any;
    try {
      // req.body must be the raw request buffer here — configure the
      // webhook route with express.raw({ type: "application/json" })
      // ahead of Nest's default JSON body parser.
      event = wh.verify(req.body, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      });
    } catch {
      throw new BadRequestException("Invalid webhook signature.");
    }

    const { type, data } = event;

    if (type === "user.created" || type === "user.updated") {
      const primaryEmail = data.email_addresses?.find(
        (e: any) => e.id === data.primary_email_address_id,
      )?.email_address;

      if (!primaryEmail) {
        throw new BadRequestException("Clerk payload missing primary email.");
      }

      await this.prisma.client.user.upsert({
        where: { clerkUserId: data.id },
        update: { email: primaryEmail },
        create: {
          clerkUserId: data.id,
          email: primaryEmail,
          role: "STUDENT", // default; changed only via admin action, never from Clerk data
        },
      });
    }

    if (type === "user.deleted") {
      await this.prisma.client.user.updateMany({
        where: { clerkUserId: data.id },
        data: { isActive: false, deletedAt: new Date() },
      });
    }

    return { received: true };
  }
}

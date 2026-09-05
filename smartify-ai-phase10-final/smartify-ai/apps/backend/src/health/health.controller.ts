import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("live")
  live() {
    return { status: "ok" };
  }

  @Get("ready")
  async ready() {
    try {
      await this.prisma.client.$queryRaw`SELECT 1`;
      return { status: "ready", database: "up" };
    } catch {
      throw new ServiceUnavailableException({ status: "not-ready", database: "down" });
    }
  }
}

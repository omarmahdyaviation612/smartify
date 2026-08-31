import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class AdminPaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  listProviders() {
    return this.prisma.client.paymentProviderConfig.findMany();
  }

  async updateProvider(providerKey: string, data: { isActive?: boolean; publicConfig?: unknown }) {
    // Phase 10 concurrency fix — same reasoning as AdminAIConfigService:
    // a single atomic UPDATE statement (not a read-then-write pair)
    // eliminates the window where two concurrent activations of
    // different providers could both end up active.
    if (data.isActive) {
      await this.prisma.client.$executeRaw`
        UPDATE "PaymentProviderConfig" SET "isActive" = ("providerKey" = ${providerKey}), "updatedAt" = now();
      `;
    }

    if (data.publicConfig !== undefined) {
      return this.prisma.client.paymentProviderConfig.update({
        where: { providerKey },
        data: { publicConfig: data.publicConfig as any },
      });
    }
    return this.prisma.client.paymentProviderConfig.findUnique({ where: { providerKey } });
  }
}

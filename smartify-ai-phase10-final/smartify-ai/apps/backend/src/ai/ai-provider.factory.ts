import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { OpenAIProvider } from "./providers/openai.provider";
import { AnthropicProvider } from "./providers/anthropic.provider";
import { LocalModelProvider } from "./providers/local-model.provider";
import type { AIProvider } from "./ai-provider.interface";

/**
 * Resolves the active AIProvider from AIProviderConfig in the database —
 * feature code never hardcodes "openai" anywhere. Swapping the active
 * provider (or its model) is an admin-panel/DB change, not a deploy.
 */
@Injectable()
export class AIProviderFactory {
  constructor(private readonly prisma: PrismaService) {}

  async getActiveProvider(): Promise<{ provider: AIProvider; providerKey: string; model: string }> {
    const config = await this.prisma.client.aIProviderConfig.findFirst({ where: { isActive: true } });

    if (!config) {
      throw new ServiceUnavailableException("No active AI provider is configured.");
    }

    switch (config.providerKey) {
      case "openai":
        return { provider: new OpenAIProvider(config.model), providerKey: config.providerKey, model: config.model };
      case "anthropic":
        return { provider: new AnthropicProvider(), providerKey: config.providerKey, model: config.model };
      case "local":
        return { provider: new LocalModelProvider(), providerKey: config.providerKey, model: config.model };
      default:
        throw new ServiceUnavailableException(`Unknown AI provider key: ${config.providerKey}`);
    }
  }

  async getCostRates(providerKey: string): Promise<{ costPerInputToken: number; costPerOutputToken: number }> {
    const config = await this.prisma.client.aIProviderConfig.findUnique({ where: { providerKey } });
    if (!config) return { costPerInputToken: 0, costPerOutputToken: 0 };
    return {
      costPerInputToken: Number(config.costPerInputToken),
      costPerOutputToken: Number(config.costPerOutputToken),
    };
  }
}

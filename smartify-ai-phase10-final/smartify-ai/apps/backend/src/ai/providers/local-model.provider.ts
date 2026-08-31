import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { AIGenerateRequest, AIGenerateResult, AIProvider } from "../ai-provider.interface";

/** Stub — reserved for a future self-hosted/local model provider. See anthropic.provider.ts for the same note. */
@Injectable()
export class LocalModelProvider implements AIProvider {
  async generate(_request: AIGenerateRequest): Promise<AIGenerateResult> {
    throw new ServiceUnavailableException("Local model provider is not implemented yet.");
  }
}

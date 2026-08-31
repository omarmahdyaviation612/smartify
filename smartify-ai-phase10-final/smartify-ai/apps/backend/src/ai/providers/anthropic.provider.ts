import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { AIGenerateRequest, AIGenerateResult, AIProvider } from "../ai-provider.interface";

/**
 * Stub — reserved for a future Anthropic provider behind the same
 * AIProvider interface. Not wired into AIProviderFactory until a real
 * integration is built; exists now purely so the provider-swap story in
 * the architecture doc is backed by an actual (if inert) class.
 */
@Injectable()
export class AnthropicProvider implements AIProvider {
  async generate(_request: AIGenerateRequest): Promise<AIGenerateResult> {
    throw new ServiceUnavailableException("Anthropic provider is not implemented yet.");
  }
}

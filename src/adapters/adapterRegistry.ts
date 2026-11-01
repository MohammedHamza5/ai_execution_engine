import { ProviderAdapter } from "./types.js";
import { GeminiProviderAdapter } from "./geminiAdapter.js";
import { GroqProviderAdapter } from "./groqAdapter.js";
import { CloudflareProviderAdapter } from "./cloudflareAdapter.js";
import { OpenRouterProviderAdapter } from "./openrouterAdapter.js";
import {
  OpenAICompatibleProviderAdapter,
  OpenAICompatibleConfig,
} from "./openAICompatibleAdapter.js";

export class ProviderAdapterRegistry {
  private readonly adapters: Map<string, ProviderAdapter> = new Map();

  constructor(prepopulate: boolean = true) {
    if (prepopulate) {
      this.registerAdapter("gemini", new GeminiProviderAdapter());
      this.registerAdapter("groq", new GroqProviderAdapter());
      this.registerAdapter("cloudflare", new CloudflareProviderAdapter());
      this.registerAdapter("openrouter", new OpenRouterProviderAdapter());
      this.registerOpenAICompatible({
        providerId: "cerebras",
        baseUrl: "https://api.cerebras.ai/v1",
        defaultModel: "llama3.3-70b",
      });
      this.registerOpenAICompatible({
        providerId: "mistral",
        baseUrl: "https://api.mistral.ai/v1",
        defaultModel: "mistral-small-latest",
      });
    }
  }

  public registerOpenAICompatible(config: OpenAICompatibleConfig): void {
    this.registerAdapter(config.providerId, new OpenAICompatibleProviderAdapter(config));
  }

  public registerAdapter(providerSlug: string, adapter: ProviderAdapter): void {
    if (!providerSlug || !adapter) {
      throw new Error("Provider slug and adapter must be provided");
    }
    this.adapters.set(providerSlug.toLowerCase(), adapter);
  }

  public getAdapter(providerSlug: string): ProviderAdapter | undefined {
    const slug = providerSlug.toLowerCase();
    if (this.adapters.has(slug)) {
      return this.adapters.get(slug);
    }

    // Auto-register standard OpenAI-compatible providers on demand
    const knownEndpoints: Record<string, { baseUrl: string; defaultModel: string }> = {
      deepseek: { baseUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat" },
      sambanova: { baseUrl: "https://api.sambanova.ai/v1", defaultModel: "Meta-Llama-3.1-70B-Instruct" },
      together: { baseUrl: "https://api.together.xyz/v1", defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
      cohere: { baseUrl: "https://api.cohere.com/v2", defaultModel: "command-r" },
    };

    if (knownEndpoints[slug]) {
      this.registerOpenAICompatible({
        providerId: slug,
        baseUrl: knownEndpoints[slug].baseUrl,
        defaultModel: knownEndpoints[slug].defaultModel,
      });
      return this.adapters.get(slug);
    }

    return undefined;
  }

  public hasAdapter(providerSlug: string): boolean {
    return this.adapters.has(providerSlug.toLowerCase());
  }

  public getAllAdapters(): ReadonlyMap<string, ProviderAdapter> {
    return this.adapters;
  }

  public clone(): ProviderAdapterRegistry {
    const copy = new ProviderAdapterRegistry(false);
    for (const [slug, adapter] of this.adapters.entries()) {
      copy.registerAdapter(slug, adapter);
    }
    return copy;
  }
}

export const providerAdapterRegistry = new ProviderAdapterRegistry(true);

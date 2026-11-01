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
    return this.adapters.get(providerSlug.toLowerCase());
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

import { FleetResourceConfig } from "../fleetSeedConfig.js";

export function getCloudflareFleet(): FleetResourceConfig[] {
  return [
    {
      providerSlug: "cloudflare",
      providerName: "Cloudflare Workers AI",
      providerType: "direct",
      modelSlug: "@cf/meta/llama-3.1-8b-instruct",
      modelName: "Cloudflare Llama 3.1 8B Instruct",
      modelFamily: "llama",
      capabilities: ["text", "json", "utility", "edge"],
      credentialName: "Cloudflare Workers AI Token",
      secretRef: "env:CLOUDFLARE_API_TOKEN_1",
      priority: 80,
      rpmQuota: 60,
      taxonomy: {
        modalities: {
          inputs: ["TEXT"],
          outputs: ["TEXT", "STRUCTURED_JSON"],
        },
        archetype: "FAST_REFLEX",
        tier: "EDGE_LIGHT",
      },
    },
    {
      providerSlug: "cloudflare",
      providerName: "Cloudflare Workers AI",
      providerType: "direct",
      modelSlug: "@cf/baai/bge-large-en-v1.5",
      modelName: "Cloudflare BGE Large Embeddings",
      modelFamily: "bge",
      capabilities: ["embeddings", "vector"],
      credentialName: "Cloudflare Workers AI Token",
      secretRef: "env:CLOUDFLARE_API_TOKEN_1",
      priority: 80,
      rpmQuota: 100,
      taxonomy: {
        modalities: {
          inputs: ["TEXT"],
          outputs: ["EMBEDDING"],
        },
        archetype: "EMBEDDING_RETRIEVAL",
        tier: "EDGE_LIGHT",
        specializedDomains: ["SEMANTIC_SEARCH", "VECTOR_EMBEDDINGS"],
      },
    },
  ];
}

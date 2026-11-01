export interface ProviderSeedConfig {
  providerId: string;
  providerName: string;
  providerSlug: string;
  providerType: string;
  modelId: string;
  modelName: string;
  modelSlug: string;
  modelFamily: string;
  credentialId: string;
  credentialName: string;
  secretRef: string;
  resourceId: string;
  quotaId: string;
  priority: number;
}

function makeUUID(ns: string, id: number): string {
  return `01924b00-0000-7000-${ns}-${id.toString(16).padStart(12, "0")}`;
}

export const LIVE_PROVIDERS: ProviderSeedConfig[] = [
  // Base Compatibility Slots (M0-M4 Invariant)
  {
    providerId: "01924b00-0000-7000-8000-000000000001",
    providerName: "Google DeepMind",
    providerSlug: "gemini",
    providerType: "direct",
    modelId: "01924b00-0000-7000-8000-000000000002",
    modelName: "Gemini 3.8 Flash (Planner)",
    modelSlug: "gemini-3.8-flash",
    modelFamily: "gemini",
    credentialId: "01924b00-0000-7000-8000-000000000003",
    credentialName: "Platform Gemini Credential Slot 1",
    secretRef: "env:GEMINI_API_KEY_1",
    resourceId: "01924b00-0000-7000-8000-000000000004",
    quotaId: "01924b00-0000-7000-8000-000000000005",
    priority: 100,
  },
  {
    providerId: "01924b00-0000-7000-8000-000000000011",
    providerName: "Groq",
    providerSlug: "groq",
    providerType: "direct",
    modelId: "01924b00-0000-7000-8000-000000000012",
    modelName: "GPT-OSS 120B Reasoning",
    modelSlug: "openai/gpt-oss-120b",
    modelFamily: "gpt-oss",
    credentialId: "01924b00-0000-7000-8000-000000000013",
    credentialName: "Platform Groq Credential Slot 1",
    secretRef: "env:GROQ_API_KEY_1",
    resourceId: "01924b00-0000-7000-8000-000000000014",
    quotaId: "01924b00-0000-7000-8000-000000000015",
    priority: 100,
  },
  {
    providerId: "01924b00-0000-7000-8000-000000000021",
    providerName: "Cloudflare Workers AI",
    providerSlug: "cloudflare",
    providerType: "direct",
    modelId: "01924b00-0000-7000-8000-000000000022",
    modelName: "Cloudflare Llama 3.1 8B Instruct",
    modelSlug: "@cf/meta/llama-3.1-8b-instruct",
    modelFamily: "llama",
    credentialId: "01924b00-0000-7000-8000-000000000023",
    credentialName: "Platform Cloudflare Credential",
    secretRef: "env:CLOUDFLARE_API_TOKEN_1",
    resourceId: "01924b00-0000-7000-8000-000000000024",
    quotaId: "01924b00-0000-7000-8000-000000000025",
    priority: 80,
  },
  {
    providerId: "01924b00-0000-7000-8000-000000000031",
    providerName: "OpenRouter",
    providerSlug: "openrouter",
    providerType: "aggregator",
    modelId: "01924b00-0000-7000-8000-000000000032",
    modelName: "LiquidAI LFM 2.5 2.6B Free",
    modelSlug: "liquid/lfm-2.5-2.6b:free",
    modelFamily: "lfm",
    credentialId: "01924b00-0000-7000-8000-000000000033",
    credentialName: "Platform OpenRouter Credential Slot 1",
    secretRef: "env:OPENROUTER_API_KEY_1",
    resourceId: "01924b00-0000-7000-8000-000000000034",
    quotaId: "01924b00-0000-7000-8000-000000000035",
    priority: 60,
  },
  {
    providerId: "01924b00-0000-7000-8000-000000000041",
    providerName: "Cerebras",
    providerSlug: "cerebras",
    providerType: "inference",
    modelId: "01924b00-0000-7000-8000-000000000042",
    modelName: "Cerebras Llama 3.3 70B",
    modelSlug: "llama3.3-70b",
    modelFamily: "llama",
    credentialId: "01924b00-0000-7000-8000-000000000043",
    credentialName: "Platform Cerebras Credential",
    secretRef: "env:CEREBRAS_API_KEY_1",
    resourceId: "01924b00-0000-7000-8000-000000000044",
    quotaId: "01924b00-0000-7000-8000-000000000045",
    priority: 9,
  },
  {
    providerId: "01924b00-0000-7000-8000-000000000051",
    providerName: "Mistral AI",
    providerSlug: "mistral",
    providerType: "foundation",
    modelId: "01924b00-0000-7000-8000-000000000052",
    modelName: "Mistral Small",
    modelSlug: "mistral-small-latest",
    modelFamily: "mistral",
    credentialId: "01924b00-0000-7000-8000-000000000053",
    credentialName: "Platform Mistral Credential",
    secretRef: "env:MISTRAL_API_KEY_1",
    resourceId: "01924b00-0000-7000-8000-000000000054",
    quotaId: "01924b00-0000-7000-8000-000000000055",
    priority: 8,
  },

  // Gemini Fleet Slots 2-5
  ...[
    { name: "Gemini 3.8 Flash (Synthesizer)", prio: 95 },
    { name: "Gemini 3.8 Flash (Docs)", prio: 90 },
    { name: "Gemini 3.8 Flash (Arbitrator)", prio: 85 },
    { name: "Gemini 3.8 Flash (Cold Reserve)", prio: 10 },
  ].map((g, i) => ({
    providerId: "01924b00-0000-7000-8000-000000000001",
    providerName: "Google DeepMind",
    providerSlug: "gemini",
    providerType: "direct",
    modelId: "01924b00-0000-7000-8000-000000000002",
    modelName: g.name,
    modelSlug: "gemini-3.8-flash",
    modelFamily: "gemini",
    credentialId: makeUUID("8010", i + 2),
    credentialName: `Platform Gemini Slot ${i + 2}`,
    secretRef: `env:GEMINI_API_KEY_${i + 2}`,
    resourceId: makeUUID("8020", i + 2),
    quotaId: makeUUID("8030", i + 2),
    priority: g.prio,
  })),

  // Groq Fleet Slots 2-5
  ...[
    { name: "Qwen 3.8 27B", slug: "qwen/qwen3.8-27b", fam: "qwen", prio: 95 },
    { name: "GPT-OSS 20B Critic", slug: "openai/gpt-oss-20b", fam: "gpt-oss", prio: 90 },
    { name: "Allam 2 7B Arabic", slug: "allam-2-7b", fam: "allam", prio: 85 },
    { name: "Qwen 3.8 27B (Reserve)", slug: "qwen/qwen3.8-27b", fam: "qwen", prio: 10 },
  ].map((q, i) => ({
    providerId: "01924b00-0000-7000-8000-000000000011",
    providerName: "Groq",
    providerSlug: "groq",
    providerType: "direct",
    modelId: makeUUID("8040", i + 2),
    modelName: q.name,
    modelSlug: q.slug,
    modelFamily: q.fam,
    credentialId: makeUUID("8011", i + 2),
    credentialName: `Platform Groq Slot ${i + 2}`,
    secretRef: `env:GROQ_API_KEY_${i + 2}`,
    resourceId: makeUUID("8021", i + 2),
    quotaId: makeUUID("8031", i + 2),
    priority: q.prio,
  })),

  // Cloudflare Embeddings Slot 2
  {
    providerId: "01924b00-0000-7000-8000-000000000021",
    providerName: "Cloudflare Workers AI",
    providerSlug: "cloudflare",
    providerType: "direct",
    modelId: makeUUID("8050", 2),
    modelName: "Cloudflare BGE Large Embeddings",
    modelSlug: "@cf/baai/bge-large-en-v1.5",
    modelFamily: "bge",
    credentialId: "01924b00-0000-7000-8000-000000000023",
    credentialName: "Platform Cloudflare Credential",
    secretRef: "env:CLOUDFLARE_API_TOKEN_1",
    resourceId: makeUUID("8022", 2),
    quotaId: makeUUID("8032", 2),
    priority: 80,
  },

  // OpenRouter Fleet Slots 2-5
  ...[
    { name: "Google Gemma 4 31B Free", slug: "google/gemma-4-31b-it:free", fam: "gemma", prio: 60 },
    { name: "Cohere North Mini Code Free", slug: "cohere/north-mini-code:free", fam: "north", prio: 50 },
    { name: "NVIDIA Nemotron 3.5 Lightning Free", slug: "nvidia/nemotron-3.5-lightning:free", fam: "nemotron", prio: 50 },
    { name: "LiquidAI LFM 2.5 2.6B (Reserve)", slug: "liquid/lfm-2.5-2.6b:free", fam: "lfm", prio: 10 },
  ].map((o, i) => ({
    providerId: "01924b00-0000-7000-8000-000000000031",
    providerName: "OpenRouter",
    providerSlug: "openrouter",
    providerType: "aggregator",
    modelId: makeUUID("8060", i + 2),
    modelName: o.name,
    modelSlug: o.slug,
    modelFamily: o.fam,
    credentialId: makeUUID("8013", i + 2),
    credentialName: `Platform OpenRouter Slot ${i + 2}`,
    secretRef: `env:OPENROUTER_API_KEY_${i + 2}`,
    resourceId: makeUUID("8023", i + 2),
    quotaId: makeUUID("8033", i + 2),
    priority: o.prio,
  })),
];

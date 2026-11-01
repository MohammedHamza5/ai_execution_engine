import { FleetResourceConfig } from "../fleetSeedConfig.js";

export function getGroqFleet(): FleetResourceConfig[] {
  const textOnly = {
    inputs: ["TEXT"] as const,
    outputs: ["TEXT"] as const,
  };
  const textAndJson = {
    inputs: ["TEXT"] as const,
    outputs: ["TEXT", "STRUCTURED_JSON"] as const,
  };

  return [
    {
      providerSlug: "groq",
      providerName: "GroqCloud",
      providerType: "direct",
      modelSlug: "openai/gpt-oss-120b",
      modelName: "GPT-OSS 120B (Groq Reasoning)",
      modelFamily: "gpt-oss",
      capabilities: ["text", "reasoning", "math", "architecture"],
      credentialName: "Groq Fleet Slot 1 (Reasoning)",
      secretRef: "env:GROQ_API_KEY_1",
      priority: 100,
      rpmQuota: 30,
      taxonomy: {
        modalities: textOnly,
        archetype: "REASONING_DELIBERATIVE",
        tier: "FRONTIER_HEAVYWEIGHT",
        specializedDomains: ["REASONING", "MATH", "SYSTEMS_ARCHITECTURE"],
      },
    },
    {
      providerSlug: "groq",
      providerName: "GroqCloud",
      providerType: "direct",
      modelSlug: "qwen/qwen3.8-27b",
      modelName: "Qwen 3.8 27B",
      modelFamily: "qwen",
      capabilities: ["text", "code", "json", "fast"],
      credentialName: "Groq Fleet Slot 2 (Code & JSON)",
      secretRef: "env:GROQ_API_KEY_2",
      priority: 95,
      rpmQuota: 30,
      taxonomy: {
        modalities: textAndJson,
        archetype: "FAST_REFLEX",
        tier: "BALANCED_WORKHORSE",
        specializedDomains: ["FAST_CODE", "STRUCTURED_DATA"],
      },
    },
    {
      providerSlug: "groq",
      providerName: "GroqCloud",
      providerType: "direct",
      modelSlug: "openai/gpt-oss-20b",
      modelName: "GPT-OSS 20B (Groq Critic)",
      modelFamily: "gpt-oss",
      capabilities: ["text", "critic", "validation"],
      credentialName: "Groq Fleet Slot 3 (Independent Critic)",
      secretRef: "env:GROQ_API_KEY_3",
      priority: 90,
      rpmQuota: 30,
      taxonomy: {
        modalities: textOnly,
        archetype: "CLASSIFICATION_GUARD",
        tier: "BALANCED_WORKHORSE",
        specializedDomains: ["CRITIC", "ARBITRATION"],
      },
    },
    {
      providerSlug: "groq",
      providerName: "GroqCloud",
      providerType: "direct",
      modelSlug: "allam-2-7b",
      modelName: "Allam 2 7B (Arabic Specialist)",
      modelFamily: "allam",
      capabilities: ["text", "arabic", "nlp"],
      credentialName: "Groq Fleet Slot 4 (Arabic Specialist)",
      secretRef: "env:GROQ_API_KEY_4",
      priority: 85,
      rpmQuota: 30,
      taxonomy: {
        modalities: textOnly,
        archetype: "FAST_REFLEX",
        tier: "EDGE_LIGHT",
        specializedDomains: ["ARABIC_NLP", "LOCALIZATION"],
      },
    },
    {
      providerSlug: "groq",
      providerName: "GroqCloud",
      providerType: "direct",
      modelSlug: "qwen/qwen3.8-27b",
      modelName: "Qwen 3.8 27B (Groq Reserve)",
      modelFamily: "qwen",
      capabilities: ["text", "code", "fast"],
      credentialName: "Groq Fleet Slot 5 (Cold Reserve)",
      secretRef: "env:GROQ_API_KEY_5",
      priority: 10,
      rpmQuota: 30,
      taxonomy: {
        modalities: textAndJson,
        archetype: "FAST_REFLEX",
        tier: "BALANCED_WORKHORSE",
      },
    },
  ];
}

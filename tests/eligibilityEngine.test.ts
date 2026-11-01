import { describe, it, expect } from "vitest";
import { EligibilityEngine } from "../src/engine/eligibilityEngine.js";
import { NormalizedResourceCandidate } from "../src/domain/resource/stateTypes.js";

describe("M4.3 — Eligibility Engine & Batch A Gate Tests", () => {
  // 10 Candidate Resources representing diverse provider, quota, capability, and health states
  const candidates: NormalizedResourceCandidate[] = [
    // 1. Healthy Free Gemini Flash
    {
      resourceId: "res-01-gemini-flash",
      providerId: "prov-google",
      providerSlug: "gemini",
      providerName: "Google DeepMind",
      modelId: "mod-gemini-flash",
      modelSlug: "gemini-1.5-flash",
      modelName: "Gemini 1.5 Flash",
      billingClass: "FREE",
      isPaid: false,
      capabilities: ["TEXT_GENERATION", "CODE", "JSON"],
      health: "HEALTHY",
      status: "active",
      quotas: [{ type: "RPM", remaining: 1000, confidence: 1.0 }],
      primaryQuotaRemaining: 1000,
      rateLimit: { isRateLimited: false },
      priority: 10,
      observedAt: new Date(),
      confidence: 1.0,
    },
    // 2. Healthy Free Groq Llama
    {
      resourceId: "res-02-groq-llama",
      providerId: "prov-groq",
      providerSlug: "groq",
      providerName: "Groq",
      modelId: "mod-llama-3.3",
      modelSlug: "llama-3.3-70b-versatile",
      modelName: "Llama 3.3 70B",
      billingClass: "FREE",
      isPaid: false,
      capabilities: ["TEXT_GENERATION", "CODE"],
      health: "HEALTHY",
      status: "active",
      quotas: [{ type: "RPM", remaining: 500, confidence: 0.9 }],
      primaryQuotaRemaining: 500,
      rateLimit: { isRateLimited: false },
      priority: 8,
      observedAt: new Date(),
      confidence: 0.9,
    },
    // 3. Healthy Free Mistral (With VISION capability)
    {
      resourceId: "res-03-mistral-small",
      providerId: "prov-mistral",
      providerSlug: "mistral",
      providerName: "Mistral AI",
      modelId: "mod-pixtral-12b",
      modelSlug: "pixtral-12b-2409",
      modelName: "Pixtral 12B",
      billingClass: "FREE",
      isPaid: false,
      capabilities: ["TEXT_GENERATION", "JSON", "VISION"],
      health: "HEALTHY",
      status: "active",
      quotas: [{ type: "RPM", remaining: 300, confidence: 0.85 }],
      primaryQuotaRemaining: 300,
      rateLimit: { isRateLimited: false },
      priority: 7,
      observedAt: new Date(),
      confidence: 0.85,
    },
    // 4. Paid GPT-4o (Paid Tier)
    {
      resourceId: "res-04-openai-gpt4o",
      providerId: "prov-openai",
      providerSlug: "openai",
      providerName: "OpenAI",
      modelId: "mod-gpt4o",
      modelSlug: "gpt-4o",
      modelName: "GPT-4o",
      billingClass: "PAID",
      isPaid: true,
      capabilities: ["TEXT_GENERATION", "CODE", "VISION", "MATH"],
      health: "HEALTHY",
      status: "active",
      quotas: [{ type: "RPM", remaining: 10000, confidence: 1.0 }],
      primaryQuotaRemaining: 10000,
      rateLimit: { isRateLimited: false },
      priority: 9,
      observedAt: new Date(),
      confidence: 1.0,
    },
    // 5. Free DeepSeek (Quota Exhausted)
    {
      resourceId: "res-05-deepseek-v3",
      providerId: "prov-deepseek",
      providerSlug: "deepseek",
      providerName: "DeepSeek",
      modelId: "mod-deepseek-v3",
      modelSlug: "deepseek-chat",
      modelName: "DeepSeek V3",
      billingClass: "FREE",
      isPaid: false,
      capabilities: ["TEXT_GENERATION", "CODE"],
      health: "HEALTHY",
      status: "active",
      quotas: [{ type: "RPM", remaining: 0, confidence: 1.0 }],
      primaryQuotaRemaining: 0, // EXHAUSTED
      rateLimit: { isRateLimited: false },
      priority: 6,
      observedAt: new Date(),
      confidence: 1.0,
    },
    // 6. Free Qwen (Health: UNAVAILABLE)
    {
      resourceId: "res-06-qwen-2.5",
      providerId: "prov-alibaba",
      providerSlug: "qwen",
      providerName: "Alibaba Cloud",
      modelId: "mod-qwen-2.5",
      modelSlug: "qwen-2.5-72b",
      modelName: "Qwen 2.5 72B",
      billingClass: "FREE",
      isPaid: false,
      capabilities: ["TEXT_GENERATION", "CODE"],
      health: "UNAVAILABLE", // DOWN
      status: "active",
      quotas: [{ type: "RPM", remaining: 1000, confidence: 0.5 }],
      primaryQuotaRemaining: 1000,
      rateLimit: { isRateLimited: false },
      priority: 5,
      observedAt: new Date(),
      confidence: 0.5,
    },
    // 7. Free Llama (Temporarily Rate-Limited)
    {
      resourceId: "res-07-llama-ratelimited",
      providerId: "prov-groq",
      providerSlug: "groq",
      providerName: "Groq",
      modelId: "mod-llama-8b",
      modelSlug: "llama-3.1-8b-instant",
      modelName: "Llama 3.1 8B",
      billingClass: "FREE",
      isPaid: false,
      capabilities: ["TEXT_GENERATION", "CODE"],
      health: "DEGRADED",
      status: "active",
      quotas: [{ type: "RPM", remaining: 100, confidence: 0.8 }],
      primaryQuotaRemaining: 100,
      rateLimit: {
        isRateLimited: true,
        cooldownUntil: new Date(Date.now() + 60_000), // in 60s
      },
      priority: 4,
      observedAt: new Date(),
      confidence: 0.8,
    },
    // 8. Inactive / Disabled Resource
    {
      resourceId: "res-08-disabled-granite",
      providerId: "prov-ibm",
      providerSlug: "ibm",
      providerName: "IBM",
      modelId: "mod-granite-3",
      modelSlug: "granite-3-8b",
      modelName: "Granite 3 8B",
      billingClass: "FREE",
      isPaid: false,
      capabilities: ["TEXT_GENERATION"],
      health: "HEALTHY",
      status: "disabled", // DISABLED
      quotas: [{ type: "RPM", remaining: 1000, confidence: 1.0 }],
      primaryQuotaRemaining: 1000,
      rateLimit: { isRateLimited: false },
      priority: 3,
      observedAt: new Date(),
      confidence: 1.0,
    },
    // 9. Revoked Credential
    {
      resourceId: "res-09-revoked-gemini-pro",
      providerId: "prov-google",
      providerSlug: "gemini",
      providerName: "Google DeepMind",
      modelId: "mod-gemini-pro",
      modelSlug: "gemini-1.5-pro",
      modelName: "Gemini 1.5 Pro",
      credentialId: "cred-revoked",
      secretReference: "revoked", // REVOKED
      billingClass: "FREE",
      isPaid: false,
      capabilities: ["TEXT_GENERATION", "REASONING"],
      health: "HEALTHY",
      status: "active",
      quotas: [{ type: "RPM", remaining: 50, confidence: 1.0 }],
      primaryQuotaRemaining: 50,
      rateLimit: { isRateLimited: false },
      priority: 12,
      observedAt: new Date(),
      confidence: 1.0,
    },
    // 10. Failed Resource (Will be tested in excluded list)
    {
      resourceId: "res-10-failed-resource",
      providerId: "prov-google",
      providerSlug: "gemini",
      providerName: "Google DeepMind",
      modelId: "mod-gemini-flash",
      modelSlug: "gemini-1.5-flash",
      modelName: "Gemini 1.5 Flash (Attempt 1)",
      billingClass: "FREE",
      isPaid: false,
      capabilities: ["TEXT_GENERATION", "CODE"],
      health: "HEALTHY",
      status: "active",
      quotas: [{ type: "RPM", remaining: 1000, confidence: 1.0 }],
      primaryQuotaRemaining: 1000,
      rateLimit: { isRateLimited: false },
      priority: 10,
      observedAt: new Date(),
      confidence: 1.0,
    },
  ];

  it("Batch A Gate: filters 10 candidate resources to exactly eligible subset with zero silent spend", () => {
    // Standard task: allowPaid = false, excluded resource res-10
    const result = EligibilityEngine.filter(candidates, {
      policy: { allowPaid: false },
      excludedResourceIds: ["res-10-failed-resource"],
    });

    expect(result.totalCandidates).toBe(10);

    // Exactly 3 resources are eligible: res-01, res-02, res-03
    expect(result.eligible).toHaveLength(3);
    const eligibleIds = result.eligible.map((r) => r.resourceId);
    expect(eligibleIds).toEqual(["res-01-gemini-flash", "res-02-groq-llama", "res-03-mistral-small"]);

    // Exactly 7 resources are excluded with precise, deterministic rejection codes
    expect(result.excluded).toHaveLength(7);

    const exclusionMap = new Map(result.excluded.map((e) => [e.candidate.resourceId, e.rejectionReason]));
    expect(exclusionMap.get("res-04-openai-gpt4o")).toBe("PAID_UNAUTHORIZED");
    expect(exclusionMap.get("res-05-deepseek-v3")).toBe("QUOTA_EXHAUSTED");
    expect(exclusionMap.get("res-06-qwen-2.5")).toBe("HEALTH_UNAVAILABLE");
    expect(exclusionMap.get("res-07-llama-ratelimited")).toBe("RATE_LIMITED");
    expect(exclusionMap.get("res-08-disabled-granite")).toBe("RESOURCE_INACTIVE");
    expect(exclusionMap.get("res-09-revoked-gemini-pro")).toBe("CREDENTIAL_INVALID");
    expect(exclusionMap.get("res-10-failed-resource")).toBe("EXCLUDED_RESOURCE");
  });

  it("capability filtering: non-negotiable functional gate filters out non-compliant models", () => {
    // Task requires VISION capability, allowPaid = false
    const result = EligibilityEngine.filter(candidates, {
      requirements: { requiredCapabilities: ["VISION"] },
      policy: { allowPaid: false },
    });

    // Only res-03 (Pixtral 12B) has VISION and is free & healthy
    expect(result.eligible).toHaveLength(1);
    expect(result.eligible[0].resourceId).toBe("res-03-mistral-small");

    const geminiExcluded = result.excluded.find((e) => e.candidate.resourceId === "res-01-gemini-flash")!;
    expect(geminiExcluded.rejectionReason).toBe("CAPABILITY_UNSUPPORTED");

    const gpt4oExcluded = result.excluded.find((e) => e.candidate.resourceId === "res-04-openai-gpt4o")!;
    expect(gpt4oExcluded.rejectionReason).toBe("PAID_UNAUTHORIZED");
  });

  it("economic authorization: paid resource is admitted ONLY when allowPaid is true", () => {
    // Task requires VISION and explicitly permits paid execution
    const result = EligibilityEngine.filter(candidates, {
      requirements: { requiredCapabilities: ["VISION"] },
      policy: { allowPaid: true },
    });

    // Both res-03 (free Pixtral) AND res-04 (paid GPT-4o) are eligible
    expect(result.eligible).toHaveLength(2);
    const eligibleIds = result.eligible.map((r) => r.resourceId);
    expect(eligibleIds).toContain("res-03-mistral-small");
    expect(eligibleIds).toContain("res-04-openai-gpt4o");
  });

  it("determinism: 100 consecutive executions produce identical eligibility partitions", () => {
    const reference = EligibilityEngine.filter(candidates, {
      policy: { allowPaid: false },
      requirements: { requiredCapabilities: ["CODE"] },
      excludedResourceIds: ["res-10-failed-resource"],
    });

    for (let i = 0; i < 100; i++) {
      const trial = EligibilityEngine.filter(candidates, {
        policy: { allowPaid: false },
        requirements: { requiredCapabilities: ["CODE"] },
        excludedResourceIds: ["res-10-failed-resource"],
      });

      expect(trial.eligible.map((r) => r.resourceId)).toEqual(reference.eligible.map((r) => r.resourceId));
      expect(trial.excluded.map((e) => e.rejectionReason)).toEqual(reference.excluded.map((e) => e.rejectionReason));
    }
  });
});

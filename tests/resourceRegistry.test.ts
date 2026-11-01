import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrator.js";
import { resourceDiscoveryRegistry, ResourceRegistryEntry } from "../src/resources/resourceRegistry.js";

describe("Milestone M4 Batch D — Resource Discovery Registry & Onboarding (M4.10 – M4.12)", () => {
  beforeEach(async () => {
    await runMigrations();
    await db.query("DELETE FROM resources.resource_registry;");
  });

  afterAll(async () => {
    await db.close();
  });

  describe("Task M4.10: Resource Discovery Registry", () => {
    it("registers and retrieves candidate resource with stable identity and normalized capabilities", async () => {
      const entry: ResourceRegistryEntry = {
        providerSlug: "gemini",
        providerName: "Google DeepMind",
        providerType: "direct",
        modelSlug: "gemini-2.0-flash",
        modelName: "Gemini 2.0 Flash",
        billingClass: "FREE",
        lifecycleStatus: "DOCUMENTATION_VERIFIED",
        capabilities: ["TEXT_GENERATION", "CODE", "JSON", "VISION", "TOOL_CALLING"],
        knownLimits: {
          rpm: 15,
          rpd: 1500,
          tpm: 1_000_000,
          contextTokens: 1_048_576,
          isKnownLimit: true,
        },
        documentationUrl: "https://ai.google.dev/pricing",
        evidence: {
          sourceUrl: "https://ai.google.dev/docs",
          verificationDate: "2026-10-17",
          evidenceStatus: "CONFIRMED",
        },
      };

      const id = await resourceDiscoveryRegistry.registerCandidate(entry);
      expect(id).toBeDefined();

      const retrieved = await resourceDiscoveryRegistry.getEntry("gemini", "gemini-2.0-flash");
      expect(retrieved).not.toBeNull();
      expect(retrieved?.providerSlug).toBe("gemini");
      expect(retrieved?.modelSlug).toBe("gemini-2.0-flash");
      expect(retrieved?.providerType).toBe("direct");
      expect(retrieved?.lifecycleStatus).toBe("DOCUMENTATION_VERIFIED");
      expect(retrieved?.capabilities).toEqual(["TEXT_GENERATION", "CODE", "JSON", "VISION", "TOOL_CALLING"]);
      expect(retrieved?.knownLimits?.rpm).toBe(15);
      expect(retrieved?.knownLimits?.rpd).toBe(1500);
    });

    it("lifecycle progression: updates status from DISCOVERED through to PRODUCTION_CANDIDATE", async () => {
      await resourceDiscoveryRegistry.registerCandidate({
        providerSlug: "groq",
        providerName: "GroqCloud",
        providerType: "direct",
        modelSlug: "llama-3.3-70b",
        modelName: "Llama 3.3 70B Versatile",
        billingClass: "FREE",
        lifecycleStatus: "DISCOVERED",
        capabilities: ["TEXT_GENERATION", "CODE"],
      });

      // 1. Initial state
      let entry = await resourceDiscoveryRegistry.getEntry("groq", "llama-3.3-70b");
      expect(entry?.lifecycleStatus).toBe("DISCOVERED");

      // 2. Progression: Documentation Verified
      await resourceDiscoveryRegistry.updateLifecycleStatus("groq", "llama-3.3-70b", "DOCUMENTATION_VERIFIED", {
        docVerifiedBy: "Senior Engineer",
      });
      entry = await resourceDiscoveryRegistry.getEntry("groq", "llama-3.3-70b");
      expect(entry?.lifecycleStatus).toBe("DOCUMENTATION_VERIFIED");

      // 3. Progression: Connectivity Verified
      await resourceDiscoveryRegistry.updateLifecycleStatus("groq", "llama-3.3-70b", "CONNECTIVITY_VERIFIED");
      entry = await resourceDiscoveryRegistry.getEntry("groq", "llama-3.3-70b");
      expect(entry?.lifecycleStatus).toBe("CONNECTIVITY_VERIFIED");

      // 4. Progression: Production Candidate
      await resourceDiscoveryRegistry.updateLifecycleStatus("groq", "llama-3.3-70b", "PRODUCTION_CANDIDATE");
      entry = await resourceDiscoveryRegistry.getEntry("groq", "llama-3.3-70b");
      expect(entry?.lifecycleStatus).toBe("PRODUCTION_CANDIDATE");
    });

    it("secret redaction: registry rejects or strips any API keys or tokens in evidence", async () => {
      await resourceDiscoveryRegistry.registerCandidate({
        providerSlug: "mistral",
        providerName: "Mistral AI",
        providerType: "direct",
        modelSlug: "mistral-small",
        modelName: "Mistral Small",
        billingClass: "FREE",
        lifecycleStatus: "DISCOVERED",
        capabilities: ["TEXT_GENERATION"],
        evidence: {
          sourceUrl: "https://mistral.ai",
          apiKey: "unauthorized-secret-key-12345", // Must be stripped!
          secretToken: "bearer-token-abcde",      // Must be stripped!
          notes: "Public documentation verified",
        } as any,
      });

      const rawRow = await db.query(
        "SELECT evidence FROM resources.resource_registry WHERE provider_slug = 'mistral';"
      );
      const evidenceJson = JSON.stringify(rawRow.rows[0].evidence);
      expect(evidenceJson).not.toContain("unauthorized-secret-key-12345");
      expect(evidenceJson).not.toContain("bearer-token-abcde");
      expect(evidenceJson).toContain("Public documentation verified");
    });

    it("deprecateCandidate transitions status to RETIRED without deleting record", async () => {
      await resourceDiscoveryRegistry.registerCandidate({
        providerSlug: "legacy-ai",
        providerName: "Legacy Provider",
        providerType: "direct",
        modelSlug: "old-model-v1",
        modelName: "Old Model V1",
        billingClass: "FREE",
        lifecycleStatus: "PRODUCTION_CANDIDATE",
        capabilities: ["TEXT_GENERATION"],
      });

      await resourceDiscoveryRegistry.deprecateCandidate("legacy-ai", "old-model-v1", "Provider sunsetting endpoint");

      const entry = await resourceDiscoveryRegistry.getEntry("legacy-ai", "old-model-v1");
      expect(entry?.lifecycleStatus).toBe("RETIRED");
      expect((entry?.evidence as any)?.retirementReason).toBe("Provider sunsetting endpoint");
    });
  });

  describe("Batch D Gate: Aggregator vs Direct Provider Modeling", () => {
    it("accurately represents direct provider and aggregator paths with provenance", async () => {
      // 1. Direct Provider (e.g. Groq)
      await resourceDiscoveryRegistry.registerCandidate({
        providerSlug: "groq",
        providerName: "GroqCloud",
        providerType: "direct",
        modelSlug: "llama-3.1-8b",
        modelName: "Llama 3.1 8B Instant",
        billingClass: "FREE",
        lifecycleStatus: "DOCUMENTATION_VERIFIED",
        capabilities: ["TEXT_GENERATION", "CODE", "JSON"],
        knownLimits: { rpm: 30, rpd: 14400, isKnownLimit: true },
      });

      // 2. Aggregator Gateway (e.g. OpenRouter routing to Meta Llama)
      await resourceDiscoveryRegistry.registerCandidate({
        providerSlug: "openrouter",
        providerName: "OpenRouter",
        providerType: "aggregator",
        upstreamProviderSlug: "meta",
        modelSlug: "meta-llama/llama-3.1-8b-instruct:free",
        modelName: "Meta Llama 3.1 8B Instruct (Free)",
        billingClass: "FREE",
        lifecycleStatus: "DOCUMENTATION_VERIFIED",
        capabilities: ["TEXT_GENERATION", "CODE"],
        knownLimits: { rpm: 20, rpd: 200, isKnownLimit: true },
        documentationUrl: "https://openrouter.ai/models",
      });

      // List all free candidates
      const freeCandidates = await resourceDiscoveryRegistry.listCandidates({ billingClass: "FREE" });
      expect(freeCandidates).toHaveLength(2);

      const direct = freeCandidates.find((c) => c.providerType === "direct")!;
      const aggregator = freeCandidates.find((c) => c.providerType === "aggregator")!;

      expect(direct.providerSlug).toBe("groq");
      expect(direct.upstreamProviderSlug).toBeUndefined();

      expect(aggregator.providerSlug).toBe("openrouter");
      expect(aggregator.upstreamProviderSlug).toBe("meta");
    });
  });
});

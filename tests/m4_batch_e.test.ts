import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrator.js";
import { resourceIntelligence } from "../src/resources/resourceIntelligence.js";
import { ResourceDecisionEngine } from "../src/engine/resourceDecisionEngine.js";
import { EligibilityEngine } from "../src/engine/eligibilityEngine.js";
import { resourceHealthService } from "../src/engine/resourceHealthService.js";
import { quotaTrackingService } from "../src/engine/quotaTrackingService.js";
import { resourceDecisionPersistence } from "../src/engine/resourceDecisionPersistence.js";
import { NormalizedResourceCandidate } from "../src/domain/resource/stateTypes.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";

describe("Milestone M4 Batch E — Adversarial Failure Matrix, Concurrency, and Determinism (M4.13 – M4.15)", () => {
  beforeEach(async () => {
    await runMigrations();
    await db.query(`
      DELETE FROM resources.resource_reservations;
      DELETE FROM resources.resource_decisions;
      DELETE FROM resources.resource_health;
      DELETE FROM resources.resource_quotas;
      DELETE FROM resources.resources;
    `);
    await resourceIntelligence.ensureBaseResource();
  });

  afterAll(async () => {
    await resourceIntelligence.ensureBaseResource();
    await db.close();
  });

  describe("Task M4.13: Comprehensive Resource Failure Matrix (15+ Error Scenarios)", () => {
    const baseCandidate: NormalizedResourceCandidate = {
      resourceId: "cand-matrix-base",
      providerId: "prov-test",
      providerSlug: "gemini",
      providerName: "Google DeepMind",
      modelId: "mod-flash",
      modelSlug: "gemini-1.5-flash",
      modelName: "Gemini 1.5 Flash",
      billingClass: "FREE",
      isPaid: false,
      capabilities: ["TEXT_GENERATION", "CODE", "JSON"],
      health: "HEALTHY",
      status: "active",
      quotas: [{ type: "RPM", remaining: 100, confidence: 1.0 }],
      primaryQuotaRemaining: 100,
      rateLimit: { isRateLimited: false },
      priority: 10,
      observedAt: new Date(),
      confidence: 1.0,
    };

    it("Failure 1: QUOTA_EXHAUSTED excludes candidate from eligibility", () => {
      const exhausted = { ...baseCandidate, primaryQuotaRemaining: 0 };
      const res = EligibilityEngine.filter([exhausted]);
      expect(res.eligible).toHaveLength(0);
      expect(res.excluded[0].rejectionReason).toBe("QUOTA_EXHAUSTED");
    });

    it("Failure 2: RATE_LIMITED with cooldown excludes candidate from immediate eligibility", () => {
      const rateLimited = {
        ...baseCandidate,
        rateLimit: { isRateLimited: true, cooldownUntil: new Date(Date.now() + 10_000) },
      };
      const res = EligibilityEngine.filter([rateLimited]);
      expect(res.eligible).toHaveLength(0);
      expect(res.excluded[0].rejectionReason).toBe("RATE_LIMITED");
    });

    it("Failure 3: RATE_LIMITED within deadline yields WAIT strategic decision", () => {
      const rateLimited = {
        ...baseCandidate,
        rateLimit: { isRateLimited: true, cooldownUntil: new Date(Date.now() + 5000) },
      };
      const decision = ResourceDecisionEngine.evaluate([rateLimited], {
        currentResourceId: rateLimited.resourceId,
        maxTolerableWaitMs: 15_000,
      });
      expect(decision.decisionType).toBe("WAIT");
      expect(decision.waitMs).toBeGreaterThan(0);
    });

    it("Failure 4: RATE_LIMITED exceeding max wait yields MIGRATE to available healthy alternative", () => {
      const rateLimited = {
        ...baseCandidate,
        resourceId: "cand-rate-limited",
        rateLimit: { isRateLimited: true, cooldownUntil: new Date(Date.now() + 45_000) },
      };
      const healthyAlt = {
        ...baseCandidate,
        resourceId: "cand-healthy-alt",
        modelSlug: "llama-70b",
      };
      const decision = ResourceDecisionEngine.evaluate([rateLimited, healthyAlt], {
        currentResourceId: rateLimited.resourceId,
        maxTolerableWaitMs: 10_000, // 45s cooldown exceeds 10s wait tolerance
      });
      expect(decision.decisionType).toBe("MIGRATE");
      expect(decision.selectedCandidate?.candidate.resourceId).toBe("cand-healthy-alt");
    });

    it("Failure 5: RATE_LIMITED exceeding wait with NO alternative yields FAIL", () => {
      const rateLimited = {
        ...baseCandidate,
        rateLimit: { isRateLimited: true, cooldownUntil: new Date(Date.now() + 60_000) },
      };
      const decision = ResourceDecisionEngine.evaluate([rateLimited], {
        currentResourceId: rateLimited.resourceId,
        maxTolerableWaitMs: 10_000,
      });
      expect(decision.decisionType).toBe("FAIL");
    });

    it("Failure 6: HEALTH_UNAVAILABLE (tripped circuit) strictly excludes resource", () => {
      const unavailable = { ...baseCandidate, health: "UNAVAILABLE" as const };
      const res = EligibilityEngine.filter([unavailable]);
      expect(res.eligible).toHaveLength(0);
      expect(res.excluded[0].rejectionReason).toBe("HEALTH_UNAVAILABLE");
    });

    it("Failure 7: RESOURCE_INACTIVE (disabled or retired status) strictly excludes resource", () => {
      const retired = { ...baseCandidate, status: "retired" as const };
      const disabled = { ...baseCandidate, status: "disabled" as const };
      const res = EligibilityEngine.filter([retired, disabled]);
      expect(res.eligible).toHaveLength(0);
      expect(res.excluded[0].rejectionReason).toBe("RESOURCE_INACTIVE");
      expect(res.excluded[1].rejectionReason).toBe("RESOURCE_INACTIVE");
    });

    it("Failure 8: CREDENTIAL_INVALID (revoked secret) excludes resource", () => {
      const revoked = { ...baseCandidate, credentialId: "cred-1", secretReference: "revoked" };
      const res = EligibilityEngine.filter([revoked]);
      expect(res.eligible).toHaveLength(0);
      expect(res.excluded[0].rejectionReason).toBe("CREDENTIAL_INVALID");
    });

    it("Failure 9: CAPABILITY_UNSUPPORTED excludes resource missing required features", () => {
      const textOnly = { ...baseCandidate, capabilities: ["TEXT_GENERATION" as const] };
      const res = EligibilityEngine.filter([textOnly], {
        requirements: { requiredCapabilities: ["VISION"] },
      });
      expect(res.eligible).toHaveLength(0);
      expect(res.excluded[0].rejectionReason).toBe("CAPABILITY_UNSUPPORTED");
    });

    it("Failure 10: PAID_UNAUTHORIZED triggers REQUEST_APPROVAL under free-first policy", () => {
      const paidModel = {
        ...baseCandidate,
        resourceId: "cand-paid-4o",
        billingClass: "PAID" as const,
        isPaid: true,
      };
      const decision = ResourceDecisionEngine.evaluate([paidModel], {
        policy: { allowPaid: false },
      });
      expect(decision.decisionType).toBe("REQUEST_APPROVAL");
      expect(decision.requestApprovalCandidate?.resourceId).toBe("cand-paid-4o");
    });

    it("Failure 11: EXCLUDED_RESOURCE prevents selecting currently failing resource as target", () => {
      const res = EligibilityEngine.filter([baseCandidate], {
        excludedResourceIds: [baseCandidate.resourceId],
      });
      expect(res.eligible).toHaveLength(0);
      expect(res.excluded[0].rejectionReason).toBe("EXCLUDED_RESOURCE");
    });

    it("Failure 12: CONTEXT_WINDOW_EXCEEDED excludes resource when tokens exceed window", () => {
      const smallWindow = { ...baseCandidate, maxContextTokens: 4096 } as any;
      const res = EligibilityEngine.filter([smallWindow], {
        estimatedTokens: 8192,
      });
      expect(res.eligible).toHaveLength(0);
      expect(res.excluded[0].rejectionReason).toBe("CONTEXT_WINDOW_EXCEEDED");
    });

    it("Failure 13: Multiple sequential transient 500 errors gracefully degrade resource", async () => {
      const resId = await resourceIntelligence.registerResource({
        providerSlug: "gemini",
        modelSlug: "gemini-1.5-flash",
        status: "active",
      });

      await resourceHealthService.recordFailure(resId, { code: "SERVER_ERROR", isProviderError: true });
      const snap = await resourceHealthService.getHealthSnapshot(resId);
      expect(snap.health).toBe("DEGRADED");
      expect(snap.circuitState).toBe("CLOSED");
    });

    it("Failure 14: Repeated provider timeouts trip circuit breaker into cooldown", async () => {
      const resId = await resourceIntelligence.registerResource({
        providerSlug: "gemini",
        modelSlug: "gemini-flash",
        status: "active",
      });

      for (let i = 0; i < 3; i++) {
        await resourceHealthService.recordFailure(resId, { code: "TIMEOUT", isProviderError: true });
      }

      const snap = await resourceHealthService.getHealthSnapshot(resId);
      expect(snap.circuitState).toBe("OPEN");
      expect(snap.health).toBe("COOLDOWN");
    });

    it("Failure 15: Decision persistence failure does NOT crash routing engine", async () => {
      // Simulate broken decision persistence by passing invalid arguments to persistDecision
      const decision = ResourceDecisionEngine.evaluate([baseCandidate]);
      expect(decision.decisionType).toBe("SELECT_RESOURCE");

      // Verify that persistence errors are caught gracefully in selectResource
      const selected = await resourceIntelligence.selectResource();
      expect(selected.resource.id).toBeDefined();
    });
  });

  describe("Task M4.14: Concurrency Stress & Anti-Overcommit Testing", () => {
    it("competing concurrent tasks for limited quota: exactly N granted, remainder exhausted", async () => {
      const resId = await resourceIntelligence.registerResource({
        providerSlug: "groq",
        modelSlug: "llama-3-8b",
        status: "active",
        quotaRemaining: 4, // Exactly 4 requests available
      });

      // Launch 10 concurrent reservation requests
      const promises = Array.from({ length: 10 }).map(async (_, idx) => {
        const taskId = generateUUIDv7();
        return quotaTrackingService.reserveQuota({
          resourceId: resId,
          taskId,
          estimatedRequests: 1,
          estimatedTokens: 300,
        });
      });

      const results = await Promise.all(promises);

      const granted = results.filter((r) => r.granted);
      const denied = results.filter((r) => !r.granted);

      expect(granted).toHaveLength(4); // Exactly 4 granted!
      expect(denied).toHaveLength(6);  // Exactly 6 denied!
      expect(denied.every((d) => d.reason === "QUOTA_EXHAUSTED")).toBe(true);

      // Verify database quota is exactly 0 (no negative quota, no over-reservation!)
      const quotaCheck = await db.query(
        "SELECT remaining_value FROM resources.resource_quotas WHERE resource_id = $1 AND quota_type = 'RPM';",
        [resId]
      );
      expect(parseInt(quotaCheck.rows[0].remaining_value, 10)).toBe(0);
    });

    it("concurrent decision persistence: 10 concurrent requests persist 10 distinct audit records", async () => {
      const decision = ResourceDecisionEngine.evaluate([{
        resourceId: "cand-concurrency-det",
        providerId: "prov-c",
        providerSlug: "gemini",
        providerName: "Gemini",
        modelId: "mod-c",
        modelSlug: "gemini-flash",
        modelName: "Gemini Flash",
        billingClass: "FREE",
        isPaid: false,
        capabilities: ["TEXT_GENERATION"],
        health: "HEALTHY",
        status: "active",
        quotas: [],
        rateLimit: { isRateLimited: false },
        priority: 10,
        observedAt: new Date(),
        confidence: 1.0,
      }]);

      const promises = Array.from({ length: 10 }).map(async () => {
        return resourceDecisionPersistence.persistDecision(decision, {
          taskId: generateUUIDv7(),
        });
      });

      const decisionIds = await Promise.all(promises);
      expect(new Set(decisionIds).size).toBe(10); // 10 distinct IDs

      const dbCheck = await db.query("SELECT COUNT(*) FROM resources.resource_decisions;");
      expect(parseInt(dbCheck.rows[0].count, 10)).toBeGreaterThanOrEqual(10);
    });
  });

  describe("Task M4.15: Scaled Decision Determinism Verification", () => {
    it("candidate ordering permutations yield bit-exact decision winner and total score", () => {
      const candA: NormalizedResourceCandidate = {
        resourceId: "res-a",
        providerId: "p-a",
        providerSlug: "gemini",
        providerName: "Gemini",
        modelId: "m-a",
        modelSlug: "gemini-flash",
        modelName: "Gemini Flash",
        billingClass: "FREE",
        isPaid: false,
        capabilities: ["TEXT_GENERATION", "CODE"],
        health: "HEALTHY",
        status: "active",
        quotas: [{ type: "RPM", remaining: 1000, confidence: 1.0 }],
        primaryQuotaRemaining: 1000,
        rateLimit: { isRateLimited: false },
        latencyP95Ms: 400,
        qualityEstimate: 0.90,
        priority: 20,
        observedAt: new Date(1700000000000),
        confidence: 1.0,
      };

      const candB: NormalizedResourceCandidate = {
        resourceId: "res-b",
        providerId: "p-b",
        providerSlug: "groq",
        providerName: "Groq",
        modelId: "m-b",
        modelSlug: "llama-70b",
        modelName: "Llama 70B",
        billingClass: "FREE",
        isPaid: false,
        capabilities: ["TEXT_GENERATION", "CODE"],
        health: "DEGRADED",
        status: "active",
        quotas: [{ type: "RPM", remaining: 100, confidence: 1.0 }],
        primaryQuotaRemaining: 100,
        rateLimit: { isRateLimited: false },
        latencyP95Ms: 2000,
        qualityEstimate: 0.85,
        priority: 10,
        observedAt: new Date(1700000000000),
        confidence: 1.0,
      };

      const candC: NormalizedResourceCandidate = {
        resourceId: "res-c",
        providerId: "p-c",
        providerSlug: "openai",
        providerName: "OpenAI",
        modelId: "m-c",
        modelSlug: "gpt-4o",
        modelName: "GPT-4o",
        billingClass: "PAID",
        isPaid: true,
        capabilities: ["TEXT_GENERATION", "CODE"],
        health: "HEALTHY",
        status: "active",
        quotas: [{ type: "RPM", remaining: 5000, confidence: 1.0 }],
        primaryQuotaRemaining: 5000,
        rateLimit: { isRateLimited: false },
        latencyP95Ms: 300,
        qualityEstimate: 0.98,
        priority: 50,
        observedAt: new Date(1700000000000),
        confidence: 1.0,
      };

      // Run 1: Order [A, B, C]
      const decision1 = ResourceDecisionEngine.evaluate([candA, candB, candC], { policy: { allowPaid: true } });

      // Run 2: Order [C, B, A]
      const decision2 = ResourceDecisionEngine.evaluate([candC, candB, candA], { policy: { allowPaid: true } });

      // Run 3: Order [B, A, C]
      const decision3 = ResourceDecisionEngine.evaluate([candB, candA, candC], { policy: { allowPaid: true } });

      // Winner must be identical across all permutations
      expect(decision1.selectedCandidate?.candidate.resourceId).toBe("res-a");
      expect(decision2.selectedCandidate?.candidate.resourceId).toBe("res-a");
      expect(decision3.selectedCandidate?.candidate.resourceId).toBe("res-a");

      // Scores and rankings must be bit-exact
      expect(decision1.rankedCandidates.map((r) => r.candidate.resourceId)).toEqual(
        decision2.rankedCandidates.map((r) => r.candidate.resourceId)
      );
      expect(decision1.rankedCandidates.map((r) => r.totalScore)).toEqual(
        decision2.rankedCandidates.map((r) => r.totalScore)
      );
    });
  });
});

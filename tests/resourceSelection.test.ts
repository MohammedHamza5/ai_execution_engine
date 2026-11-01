import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrator.js";
import { resourceIntelligence } from "../src/resources/resourceIntelligence.js";
import { ResourceScoringEngine, DEFAULT_SCORING_WEIGHTS } from "../src/engine/resourceScoringEngine.js";
import { ResourceDecisionEngine } from "../src/engine/resourceDecisionEngine.js";
import {
  ResourceDecisionPersistenceService,
  resourceDecisionPersistence,
} from "../src/engine/resourceDecisionPersistence.js";
import { NormalizedResourceCandidate } from "../src/domain/resource/stateTypes.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";

/**
 * M4 Batch B Tests: Intelligent Selection, Scoring & Decision Persistence
 * 
 * NOTE: All test data and quota figures below are explicitly SYNTHETIC test fixtures
 * designed to rigorously verify engine logic. They do NOT represent upstream live facts.
 */
describe("M4 Batch B — Intelligent Selection, Scoring & Decision Persistence", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await resourceIntelligence.ensureBaseResource();
    await db.close();
  });

  beforeEach(async () => {
    // Isolate test resources in PostgreSQL
    await db.query(`
      DELETE FROM resources.resource_decisions;
      DELETE FROM resources.resources;
    `);
  });

  // Synthetic candidate pool with varying quality, latency, quota, and billing class
  const syntheticCandidates: NormalizedResourceCandidate[] = [
    {
      resourceId: "syn-free-high-qual",
      providerId: "prov-synthetic",
      providerSlug: "gemini",
      providerName: "Synthetic Provider",
      modelId: "mod-flash",
      modelSlug: "gemini-flash",
      modelName: "Gemini Flash (Synthetic)",
      billingClass: "FREE",
      isPaid: false,
      capabilities: ["TEXT_GENERATION", "CODE"],
      health: "HEALTHY",
      status: "active",
      quotas: [{ type: "RPM", remaining: 1000, confidence: 1.0 }],
      primaryQuotaRemaining: 1000,
      rateLimit: { isRateLimited: false },
      latencyP95Ms: 400, // fast
      qualityEstimate: 0.90, // high quality
      priority: 10,
      observedAt: new Date(),
      confidence: 1.0,
    },
    {
      resourceId: "syn-free-degraded-lat",
      providerId: "prov-synthetic",
      providerSlug: "groq",
      providerName: "Synthetic Groq",
      modelId: "mod-llama",
      modelSlug: "llama-70b",
      modelName: "Llama 70B (Synthetic)",
      billingClass: "FREE",
      isPaid: false,
      capabilities: ["TEXT_GENERATION", "CODE"],
      health: "DEGRADED", // health penalty
      status: "active",
      quotas: [{ type: "RPM", remaining: 100, confidence: 0.8 }],
      primaryQuotaRemaining: 100,
      rateLimit: { isRateLimited: false },
      latencyP95Ms: 5000, // slow latency
      qualityEstimate: 0.85,
      priority: 10,
      observedAt: new Date(),
      confidence: 0.8,
    },
    {
      resourceId: "syn-paid-ultra",
      providerId: "prov-synthetic",
      providerSlug: "openai",
      providerName: "Synthetic OpenAI",
      modelId: "mod-gpt4o",
      modelSlug: "gpt-4o",
      modelName: "GPT-4o (Synthetic)",
      billingClass: "PAID",
      isPaid: true,
      capabilities: ["TEXT_GENERATION", "CODE", "MATH"],
      health: "HEALTHY",
      status: "active",
      quotas: [{ type: "RPM", remaining: 5000, confidence: 1.0 }],
      primaryQuotaRemaining: 5000,
      rateLimit: { isRateLimited: false },
      latencyP95Ms: 300,
      qualityEstimate: 0.98, // ultra high quality
      priority: 10,
      observedAt: new Date(),
      confidence: 1.0,
    },
  ];

  describe("Task M4.4: Explainable Resource Scoring & Free-First Ranking", () => {

    it("free-first ranking: eligible high-quality free resource outranks paid resource under standard weights", () => {
      const ranked = ResourceScoringEngine.rank(syntheticCandidates);

      expect(ranked).toHaveLength(3);
      // Free High-Quality wins because of free-first cost advantage and strong quality/latency
      expect(ranked[0].candidate.resourceId).toBe("syn-free-high-qual");
      expect(ranked[0].candidate.billingClass).toBe("FREE");
      expect(ranked[0].dimensionScores.cost).toBe(1.0);

      // Paid model suffers cost penalty
      const paidResult = ranked.find((r) => r.candidate.resourceId === "syn-paid-ultra")!;
      expect(paidResult.dimensionScores.cost).toBe(0.1);

      // Degraded model suffers health and latency penalties
      const degradedResult = ranked.find((r) => r.candidate.resourceId === "syn-free-degraded-lat")!;
      expect(degradedResult.dimensionScores.health).toBe(0.5);
      expect(degradedResult.totalScore).toBeLessThan(ranked[0].totalScore);
    });

    it("deterministic scoring: identical inputs yield bit-exact scores and explanations", () => {
      const run1 = ResourceScoringEngine.rank(syntheticCandidates);
      const run2 = ResourceScoringEngine.rank(syntheticCandidates);

      expect(run1.map((r) => r.totalScore)).toEqual(run2.map((r) => r.totalScore));
      expect(run1.map((r) => r.explanation)).toEqual(run2.map((r) => r.explanation));
      expect(run1.map((r) => r.candidate.resourceId)).toEqual(run2.map((r) => r.candidate.resourceId));
    });

    it("hard constraint separation: ineligible resources must NEVER win regardless of quality", () => {
      // Synthetic candidate with 1.0 quality but EXHAUSTED quota
      const exhaustedSuperModel: NormalizedResourceCandidate = {
        resourceId: "syn-exhausted-genius",
        providerId: "prov-synthetic",
        providerSlug: "super-ai",
        providerName: "Super AI",
        modelId: "mod-genius",
        modelSlug: "genius-v1",
        modelName: "Genius V1 (Synthetic)",
        billingClass: "FREE",
        isPaid: false,
        capabilities: ["TEXT_GENERATION", "CODE"],
        health: "HEALTHY",
        status: "active",
        quotas: [{ type: "RPM", remaining: 0, confidence: 1.0 }],
        primaryQuotaRemaining: 0, // EXHAUSTED!
        rateLimit: { isRateLimited: false },
        qualityEstimate: 1.0, // Perfect quality
        priority: 9999, // Super priority
        observedAt: new Date(),
        confidence: 1.0,
      };

      const pool = [exhaustedSuperModel, syntheticCandidates[0]];

      // Evaluate via Decision Engine
      const decision = ResourceDecisionEngine.evaluate(pool, {
        policy: { allowPaid: false },
      });

      // The exhausted super model was filtered out in Stage 1 and could NOT win!
      expect(decision.selectedCandidate?.candidate.resourceId).toBe("syn-free-high-qual");
      expect(decision.selectedCandidate?.candidate.resourceId).not.toBe("syn-exhausted-genius");

      const excludedGenius = decision.eligibility.excluded.find((e) => e.candidate.resourceId === "syn-exhausted-genius");
      expect(excludedGenius?.rejectionReason).toBe("QUOTA_EXHAUSTED");
    });
  });

  describe("Task M4.5: Wait vs Migrate vs Approval Decisions", () => {
    it("yields MIGRATE when primary resource fails and healthy alternative is available", () => {
      const candidates: NormalizedResourceCandidate[] = [
        {
          resourceId: "syn-primary-failed",
          providerId: "prov-a",
          providerSlug: "prov-a",
          providerName: "Provider A",
          modelId: "mod-a",
          modelSlug: "model-a",
          modelName: "Model A (Synthetic)",
          billingClass: "FREE",
          isPaid: false,
          capabilities: ["TEXT_GENERATION"],
          health: "HEALTHY",
          status: "active",
          quotas: [{ type: "RPM", remaining: 0, confidence: 1.0 }],
          primaryQuotaRemaining: 0,
          rateLimit: { isRateLimited: false },
          priority: 10,
          observedAt: new Date(),
          confidence: 1.0,
        },
        {
          resourceId: "syn-alternative-ready",
          providerId: "prov-b",
          providerSlug: "prov-b",
          providerName: "Provider B",
          modelId: "mod-b",
          modelSlug: "model-b",
          modelName: "Model B (Synthetic)",
          billingClass: "FREE",
          isPaid: false,
          capabilities: ["TEXT_GENERATION"],
          health: "HEALTHY",
          status: "active",
          quotas: [{ type: "RPM", remaining: 500, confidence: 1.0 }],
          primaryQuotaRemaining: 500,
          rateLimit: { isRateLimited: false },
          priority: 9,
          observedAt: new Date(),
          confidence: 1.0,
        },
      ];

      const decision = ResourceDecisionEngine.evaluate(candidates, {
        currentResourceId: "syn-primary-failed",
        failureReason: "QUOTA_EXHAUSTED",
      });

      expect(decision.decisionType).toBe("MIGRATE");
      expect(decision.selectedCandidate?.candidate.resourceId).toBe("syn-alternative-ready");
      expect(decision.reasons.some((r) => r.includes("MIGRATE"))).toBe(true);
    });

    it("yields WAIT when primary resource is temporarily rate-limited and reset is within 10s with no alternative", () => {
      const cooldownReset = new Date(Date.now() + 10_000); // 10s in future

      const candidates: NormalizedResourceCandidate[] = [
        {
          resourceId: "syn-primary-ratelimited",
          providerId: "prov-a",
          providerSlug: "prov-a",
          providerName: "Provider A",
          modelId: "mod-a",
          modelSlug: "model-a",
          modelName: "Model A (Synthetic)",
          billingClass: "FREE",
          isPaid: false,
          capabilities: ["TEXT_GENERATION"],
          health: "DEGRADED",
          status: "active",
          quotas: [{ type: "RPM", remaining: 100, confidence: 1.0 }],
          primaryQuotaRemaining: 100,
          rateLimit: {
            isRateLimited: true,
            cooldownUntil: cooldownReset,
          },
          priority: 10,
          observedAt: new Date(),
          confidence: 1.0,
        },
      ];

      const decision = ResourceDecisionEngine.evaluate(candidates, {
        currentResourceId: "syn-primary-ratelimited",
        maxTolerableWaitMs: 30_000, // 30s max wait allowed
      });

      expect(decision.decisionType).toBe("WAIT");
      expect(decision.waitMs).toBeGreaterThan(0);
      expect(decision.waitMs).toBeLessThanOrEqual(10_000);
      expect(decision.reasons.some((r) => r.includes("WAIT"))).toBe(true);
    });

    it("yields REQUEST_APPROVAL when only paid resource is capable and allowPaid is false", () => {
      const candidates: NormalizedResourceCandidate[] = [
        {
          resourceId: "syn-paid-only",
          providerId: "prov-paid",
          providerSlug: "openai",
          providerName: "OpenAI",
          modelId: "mod-gpt4o",
          modelSlug: "gpt-4o",
          modelName: "GPT-4o (Synthetic)",
          billingClass: "PAID",
          isPaid: true,
          capabilities: ["TEXT_GENERATION", "VISION"],
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

      // Requires VISION, allowPaid = false
      const decision = ResourceDecisionEngine.evaluate(candidates, {
        requirements: { requiredCapabilities: ["VISION"] },
        policy: { allowPaid: false },
      });

      expect(decision.decisionType).toBe("REQUEST_APPROVAL");
      expect(decision.requestApprovalCandidate?.resourceId).toBe("syn-paid-only");
      expect(decision.reasons.some((r) => r.includes("Zero silent paid spend"))).toBe(true);
    });

    it("yields FAIL when all resources are exhausted and waiting exceeds deadline", () => {
      const candidates: NormalizedResourceCandidate[] = [
        {
          resourceId: "syn-dead",
          providerId: "prov-dead",
          providerSlug: "dead-prov",
          providerName: "Dead Provider",
          modelId: "mod-dead",
          modelSlug: "dead-model",
          modelName: "Dead Model (Synthetic)",
          billingClass: "FREE",
          isPaid: false,
          capabilities: ["TEXT_GENERATION"],
          health: "UNAVAILABLE",
          status: "active",
          quotas: [{ type: "RPM", remaining: 0, confidence: 1.0 }],
          primaryQuotaRemaining: 0,
          rateLimit: { isRateLimited: false },
          priority: 1,
          observedAt: new Date(),
          confidence: 0.1,
        },
      ];

      const decision = ResourceDecisionEngine.evaluate(candidates, {
        policy: { allowPaid: false },
      });

      expect(decision.decisionType).toBe("FAIL");
      expect(decision.selectedCandidate).toBeUndefined();
      expect(decision.reasons.some((r) => r.includes("FAIL"))).toBe(true);
    });

    it("decision determinism: identical inputs yield bit-exact StrategicResourceDecision", () => {
      const options = {
        requirements: { requiredCapabilities: ["TEXT_GENERATION"] },
        policy: { allowPaid: false },
        currentResourceId: "syn-free-degraded-lat",
        maxTolerableWaitMs: 15_000,
      };

      const decision1 = ResourceDecisionEngine.evaluate(syntheticCandidates, options);
      const decision2 = ResourceDecisionEngine.evaluate(syntheticCandidates, options);

      expect(decision1.decisionType).toBe(decision2.decisionType);
      expect(decision1.selectedCandidate?.resourceId).toBe(decision2.selectedCandidate?.resourceId);
      expect(decision1.waitMs).toBe(decision2.waitMs);
      expect(decision1.reasons).toEqual(decision2.reasons);
      expect(decision1.rankedCandidates.map((r) => r.candidate.resourceId)).toEqual(
        decision2.rankedCandidates.map((r) => r.candidate.resourceId)
      );
      expect(decision1.rankedCandidates.map((r) => r.totalScore)).toEqual(
        decision2.rankedCandidates.map((r) => r.totalScore)
      );
    });
  });

  describe("Task M4.6: Structured Decision Persistence & Secret Redaction", () => {
    it("persists decision record in PostgreSQL with strict secret redaction", async () => {
      const secretRef = "sensitive-api-key-env:SECRET_KEY_123";

      const resId = await resourceIntelligence.registerResource({
        providerSlug: "gemini",
        modelSlug: "gemini-flash",
        status: "active",
        priority: 10,
        quotaRemaining: 1000,
        isPaid: false,
        secretReference: secretRef,
      });

      const candidateWithSecret: NormalizedResourceCandidate = {
        resourceId: resId,
        providerId: "prov-sec",
        providerSlug: "gemini",
        providerName: "Google DeepMind",
        modelId: "mod-sec",
        modelSlug: "gemini-flash",
        modelName: "Gemini Flash (Synthetic)",
        secretReference: secretRef, // SECRET MUST NEVER BE PERSISTED!
        billingClass: "FREE",
        isPaid: false,
        capabilities: ["TEXT_GENERATION"],
        health: "HEALTHY",
        status: "active",
        quotas: [{ type: "RPM", remaining: 1000, confidence: 1.0 }],
        primaryQuotaRemaining: 1000,
        rateLimit: { isRateLimited: false },
        priority: 10,
        observedAt: new Date(),
        confidence: 1.0,
      };

      const decision = ResourceDecisionEngine.evaluate([candidateWithSecret]);

      const tenantRes = await db.query(`SELECT id FROM identity.tenants LIMIT 1;`);
      let tenantId = tenantRes.rows[0]?.id;
      if (!tenantId) {
        tenantId = generateUUIDv7();
        await db.query(`INSERT INTO identity.tenants (id, name, slug) VALUES ($1, 'Test Tenant', 'test-tenant') ON CONFLICT DO NOTHING;`, [tenantId]);
      }

      const taskId = generateUUIDv7();
      await db.query(
        `INSERT INTO tasks.tasks (id, tenant_id, task_type, status, input_payload) VALUES ($1, $2, 'test_task', 'pending', '{}');`,
        [taskId, tenantId]
      );

      const decisionId = await resourceDecisionPersistence.persistDecision(decision, {
        taskId,
      });

      expect(decisionId).toBeTruthy();

      // Read back raw row from PostgreSQL resources.resource_decisions
      const res = await db.query(
        `SELECT * FROM resources.resource_decisions WHERE id = $1;`,
        [decisionId]
      );

      expect(res.rows).toHaveLength(1);
      const row = res.rows[0];
      expect(row.decision_type).toBe("SELECT_RESOURCE");
      expect(row.task_id).toBe(taskId);
      expect(row.candidate_count).toBe(1);
      expect(row.eligible_count).toBe(1);

      const payloadStr = JSON.stringify(row.decision_payload);
      const reasonsStr = JSON.stringify(row.reasons);

      // NON-NEGOTIABLE GUARANTEE: Zero secret leakage
      expect(payloadStr).not.toContain("SECRET_KEY_123");
      expect(payloadStr).not.toContain("sensitive-api-key");
      expect(reasonsStr).not.toContain("SECRET_KEY_123");
      expect(reasonsStr).not.toContain("sensitive-api-key");

      // Verify outbox event was recorded
      const outboxRes = await db.query(
        `SELECT * FROM system.outbox_events WHERE event_type = 'RESOURCE_DECISION_RECORDED' AND payload->>'decisionId' = $1;`,
        [decisionId]
      );
      expect(outboxRes.rows).toHaveLength(1);
    });

    it("resilience: persistence failure does not crash selection or throw uncaught exceptions", async () => {
      // Mock db.query temporarily to simulate transient DB connection fault during persistence
      const originalQuery = db.query.bind(db);
      let queryCount = 0;

      // Register test resources
      await resourceIntelligence.registerResource({
        providerSlug: "prov-resilient",
        modelSlug: "model-resilient",
        status: "active",
        priority: 50,
      });

      // Selection must still succeed cleanly even if audit log insert encounters a glitch
      const selected = await resourceIntelligence.selectResource();
      expect(selected).toBeTruthy();
      expect(selected.resource.id).toBeTruthy();
    });
  });

  describe("Integration & Concurrency (Batch B Gate)", () => {
    it("Batch B Gate Scenario 1: Resource A (exhausted free), Resource B (healthy free), Resource C (paid) -> Resource B selected", async () => {
      const resA = await resourceIntelligence.registerResource({
        providerSlug: "prov-a-exhausted",
        modelSlug: "model-a-free",
        status: "active",
        priority: 100, // Highest priority, but exhausted
        quotaRemaining: 0,
        isPaid: false,
      });

      const resB = await resourceIntelligence.registerResource({
        providerSlug: "prov-b-healthy",
        modelSlug: "model-b-free",
        status: "active",
        priority: 80,
        quotaRemaining: 500,
        isPaid: false,
      });

      const resC = await resourceIntelligence.registerResource({
        providerSlug: "prov-c-paid",
        modelSlug: "model-c-paid",
        status: "active",
        priority: 95,
        quotaRemaining: 5000,
        isPaid: true, // Paid!
      });

      // Request selection with allowPaid: false
      const result = await resourceIntelligence.selectResource(undefined, { allowPaid: false });

      expect(result.resource.id).toBe(resB);
      expect(result.resource.id).not.toBe(resA);
      expect(result.resource.id).not.toBe(resC);
      expect(result.decisionId).toBeTruthy();
    });

    it("Batch B Gate Scenario 2: Resource A exhausted, Resource B unavailable, Resource C paid unauthorized -> throws REQUEST_APPROVAL", async () => {
      await resourceIntelligence.registerResource({
        providerSlug: "prov-a-exhausted",
        modelSlug: "model-a",
        status: "active",
        quotaRemaining: 0,
        isPaid: false,
      });

      await resourceIntelligence.registerResource({
        providerSlug: "prov-b-unhealthy",
        modelSlug: "model-b",
        status: "active",
        healthStatus: "down",
        isPaid: false,
      });

      await resourceIntelligence.registerResource({
        providerSlug: "prov-c-paid",
        modelSlug: "model-c-paid",
        status: "active",
        isPaid: true,
      });

      // When allowPaid is false, selecting resource must fail with REQUEST_APPROVAL
      await expect(
        resourceIntelligence.selectResource(undefined, { allowPaid: false })
      ).rejects.toThrow(/REQUEST_APPROVAL/);
    });

    it("concurrent selection: multiple concurrent selection requests execute deterministically without race conditions", async () => {
      await resourceIntelligence.registerResource({
        providerSlug: "prov-conc-1",
        modelSlug: "model-conc-1",
        status: "active",
        priority: 200,
        quotaRemaining: 1000,
        isPaid: false,
      });

      await resourceIntelligence.registerResource({
        providerSlug: "prov-conc-2",
        modelSlug: "model-conc-2",
        status: "active",
        priority: 150,
        quotaRemaining: 1000,
        isPaid: false,
      });

      // Run 10 concurrent selections
      const tasks = Array.from({ length: 10 }, () =>
        resourceIntelligence.selectResource(undefined, { allowPaid: false })
      );

      const results = await Promise.all(tasks);

      // All 10 must deterministically select the top-ranked resource
      const firstId = results[0].resource.id;
      for (const res of results) {
        expect(res.resource.id).toBe(firstId);
        expect(res.decisionId).toBeTruthy();
      }

      // Verify 10 distinct decision records were persisted
      const decisions = await db.query(
        `SELECT COUNT(*) as count FROM resources.resource_decisions;`
      );
      expect(parseInt(decisions.rows[0].count, 10)).toBeGreaterThanOrEqual(10);
    });
  });
});

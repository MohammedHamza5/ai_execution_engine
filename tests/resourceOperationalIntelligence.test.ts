import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrator.js";
import { resourceIntelligence } from "../src/resources/resourceIntelligence.js";
import { resourceHealthService } from "../src/engine/resourceHealthService.js";
import { quotaTrackingService } from "../src/engine/quotaTrackingService.js";
import { rateLimitIntelligence } from "../src/engine/rateLimitIntelligence.js";
import { ResourceDecisionEngine } from "../src/engine/resourceDecisionEngine.js";
import { EligibilityEngine } from "../src/engine/eligibilityEngine.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";

describe("Milestone M4 Batch C — Operational Resource Intelligence (M4.7, M4.8, M4.9)", () => {
  beforeEach(async () => {
    await runMigrations();
    await db.query(`
      DELETE FROM resources.resource_reservations;
      DELETE FROM resources.resource_decisions;
      DELETE FROM resources.resource_health;
      DELETE FROM resources.resource_quotas;
      DELETE FROM resources.resources;
    `);
  });

  afterAll(async () => {
    await resourceIntelligence.ensureBaseResource();
    await db.close();
  });

  describe("Task M4.7: Resource Health Tracking, Circuit Breaker, and Cooldown", () => {
    it("transitions healthy -> degraded -> open (cooldown) on repeated provider failures", async () => {
      const resId = await resourceIntelligence.registerResource({
        providerSlug: "gemini",
        modelSlug: "gemini-1.5-flash",
        status: "active",
        priority: 10,
        quotaRemaining: 1000,
        isPaid: false,
      });

      // 1. Initial State: HEALTHY / CLOSED
      let snapshot = await resourceHealthService.getHealthSnapshot(resId);
      expect(snapshot.circuitState).toBe("CLOSED");
      expect(snapshot.health).toBe("HEALTHY");
      expect(snapshot.consecutiveFailures).toBe(0);

      // 2. Single transient failure -> DEGRADED
      await resourceHealthService.recordFailure(resId, {
        code: "SERVER_ERROR",
        message: "Internal upstream 500 error",
        isProviderError: true,
      });

      snapshot = await resourceHealthService.getHealthSnapshot(resId);
      expect(snapshot.circuitState).toBe("CLOSED");
      expect(snapshot.health).toBe("DEGRADED");
      expect(snapshot.consecutiveFailures).toBe(1);

      // 3. Second failure -> still DEGRADED
      await resourceHealthService.recordFailure(resId, {
        code: "TIMEOUT",
        message: "Request timed out",
        isProviderError: true,
      });
      snapshot = await resourceHealthService.getHealthSnapshot(resId);
      expect(snapshot.consecutiveFailures).toBe(2);
      expect(snapshot.circuitState).toBe("CLOSED");

      // 4. Third failure (threshold reached) -> Circuit OPENS (COOLDOWN)
      await resourceHealthService.recordFailure(resId, {
        code: "SERVICE_UNAVAILABLE",
        message: "Service Unavailable 503",
        isProviderError: true,
      });

      snapshot = await resourceHealthService.getHealthSnapshot(resId);
      expect(snapshot.circuitState).toBe("OPEN");
      expect(snapshot.health).toBe("COOLDOWN");
      expect(snapshot.consecutiveFailures).toBe(3);
      expect(snapshot.cooldownUntil).toBeDefined();
      expect(snapshot.cooldownUntil!.getTime()).toBeGreaterThan(Date.now());

      // 5. While circuit is OPEN, dispatch is rejected
      const dispatchCheck = await resourceHealthService.canDispatch(resId);
      expect(dispatchCheck.allowed).toBe(false);
      expect(dispatchCheck.reason).toContain("CIRCUIT_OPEN_IN_COOLDOWN");

      // 6. Hard constraint eligibility excludes resource in cooldown
      const candidates = await resourceIntelligence.loadNormalizedCandidates();
      const candidate = candidates.find((c) => c.resourceId === resId)!;
      expect(candidate.health).toBe("COOLDOWN");
    });

    it("validation failure does NOT trip circuit breaker (model output != provider outage)", async () => {
      const resId = await resourceIntelligence.registerResource({
        providerSlug: "gemini",
        modelSlug: "gemini-flash",
        status: "active",
        priority: 10,
      });

      // 5 consecutive validation failures
      for (let i = 0; i < 5; i++) {
        await resourceHealthService.recordFailure(resId, {
          code: "SCHEMA_VALIDATION_ERROR",
          message: "Output JSON failed schema",
          isProviderError: false, // NOT a provider outage
        });
      }

      const snapshot = await resourceHealthService.getHealthSnapshot(resId);
      expect(snapshot.circuitState).toBe("CLOSED");
      expect(snapshot.health).toBe("HEALTHY");
      expect(snapshot.consecutiveFailures).toBe(0);
    });

    it("cooldown expiration transitions to PROBE and recovery confirms HEALTHY", async () => {
      const resId = await resourceIntelligence.registerResource({
        providerSlug: "groq",
        modelSlug: "llama-3-70b",
        status: "active",
        priority: 10,
      });

      // Manually simulate an OPEN circuit whose cooldown has just expired
      const pastDate = new Date(Date.now() - 5000);
      await db.query(
        `INSERT INTO resources.resource_health (
          resource_id, status, circuit_state, consecutive_failures, cooldown_until, observed_at
        ) VALUES ($1, 'cooldown', 'OPEN', 3, $2, now())
        ON CONFLICT (resource_id) DO UPDATE SET
          status = 'cooldown', circuit_state = 'OPEN', consecutive_failures = 3, cooldown_until = $2;`,
        [resId, pastDate]
      );

      // Snapshot automatically detects expired cooldown -> transitions to HALF_OPEN / PROBE
      const snapshot = await resourceHealthService.getHealthSnapshot(resId);
      expect(snapshot.circuitState).toBe("HALF_OPEN");
      expect(snapshot.health).toBe("PROBE");

      // Probe request succeeds -> closes circuit, restores HEALTHY
      await resourceHealthService.recordSuccess(resId, 350);

      const recoveredSnapshot = await resourceHealthService.getHealthSnapshot(resId);
      expect(recoveredSnapshot.circuitState).toBe("CLOSED");
      expect(recoveredSnapshot.health).toBe("HEALTHY");
      expect(recoveredSnapshot.consecutiveFailures).toBe(0);
      expect(recoveredSnapshot.cooldownUntil).toBeUndefined();
    });

    it("probe failure re-opens circuit with renewed backoff cooldown", async () => {
      const resId = await resourceIntelligence.registerResource({
        providerSlug: "groq",
        modelSlug: "llama-3-8b",
        status: "active",
        priority: 10,
      });

      // Simulate HALF_OPEN circuit
      await db.query(
        `INSERT INTO resources.resource_health (
          resource_id, status, circuit_state, consecutive_failures, observed_at
        ) VALUES ($1, 'probe', 'HALF_OPEN', 3, now())
        ON CONFLICT (resource_id) DO UPDATE SET
          status = 'probe', circuit_state = 'HALF_OPEN', consecutive_failures = 3;`,
        [resId]
      );

      // Probe fails
      await resourceHealthService.recordFailure(resId, {
        code: "SERVER_ERROR",
        message: "Probe failed with 500",
        isProviderError: true,
      });

      const snapshot = await resourceHealthService.getHealthSnapshot(resId);
      expect(snapshot.circuitState).toBe("OPEN");
      expect(snapshot.health).toBe("COOLDOWN");
      expect(snapshot.consecutiveFailures).toBe(4);
      expect(snapshot.cooldownUntil!.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe("Task M4.8: Multi-Tier Quota Tracking and Reconciliation", () => {
    it("atomic reservation prevents concurrent overspend and tracks remaining capacity", async () => {
      const resId = await resourceIntelligence.registerResource({
        providerSlug: "gemini",
        modelSlug: "gemini-1.5-flash",
        status: "active",
        priority: 10,
        quotaRemaining: 2, // Only 2 requests available
      });

      const taskId1 = generateUUIDv7();
      const taskId2 = generateUUIDv7();
      const taskId3 = generateUUIDv7();

      // Reservation 1: Should succeed
      const res1 = await quotaTrackingService.reserveQuota({
        resourceId: resId,
        taskId: taskId1,
        estimatedRequests: 1,
        estimatedTokens: 500,
      });
      expect(res1.granted).toBe(true);
      expect(res1.remainingQuota).toBe(1);

      // Reservation 2: Should succeed
      const res2 = await quotaTrackingService.reserveQuota({
        resourceId: resId,
        taskId: taskId2,
        estimatedRequests: 1,
        estimatedTokens: 500,
      });
      expect(res2.granted).toBe(true);
      expect(res2.remainingQuota).toBe(0);

      // Reservation 3: Must be DENIED due to exhaustion
      const res3 = await quotaTrackingService.reserveQuota({
        resourceId: resId,
        taskId: taskId3,
        estimatedRequests: 1,
        estimatedTokens: 500,
      });
      expect(res3.granted).toBe(false);
      expect(res3.reason).toBe("QUOTA_EXHAUSTED");
      expect(res3.remainingQuota).toBe(0);
    });

    it("releasing reservation restores quota capacity", async () => {
      const resId = await resourceIntelligence.registerResource({
        providerSlug: "gemini",
        modelSlug: "gemini-flash",
        status: "active",
        quotaRemaining: 5,
      });

      const res = await quotaTrackingService.reserveQuota({
        resourceId: resId,
        taskId: generateUUIDv7(),
        estimatedRequests: 2,
      });
      expect(res.granted).toBe(true);
      expect(res.remainingQuota).toBe(3);

      // Release reservation (e.g. step aborted)
      await quotaTrackingService.releaseReservation(res.reservationId!);

      // Check quota restored
      const quotaCheck = await db.query(
        `SELECT remaining_value FROM resources.resource_quotas WHERE resource_id = $1 AND quota_type = 'RPM';`,
        [resId]
      );
      expect(parseInt(quotaCheck.rows[0].remaining_value, 10)).toBe(5);
    });

    it("reconcileUsage updates actual token consumption idempotently", async () => {
      const resId = await resourceIntelligence.registerResource({
        providerSlug: "gemini",
        modelSlug: "gemini-flash",
        status: "active",
        quotaRemaining: 100,
      });

      const res = await quotaTrackingService.reserveQuota({
        resourceId: resId,
        taskId: generateUUIDv7(),
        estimatedTokens: 1000,
      });

      // Execution returned 450 input + 150 output = 600 tokens
      const rec1 = await quotaTrackingService.reconcileUsage(res.reservationId!, {
        inputTokens: 450,
        outputTokens: 150,
      });

      expect(rec1.actualTokens).toBe(600);
      expect(rec1.estimatedTokens).toBe(1000);
      expect(rec1.differenceTokens).toBe(400);

      // Idempotent retry: duplicate call produces identical result without double-counting
      const rec2 = await quotaTrackingService.reconcileUsage(res.reservationId!, {
        inputTokens: 450,
        outputTokens: 150,
      });
      expect(rec2.actualTokens).toBe(600);
      expect(rec2.differenceTokens).toBe(400);
    });
  });

  describe("Task M4.9: Rate-Limit Intelligence", () => {
    it("parses numeric seconds, HTTP-date, and numeric ms Retry-After correctly", () => {
      // 1. Numeric seconds string
      expect(rateLimitIntelligence.parseRetryAfter("30")).toBe(30_000);

      // 2. Numeric ms
      expect(rateLimitIntelligence.parseRetryAfter(15_000)).toBe(15_000);

      // 3. HTTP Date (future timestamp)
      const futureDate = new Date(Date.now() + 25_000).toUTCString();
      const parsed = rateLimitIntelligence.parseRetryAfter(futureDate);
      expect(parsed).toBeGreaterThanOrEqual(23_000);
      expect(parsed).toBeLessThanOrEqual(26_000);

      // 4. Fallback default
      expect(rateLimitIntelligence.parseRetryAfter(undefined)).toBe(10_000);
    });

    it("records rate-limit and integrates with DecisionEngine for WAIT vs MIGRATE", async () => {
      const resA = await resourceIntelligence.registerResource({
        providerSlug: "groq",
        modelSlug: "llama-70b",
        status: "active",
        priority: 20,
        quotaRemaining: 1000,
      });

      const resB = await resourceIntelligence.registerResource({
        providerSlug: "gemini",
        modelSlug: "gemini-flash",
        status: "active",
        priority: 10,
        quotaRemaining: 1000,
      });

      // Res A receives HTTP 429 with 8s cooldown
      await rateLimitIntelligence.recordRateLimit({
        resourceId: resA,
        retryAfterMs: 8000,
      });

      const rateLimitState = await rateLimitIntelligence.getRateLimitState(resA);
      expect(rateLimitState.isRateLimited).toBe(true);
      expect(rateLimitState.retryAfterMs).toBeGreaterThan(0);
      expect(rateLimitState.retryAfterMs).toBeLessThanOrEqual(8000);

      // Load normalized candidates: Res A is marked rate-limited
      const candidates = await resourceIntelligence.loadNormalizedCandidates();
      const candA = candidates.find((c) => c.resourceId === resA)!;
      expect(candA.rateLimit.isRateLimited).toBe(true);

      // Scenario: current resource is Res A. If maxTolerableWaitMs is 15s (>= 8s), decision is WAIT
      const waitDecision = ResourceDecisionEngine.evaluate([candA], {
        currentResourceId: resA,
        maxTolerableWaitMs: 15_000,
      });
      expect(waitDecision.decisionType).toBe("WAIT");
      expect(waitDecision.waitMs).toBeGreaterThan(0);
      expect(waitDecision.waitMs).toBeLessThanOrEqual(8000);

      // Scenario: Alternative Res B is healthy, so failover produces MIGRATE to Res B
      const migrateDecision = ResourceDecisionEngine.evaluate(candidates, {
        currentResourceId: resA,
        maxTolerableWaitMs: 5000, // wait threshold too short for 8s cooldown
      });
      expect(migrateDecision.decisionType).toBe("MIGRATE");
      expect(migrateDecision.selectedCandidate?.candidate.resourceId).toBe(resB);
    });
  });

  describe("Batch C Gate: Automated Degradation, Cooldown, and Recovery Cycle", () => {
    it("full lifecycle: healthy -> rate limited -> wait -> recovery -> re-eligible", async () => {
      const resId = await resourceIntelligence.registerResource({
        providerSlug: "gemini",
        modelSlug: "gemini-1.5-pro",
        status: "active",
        priority: 10,
        quotaRemaining: 500,
      });

      // 1. Initially eligible
      let candidates = await resourceIntelligence.loadNormalizedCandidates();
      let eligibility = EligibilityEngine.filter(candidates);
      expect(eligibility.eligible.some((c) => c.resourceId === resId)).toBe(true);

      // 2. Encounters temporary rate-limit (cooldown 2 seconds)
      await resourceIntelligence.recordExecutionFailure(resId, {
        code: "RATE_LIMIT",
        message: "429 Too Many Requests",
        isProviderError: true,
        retryAfterMs: 2000,
      });

      // 3. Immediately excluded from normal eligibility due to RATE_LIMITED
      candidates = await resourceIntelligence.loadNormalizedCandidates();
      eligibility = EligibilityEngine.filter(candidates);
      expect(eligibility.eligible.some((c) => c.resourceId === resId)).toBe(false);
      expect(eligibility.excluded.some((e) => e.candidate.resourceId === resId && e.rejectionReason === "RATE_LIMITED")).toBe(true);

      // 4. Fast forward past cooldown (simulate 3 seconds passing)
      const past = new Date(Date.now() - 3000);
      await db.query(
        `UPDATE resources.resource_health
         SET cooldown_until = $1, observed_at = now()
         WHERE resource_id = $2;`,
        [past, resId]
      );

      // 5. Successful probe execution confirms recovery
      await resourceIntelligence.recordExecutionSuccess(resId, 280);

      // 6. Becomes fully eligible again!
      candidates = await resourceIntelligence.loadNormalizedCandidates();
      eligibility = EligibilityEngine.filter(candidates);
      expect(eligibility.eligible.some((c) => c.resourceId === resId)).toBe(true);
      const recoveredCand = eligibility.eligible.find((c) => c.resourceId === resId)!;
      expect(recoveredCand.health).toBe("HEALTHY");
      expect(recoveredCand.rateLimit.isRateLimited).toBe(false);
    });
  });
});

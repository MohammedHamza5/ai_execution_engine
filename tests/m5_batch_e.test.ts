/**
 * Milestone M5 Batch E Test Suite
 * Tasks M5.16, M5.17, M5.18: Resource Intelligence Integration, Hard Invariants & Drift Invalidation
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrator.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";
import { NormalizedResourceCandidate } from "../src/domain/resource/stateTypes.js";
import { ResourceScoringEngine } from "../src/engine/resourceScoringEngine.js";
import { EligibilityEngine } from "../src/engine/eligibilityEngine.js";
import { reputationInvalidationService } from "../src/reputation/reputationInvalidationService.js";
import { reputationRepository } from "../src/reputation/reputationRepository.js";

function createCandidate(overrides: Partial<NormalizedResourceCandidate> = {}): NormalizedResourceCandidate {
  return {
    resourceId: generateUUIDv7(),
    providerId: generateUUIDv7(),
    providerSlug: "google",
    providerName: "Google Cloud",
    modelId: generateUUIDv7(),
    modelSlug: "gemini-2.5-flash",
    modelName: "Gemini 2.5 Flash",
    credentialId: generateUUIDv7(),
    billingClass: "FREE",
    isPaid: false,
    capabilities: ["TEXT_GENERATION", "JSON", "CODE", "REASONING"],
    health: "HEALTHY",
    status: "active",
    quotas: [],
    rateLimit: { isRateLimited: false },
    priority: 0,
    observedAt: new Date(),
    confidence: 1.0,
    ...overrides,
  };
}

describe("Milestone M5 Batch E — Resource Intelligence Integration & Drift (M5.16 – M5.18)", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await db.close();
  });

  describe("Task M5.16: Resource Intelligence Reputation Contract", () => {
    it("boosts candidate ranking when empirical reputation confirms superior quality and reliability", () => {
      const resA = createCandidate({ resourceId: "res-a", qualityEstimate: 0.75, successRate: 0.80 });
      const resB = createCandidate({ resourceId: "res-b", qualityEstimate: 0.75, successRate: 0.80 });

      // Provide empirical reputation score for resB only
      const reputationMap = new Map([
        ["res-b", { quality: 0.98, reliability: 0.99, confidence: 1.0 }],
      ]);

      const ranked = ResourceScoringEngine.rank([resA, resB], {
        reputationScores: reputationMap,
      });

      expect(ranked).toHaveLength(2);
      expect(ranked[0].candidate.resourceId).toBe("res-b");
      expect(ranked[0].dimensionScores.quality).toBe(0.98);
      expect(ranked[0].dimensionScores.reliability).toBe(0.99);

      expect(ranked[1].candidate.resourceId).toBe("res-a");
      expect(ranked[1].dimensionScores.quality).toBe(0.75);
    });
  });

  describe("Task M5.17: Hard Eligibility Invariant Enforcement", () => {
    it("strictly excludes a resource with 1.0 reputation score if it violates credentials", () => {
      const invalidCredCandidate = createCandidate({
        credentialId: "cred-revoked",
        secretReference: "revoked",
      });
      const filterRes = EligibilityEngine.filter([invalidCredCandidate]);

      expect(filterRes.eligible).toHaveLength(0);
      expect(filterRes.excluded).toHaveLength(1);
      expect(filterRes.excluded[0].rejectionReason).toBe("CREDENTIAL_INVALID");

      // Ineligible resources must NEVER be passed to scoring
      const ranked = ResourceScoringEngine.rank(filterRes.eligible as any);
      expect(ranked).toHaveLength(0);
    });

    it("strictly excludes a PAID resource with 1.0 reputation score when allowPaid = false", () => {
      const paidCandidate = createCandidate({ billingClass: "PAID", isPaid: true });
      const filterRes = EligibilityEngine.filter([paidCandidate], {
        policy: { allowPaid: false },
      });

      expect(filterRes.eligible).toHaveLength(0);
      expect(filterRes.excluded[0].rejectionReason).toBe("PAID_UNAUTHORIZED");
    });

    it("strictly excludes a resource with 1.0 reputation score if it lacks required capability", () => {
      const textOnlyCandidate = createCandidate({ capabilities: ["TEXT_GENERATION"] });
      const filterRes = EligibilityEngine.filter([textOnlyCandidate], {
        requirements: { requiredCapabilities: ["VISION"] },
      });

      expect(filterRes.eligible).toHaveLength(0);
      expect(filterRes.excluded[0].rejectionReason).toBe("CAPABILITY_UNSUPPORTED");
    });

    it("strictly excludes a resource with 1.0 reputation score if health is UNAVAILABLE", () => {
      const downCandidate = createCandidate({ health: "UNAVAILABLE" });
      const filterRes = EligibilityEngine.filter([downCandidate]);

      expect(filterRes.eligible).toHaveLength(0);
      expect(filterRes.excluded[0].rejectionReason).toBe("HEALTH_UNAVAILABLE");
    });
  });

  describe("Task M5.18: Model Version Drift, Staleness & Invalidation", () => {
    it("resets reputation scores to neutral prior and zeroes confidence upon model version upgrade", async () => {
      const subjectId = generateUUIDv7();

      // Seed high reputation profile and dimensional score
      const profile = await reputationRepository.upsertProfile(
        "model_version",
        subjectId,
        0.96,
        0.95,
        40
      );

      await reputationRepository.upsertScore({
        profileId: profile.id,
        dimension: "quality",
        taskSubtype: "coding",
        score: 0.98,
        confidence: 0.95,
        sampleSize: 35,
        alpha: 35.0,
        beta: 1.0,
        decayFactor: 0.95,
      });

      // Model version bump occurs: gemini-1.5-flash-001 -> gemini-1.5-flash-002
      const driftResult = await reputationInvalidationService.handleModelVersionDrift({
        subjectId,
        previousVersion: "001",
        newVersion: "002",
        reason: "model_upgrade",
      });

      expect(driftResult.scoresReset).toBe(1);

      // Verify profile reset to neutral prior
      const updatedProfile = await reputationRepository.getProfile("model_version", subjectId);
      expect(updatedProfile?.overallScore).toBe(0.50);
      expect(updatedProfile?.confidence).toBe(0.0);
      expect(updatedProfile?.sampleSize).toBe(0);
      expect(updatedProfile?.version).toBe(profile.version + 1);

      // Verify dimensional score reset to neutral Beta prior
      const scores = await reputationRepository.getScoresByProfile(profile.id);
      expect(scores[0].score).toBe(0.50);
      expect(scores[0].confidence).toBe(0.0);
      expect(scores[0].alpha).toBe(2.0);
      expect(scores[0].beta).toBe(2.0);
    });

    it("identifies stale scores older than threshold days", () => {
      const now = new Date();
      const freshDate = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000); // 5 days
      const staleDate = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000); // 40 days

      expect(reputationInvalidationService.isScoreStale(freshDate, now, 30)).toBe(false);
      expect(reputationInvalidationService.isScoreStale(staleDate, now, 30)).toBe(true);
    });
  });
});

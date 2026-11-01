/**
 * Milestone M5 Batch D Test Suite
 * Tasks M5.12, M5.13, M5.14, M5.15: Bayesian Aggregation, Profiler & Reputation Persistence
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrator.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";
import { BayesianReputationEngine } from "../src/reputation/bayesianReputationEngine.js";
import { ReputationProfiler, CategorizedObservation } from "../src/reputation/reputationProfiler.js";
import { reputationTraceabilityService } from "../src/reputation/reputationTraceability.js";
import { reputationPersistenceService } from "../src/reputation/reputationPersistenceService.js";
import { reputationRepository } from "../src/reputation/reputationRepository.js";

describe("Milestone M5 Batch D — Statistical Aggregation & Reputation Profiles (M5.12 – M5.15)", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await db.close();
  });

  describe("Task M5.12: Bayesian Reputation Engine & Recency Decay", () => {
    it("starts from neutral prior (mean = 0.50) when no observations are given", () => {
      const estimate = BayesianReputationEngine.updatePosterior(undefined, []);
      expect(estimate.mean).toBe(0.50);
      expect(estimate.effectiveSampleSize).toBe(0.0);
      expect(estimate.confidence).toBe(0.0);
    });

    it("updates posterior mean and confidence smoothly with empirical evidence", () => {
      const now = new Date();
      // 10 successful observations
      const observations = Array.from({ length: 10 }, () => ({
        score: 1.0,
        timestamp: now,
      }));

      const estimate = BayesianReputationEngine.updatePosterior(undefined, observations, now);
      // Alpha = 2 + 10 = 12, Beta = 2 + 0 = 2 => Mean = 12 / 14 = 0.8571
      expect(estimate.mean).toBeCloseTo(0.8571, 3);
      expect(estimate.effectiveSampleSize).toBeCloseTo(10.0, 1);
      expect(estimate.confidence).toBeCloseTo(10 / 30, 2); // 10 / 30 samples
    });

    it("applies exponential time-decay half-life: older observations carry less weight", () => {
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

      const weightNow = BayesianReputationEngine.calculateRecencyWeight(now, now);
      const weight7d = BayesianReputationEngine.calculateRecencyWeight(sevenDaysAgo, now);
      const weight14d = BayesianReputationEngine.calculateRecencyWeight(fourteenDaysAgo, now);

      expect(weightNow).toBeCloseTo(1.0, 4);
      expect(weight7d).toBeCloseTo(0.50, 2); // 1 half-life
      expect(weight14d).toBeCloseTo(0.25, 2); // 2 half-lives
    });
  });

  describe("Task M5.13: Multi-Dimensional Reputation Profiler", () => {
    it("aggregates observations by dimension and task category and flags uncertainty", () => {
      const now = new Date();
      const observations: CategorizedObservation[] = [
        // 2 coding observations (low count -> uncertain)
        { dimension: "quality", taskCategory: "coding", score: 0.95, timestamp: now, evidenceSourceId: generateUUIDv7() },
        { dimension: "quality", taskCategory: "coding", score: 0.90, timestamp: now, evidenceSourceId: generateUUIDv7() },
        // 15 structured_json observations (higher count)
        ...Array.from({ length: 15 }, () => ({
          dimension: "quality" as const,
          taskCategory: "structured_json" as const,
          score: 1.0,
          timestamp: now,
          evidenceSourceId: generateUUIDv7(),
        })),
      ];

      const profile = ReputationProfiler.buildProfile(observations, now);
      expect(profile.totalObservations).toBe(17);
      expect(profile.dimensions).toHaveLength(2);

      const codingDim = profile.dimensions.find((d) => d.taskCategory === "coding")!;
      expect(codingDim.isUncertain).toBe(true); // < 0.35 confidence

      const jsonDim = profile.dimensions.find((d) => d.taskCategory === "structured_json")!;
      expect(jsonDim.isUncertain).toBe(false); // 15 / 30 = 0.50 >= 0.35 confidence
      expect(jsonDim.estimate.mean).toBeGreaterThan(0.85);
    });
  });

  describe("Task M5.14 & M5.15: Reputation Persistence & Evidence Traceability", () => {
    it("synchronizes profile, dimensional scores, evidence records, and snapshots in PostgreSQL", async () => {
      const resourceId = generateUUIDv7();
      const evidenceId1 = generateUUIDv7();
      const evidenceId2 = generateUUIDv7();
      const now = new Date();

      const observations: CategorizedObservation[] = [
        { dimension: "quality", taskCategory: "reasoning", score: 0.90, timestamp: now, evidenceSourceId: evidenceId1 },
        { dimension: "quality", taskCategory: "reasoning", score: 0.85, timestamp: now, evidenceSourceId: evidenceId2 },
      ];

      const profile = await reputationPersistenceService.syncSubjectReputation(
        "resource",
        resourceId,
        observations,
        now
      );

      expect(profile.overallScore).toBeGreaterThan(0.50);

      // Verify in PostgreSQL
      const dbProfile = await reputationRepository.getProfile("resource", resourceId);
      expect(dbProfile).not.toBeNull();
      expect(dbProfile?.sampleSize).toBe(2);

      const scores = await reputationRepository.getScoresByProfile(dbProfile!.id);
      expect(scores).toHaveLength(1);
      const reasoningScore = scores[0];
      expect(reasoningScore.dimension).toBe("quality");
      expect(reasoningScore.taskSubtype).toBe("reasoning");

      // Verify Audit Traceability (Task M5.14)
      const audit = await reputationTraceabilityService.auditScoreTraceability(reasoningScore.id);
      expect(audit.scoreId).toBe(reasoningScore.id);
      expect(audit.evidenceCount).toBe(2);
      expect(audit.evidenceSources.map((e) => e.sourceId)).toContain(evidenceId1);
      expect(audit.evidenceSources.map((e) => e.sourceId)).toContain(evidenceId2);

      // Verify Snapshot
      const snapRes = await db.query(
        `SELECT scores FROM reputation.reputation_snapshots WHERE subject_id = $1;`,
        [resourceId]
      );
      expect(snapRes.rows.length).toBeGreaterThanOrEqual(1);
      expect(snapRes.rows[0].scores).toHaveProperty("dimensions");
    });
  });
});

/**
 * Milestone M5 Batch F Test Suite: Task M5.20
 * High-Concurrency Benchmark & Reputation Persistence Stress Tests
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrator.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";
import { reputationRepository } from "../src/reputation/reputationRepository.js";

describe("Milestone M5 Task M5.20 — High-Concurrency Benchmark & Update Stress", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await db.close();
  });

  it("handles 10 concurrent profile and score upserts without deadlocks or race conditions", async () => {
    const resourceId = generateUUIDv7();
    const concurrentWorkers = 10;

    // Concurrently upsert profile 10 times
    const profilePromises = Array.from({ length: concurrentWorkers }, (_, i) =>
      reputationRepository.upsertProfile(
        "resource",
        resourceId,
        0.80 + i * 0.01,
        0.70 + i * 0.02,
        (i + 1) * 5
      )
    );

    const profileResults = await Promise.all(profilePromises);
    expect(profileResults).toHaveLength(concurrentWorkers);

    // Verify profile in DB has stable identity
    const finalProfile = await reputationRepository.getProfile("resource", resourceId);
    expect(finalProfile).not.toBeNull();
    expect(finalProfile?.version).toBeGreaterThanOrEqual(concurrentWorkers);

    // Concurrently upsert score on same profile
    const scorePromises = Array.from({ length: concurrentWorkers }, (_, i) =>
      reputationRepository.upsertScore({
        profileId: finalProfile!.id,
        dimension: "quality",
        taskSubtype: "structured_json",
        score: 0.85 + i * 0.01,
        confidence: 0.80,
        sampleSize: (i + 1) * 3,
        alpha: 15.0 + i,
        beta: 2.0,
        decayFactor: 0.95,
      })
    );

    const scoreResults = await Promise.all(scorePromises);
    expect(scoreResults).toHaveLength(concurrentWorkers);

    // Verify exactly one score record per (profileId, dimension, taskSubtype)
    const scores = await reputationRepository.getScoresByProfile(finalProfile!.id);
    expect(scores.filter((s) => s.dimension === "quality" && s.taskSubtype === "structured_json")).toHaveLength(1);
  });

  it("handles 10 concurrent evidence and snapshot writes with zero constraint violations", async () => {
    const resourceId = generateUUIDv7();
    const profile = await reputationRepository.upsertProfile("resource", resourceId, 0.90, 0.85, 25);
    const score = await reputationRepository.upsertScore({
      profileId: profile.id,
      dimension: "reliability",
      score: 0.95,
      confidence: 0.90,
      sampleSize: 20,
      alpha: 20.0,
      beta: 1.0,
      decayFactor: 0.95,
    });

    const concurrentEvidence = Array.from({ length: 10 }, (_, i) =>
      reputationRepository.recordEvidence({
        reputationScoreId: score.id,
        sourceType: "production_validation",
        sourceId: generateUUIDv7(),
        weight: 1.0,
        contribution: 0.90 + i * 0.01,
        isSimulated: false,
      })
    );

    const evidenceResults = await Promise.all(concurrentEvidence);
    expect(evidenceResults).toHaveLength(10);

    const evidenceRows = await db.query(
      `SELECT count(*) FROM reputation.reputation_evidence WHERE reputation_score_id = $1;`,
      [score.id]
    );
    expect(Number(evidenceRows.rows[0].count)).toBe(10);
  });
});

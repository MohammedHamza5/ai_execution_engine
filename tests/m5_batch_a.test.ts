/**
 * Milestone M5 Batch A Test Suite
 * Tasks M5.1, M5.2, M5.3: Benchmark Domain, Taxonomy, Migration 007 & Repositories
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrator.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";
import { BENCHMARK_TASK_CATEGORIES } from "../src/domain/evaluation/types.js";
import { benchmarkRepository } from "../src/evaluation/benchmarkRepository.js";
import { reputationRepository } from "../src/reputation/reputationRepository.js";

describe("Milestone M5 Batch A — Domain, Schema & Persistence (M5.1 – M5.3)", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await db.close();
  });

  describe("Task M5.1: Task Taxonomy Coverage", () => {
    it("defines all 9 core benchmark task categories", () => {
      expect(BENCHMARK_TASK_CATEGORIES).toHaveLength(9);
      expect(BENCHMARK_TASK_CATEGORIES).toContain("general_text");
      expect(BENCHMARK_TASK_CATEGORIES).toContain("structured_json");
      expect(BENCHMARK_TASK_CATEGORIES).toContain("coding");
      expect(BENCHMARK_TASK_CATEGORIES).toContain("reasoning");
      expect(BENCHMARK_TASK_CATEGORIES).toContain("mathematics");
      expect(BENCHMARK_TASK_CATEGORIES).toContain("vision_understanding");
      expect(BENCHMARK_TASK_CATEGORIES).toContain("ocr_extraction");
      expect(BENCHMARK_TASK_CATEGORIES).toContain("long_context");
      expect(BENCHMARK_TASK_CATEGORIES).toContain("tool_calling");
    });
  });

  describe("Task M5.2 & M5.3: Benchmark Persistence & Secret Redaction", () => {
    const slug = `bench-json-${Date.now()}`;

    it("creates and retrieves a benchmark entity with stable identity and version", async () => {
      const benchmark = await benchmarkRepository.createBenchmark({
        name: "Structured JSON Compliance Benchmark",
        slug,
        version: 1,
        domain: "structured_json",
        description: "Evaluates strict JSON Schema compliance and typing",
        status: "active",
      });

      expect(benchmark.id).toBeDefined();
      expect(benchmark.slug).toBe(slug);
      expect(benchmark.domain).toBe("structured_json");

      const fetched = await benchmarkRepository.getBenchmarkBySlug(slug, 1);
      expect(fetched).not.toBeNull();
      expect(fetched?.id).toBe(benchmark.id);
      expect(fetched?.name).toBe(benchmark.name);
    });

    it("creates a benchmark case with strict secret redaction", async () => {
      const benchmark = await benchmarkRepository.getBenchmarkBySlug(slug, 1);
      expect(benchmark).not.toBeNull();

      const benchmarkCase = await benchmarkRepository.createBenchmarkCase({
        benchmarkId: benchmark!.id,
        name: "Strict User Profile Schema Case",
        difficulty: 0.65,
        inputPayload: {
          prompt: "Generate a user JSON matching schema",
          apiKey: "secret-leak-attempt", // Must be redacted
          clientSecret: "forbidden-token", // Must be redacted
          safeParam: 42,
        },
        expectedOutputPayload: {
          type: "object",
          required: ["username", "email"],
        },
        validationStrategy: {
          evaluatorType: "schema",
          tolerance: 0.0,
          timeoutMs: 5000,
        },
        metadata: {
          tags: ["json", "strict"],
          authToken: "bearer-secret-leak", // Must be redacted
        },
      });

      expect(benchmarkCase.id).toBeDefined();
      expect(benchmarkCase.difficulty).toBe(0.65);
      // Verify secrets stripped
      expect(benchmarkCase.inputPayload).not.toHaveProperty("apiKey");
      expect(benchmarkCase.inputPayload).not.toHaveProperty("clientSecret");
      expect(benchmarkCase.inputPayload).toHaveProperty("safeParam", 42);
      expect(benchmarkCase.metadata).not.toHaveProperty("authToken");
      expect(benchmarkCase.metadata).toHaveProperty("tags");
    });

    it("creates and lifecycle-tracks a benchmark run session", async () => {
      const benchmark = await benchmarkRepository.getBenchmarkBySlug(slug, 1);
      const resRow = await db.query("SELECT id, model_id FROM resources.resources LIMIT 1;");
      const realResourceId = resRow.rows[0]?.id;
      const realModelId = resRow.rows[0]?.model_id;

      const run = await benchmarkRepository.createBenchmarkRun({
        benchmarkId: benchmark!.id,
        resourceId: realResourceId,
        modelId: realModelId,
        version: 1,
        status: "pending",
        isSimulated: true,
      });

      expect(run.id).toBeDefined();
      expect(run.status).toBe("pending");
      expect(run.isSimulated).toBe(true);

      await benchmarkRepository.updateBenchmarkRunStatus(run.id, "running");
      await benchmarkRepository.updateBenchmarkRunStatus(run.id, "completed");

      const cases = await benchmarkRepository.getBenchmarkCases(benchmark!.id);
      expect(cases.length).toBeGreaterThan(0);

      const result = await benchmarkRepository.recordBenchmarkResult({
        benchmarkRunId: run.id,
        benchmarkCaseId: cases[0].id,
        rawOutput: '{"username": "alice", "email": "alice@example.com"}',
        score: 0.98,
        confidence: 0.95,
        latencyMs: 420,
        inputTokens: 120,
        outputTokens: 45,
        isCorrect: true,
        validationDetails: { schemaValid: true },
      });

      expect(result.id).toBeDefined();
      expect(result.score).toBe(0.98);
      expect(result.isCorrect).toBe(true);
      expect(result.latencyMs).toBe(420);

      const results = await benchmarkRepository.getBenchmarkResults(run.id);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(result.id);
    });
  });

  describe("Task M5.3: Reputation Profiles, Scores & Evidence Persistence", () => {
    const resourceId = generateUUIDv7();

    it("upserts reputation profile and increments version on update", async () => {
      const profile1 = await reputationRepository.upsertProfile(
        "resource",
        resourceId,
        0.85,
        0.90,
        15
      );

      expect(profile1.id).toBeDefined();
      expect(profile1.version).toBe(1);
      expect(profile1.overallScore).toBe(0.85);
      expect(profile1.sampleSize).toBe(15);

      const profile2 = await reputationRepository.upsertProfile(
        "resource",
        resourceId,
        0.88,
        0.92,
        20
      );

      expect(profile2.id).toBe(profile1.id);
      expect(profile2.version).toBe(2);
      expect(profile2.overallScore).toBe(0.88);
      expect(profile2.sampleSize).toBe(20);
    });

    it("persists multi-dimensional reputation scores with Bayesian parameters", async () => {
      const profile = await reputationRepository.getProfile("resource", resourceId);
      expect(profile).not.toBeNull();

      const score = await reputationRepository.upsertScore({
        profileId: profile!.id,
        dimension: "quality",
        taskSubtype: "structured_json",
        score: 0.94,
        confidence: 0.88,
        sampleSize: 18,
        alpha: 18.5,
        beta: 1.5,
        decayFactor: 0.95,
      });

      expect(score.id).toBeDefined();
      expect(score.score).toBe(0.94);
      expect(score.alpha).toBe(18.5);
      expect(score.beta).toBe(1.5);

      const scores = await reputationRepository.getScoresByProfile(profile!.id);
      expect(scores.length).toBeGreaterThan(0);
      expect(scores.some((s) => s.dimension === "quality" && s.taskSubtype === "structured_json")).toBe(true);
    });

    it("records provenance evidence and generates immutable snapshot", async () => {
      const profile = await reputationRepository.getProfile("resource", resourceId);
      const scores = await reputationRepository.getScoresByProfile(profile!.id);
      const qualityScore = scores.find((s) => s.dimension === "quality")!;

      const evidence = await reputationRepository.recordEvidence({
        reputationScoreId: qualityScore.id,
        sourceType: "internal_benchmark",
        sourceId: generateUUIDv7(),
        weight: 0.85,
        contribution: 0.95,
        isSimulated: true,
      });

      expect(evidence.id).toBeDefined();
      expect(evidence.isSimulated).toBe(true);
      expect(evidence.weight).toBe(0.85);

      const snapshot = await reputationRepository.createSnapshot("resource", resourceId, {
        overall: 0.88,
        dimensions: {
          quality_structured_json: 0.94,
        },
      });

      expect(snapshot.id).toBeDefined();
      expect(snapshot.subjectId).toBe(resourceId);
      expect(snapshot.scores).toHaveProperty("overall", 0.88);
    });
  });
});

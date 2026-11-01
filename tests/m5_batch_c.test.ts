/**
 * Milestone M5 Batch C Test Suite
 * Tasks M5.8, M5.9, M5.10, M5.11: Benchmark Suite, Observation Capture & Safety Harness
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrator.js";
import { CANONICAL_BENCHMARK_SEEDS } from "../src/evaluation/benchmarkSuite.js";
import { BenchmarkSafetyGuard } from "../src/evaluation/benchmarkSafetyGuard.js";
import { observationCaptureService } from "../src/evaluation/observationCapture.js";
import { benchmarkRepository } from "../src/evaluation/benchmarkRepository.js";
import { benchmarkHarness } from "../src/evaluation/benchmarkHarness.js";

describe("Milestone M5 Batch C — Benchmark Suite & Observation Capture (M5.8 – M5.11)", () => {
  let sampleResourceId: string;

  beforeAll(async () => {
    await runMigrations();
    const resRow = await db.query("SELECT id FROM resources.resources LIMIT 1;");
    sampleResourceId = resRow.rows[0]?.id;
  });

  afterAll(async () => {
    await db.close();
  });

  describe("Task M5.8: Reproducible Benchmark Fixtures Suite", () => {
    it("defines canonical benchmark seeds for multiple domains including adversarial cases", () => {
      expect(CANONICAL_BENCHMARK_SEEDS.length).toBeGreaterThanOrEqual(5);

      const generalSuite = CANONICAL_BENCHMARK_SEEDS.find((s) => s.domain === "general_text");
      expect(generalSuite).toBeDefined();
      expect(generalSuite!.cases.some((c) => c.name.includes("Adversarial"))).toBe(true);

      const jsonSuite = CANONICAL_BENCHMARK_SEEDS.find((s) => s.domain === "structured_json");
      expect(jsonSuite).toBeDefined();
      expect(jsonSuite!.cases.some((c) => c.evaluatorType === "schema")).toBe(true);
    });
  });

  describe("Task M5.11: Economic & Quota Safety Guard", () => {
    it("strictly blocks PAID resources when allowPaid = false (Zero Silent Paid Spend)", () => {
      expect(() => {
        BenchmarkSafetyGuard.validateBenchmarkEligibility("PAID", { allowPaid: false });
      }).toThrow(/PAID_BENCHMARK_UNAUTHORIZED/);
    });

    it("permits PAID resource when allowPaid = true explicitly authorized", () => {
      expect(() => {
        BenchmarkSafetyGuard.validateBenchmarkEligibility("PAID", { allowPaid: true });
      }).not.toThrow();
    });

    it("enforces workload bounds preventing benchmark overload", () => {
      expect(() => {
        BenchmarkSafetyGuard.validateWorkloadBounds(50, 5000, { allowPaid: false, maxCasesPerRun: 20 });
      }).toThrow(/BENCHMARK_OVERLOAD/);
    });
  });

  describe("Task M5.9 & M5.10: Benchmark Execution Harness & Observation Capture", () => {
    it("executes an end-to-end benchmark run and captures all observations safely", async () => {
      // 1. Seed benchmark in DB
      const seed = CANONICAL_BENCHMARK_SEEDS.find((s) => s.domain === "structured_json")!;
      const benchmark = await benchmarkRepository.createBenchmark({
        name: seed.name,
        slug: `${seed.slug}-${Date.now()}`,
        version: 1,
        domain: seed.domain,
        description: seed.description,
        status: "active",
      });

      for (const c of seed.cases) {
        await benchmarkRepository.createBenchmarkCase({
          benchmarkId: benchmark.id,
          name: c.name,
          difficulty: c.difficulty,
          inputPayload: c.inputPayload,
          expectedOutputPayload: c.expectedOutputPayload,
          validationStrategy: {
            evaluatorType: c.evaluatorType,
            criteria: c.criteria,
          },
          metadata: { isSeeded: true },
        });
      }

      // 2. Execute via Harness against simulated target
      const run = await benchmarkHarness.executeRun(
        benchmark.id,
        {
          resourceId: sampleResourceId,
          billingClass: "FREE",
          executePrompt: async () => ({
            rawOutput: JSON.stringify({ username: "bob_coder", age: 29, verified: true }),
            latencyMs: 340,
            tokensUsed: 150,
          }),
        },
        { allowPaid: false }
      );

      expect(run.id).toBeDefined();
      expect(run.isSimulated).toBe(true);

      // 3. Verify results recorded
      const results = await benchmarkRepository.getBenchmarkResults(run.id);
      expect(results).toHaveLength(1);
      expect(results[0].isCorrect).toBe(true);
      expect(results[0].score).toBe(1.0);
      expect(results[0].latencyMs).toBe(340);
    });

    it("captures passive production validation observations into system events", async () => {
      await observationCaptureService.captureObservation({
        resourceId: sampleResourceId,
        score: 0.92,
        confidence: 0.90,
        latencyMs: 410,
        inputTokens: 250,
        outputTokens: 80,
        isCorrect: true,
        isSimulated: false,
        billingClass: "FREE",
        validationDetails: {
          testKey: "leaked-secret-attempt", // Must be redacted
          ruleCheck: "passed",
        },
      });

      const res = await db.query(
        `SELECT payload FROM system.outbox_events WHERE event_type = 'OBSERVATION_CAPTURED' ORDER BY created_at DESC LIMIT 1;`
      );
      expect(res.rows.length).toBe(1);
      const payload = res.rows[0].payload;
      expect(payload.score).toBe(0.92);
      expect(payload.isSimulated).toBe(false);
      expect(payload.details).not.toHaveProperty("testKey");
      expect(payload.details).toHaveProperty("ruleCheck", "passed");
    });
  });
});

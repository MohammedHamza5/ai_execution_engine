/**
 * Benchmark Repository
 * Milestone M5-C & M5-H: Evaluation & Benchmark Persistence
 * Complies with Anti-Monolith File Law (<= 200 lines)
 */

import { db } from "../db/client.js";
import { generateUUIDv7 } from "../domain/common/id.js";
import {
  Benchmark,
  BenchmarkCase,
  BenchmarkRun,
  BenchmarkResult,
  BenchmarkRunStatus,
} from "../domain/evaluation/types.js";

function redactSecrets(data: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (/key|secret|token|password|auth|credential/i.test(k)) {
      continue;
    }
    sanitized[k] = v;
  }
  return sanitized;
}

export class BenchmarkRepository {
  public async createBenchmark(b: Omit<Benchmark, "id" | "createdAt">): Promise<Benchmark> {
    const id = generateUUIDv7();
    const query = `
      INSERT INTO evaluation.benchmarks (id, name, slug, version, domain, description, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, name, slug, version, domain, description, status, created_at;
    `;
    const res = await db.query(query, [
      id, b.name, b.slug, b.version, b.domain, b.description || null, b.status || "active",
    ]);
    const r = res.rows[0];
    return {
      id: r.id, name: r.name, slug: r.slug, version: Number(r.version),
      domain: r.domain, description: r.description, status: r.status, createdAt: r.created_at,
    };
  }

  public async getBenchmarkBySlug(slug: string, version = 1): Promise<Benchmark | null> {
    const res = await db.query(
      `SELECT * FROM evaluation.benchmarks WHERE slug = $1 AND version = $2;`,
      [slug, version]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id, name: r.name, slug: r.slug, version: Number(r.version),
      domain: r.domain, description: r.description, status: r.status, createdAt: r.created_at,
    };
  }

  public async createBenchmarkCase(c: Omit<BenchmarkCase, "id" | "createdAt">): Promise<BenchmarkCase> {
    const id = generateUUIDv7();
    const query = `
      INSERT INTO evaluation.benchmark_cases 
        (id, benchmark_id, name, difficulty, input_payload, expected_output_payload, validation_strategy, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
    `;
    const res = await db.query(query, [
      id, c.benchmarkId, c.name, c.difficulty,
      JSON.stringify(redactSecrets(c.inputPayload)),
      c.expectedOutputPayload ? JSON.stringify(redactSecrets(c.expectedOutputPayload)) : null,
      JSON.stringify(c.validationStrategy),
      JSON.stringify(redactSecrets(c.metadata)),
    ]);
    const r = res.rows[0];
    return {
      id: r.id, benchmarkId: r.benchmark_id, name: r.name, difficulty: Number(r.difficulty),
      inputPayload: r.input_payload, expectedOutputPayload: r.expected_output_payload,
      validationStrategy: r.validation_strategy, metadata: r.metadata, createdAt: r.created_at,
    };
  }

  public async getBenchmarkCases(benchmarkId: string): Promise<BenchmarkCase[]> {
    const res = await db.query(
      `SELECT * FROM evaluation.benchmark_cases WHERE benchmark_id = $1 ORDER BY created_at ASC;`,
      [benchmarkId]
    );
    return res.rows.map((r) => ({
      id: r.id, benchmarkId: r.benchmark_id, name: r.name, difficulty: Number(r.difficulty),
      inputPayload: r.input_payload, expectedOutputPayload: r.expected_output_payload,
      validationStrategy: r.validation_strategy, metadata: r.metadata, createdAt: r.created_at,
    }));
  }

  public async createBenchmarkRun(run: Omit<BenchmarkRun, "id" | "createdAt">): Promise<BenchmarkRun> {
    const id = generateUUIDv7();
    const query = `
      INSERT INTO evaluation.benchmark_runs 
        (id, benchmark_id, model_id, resource_id, version, status, is_simulated, started_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
    `;
    const res = await db.query(query, [
      id, run.benchmarkId, run.modelId || null, run.resourceId || null,
      run.version, run.status, run.isSimulated, run.startedAt || new Date(),
    ]);
    const r = res.rows[0];
    return {
      id: r.id, benchmarkId: r.benchmark_id, modelId: r.model_id, resourceId: r.resource_id,
      version: Number(r.version), status: r.status, isSimulated: r.is_simulated,
      startedAt: r.started_at, completedAt: r.completed_at, createdAt: r.created_at,
    };
  }

  public async updateBenchmarkRunStatus(runId: string, status: BenchmarkRunStatus): Promise<void> {
    const completedAt = (status === "completed" || status === "failed") ? new Date() : null;
    await db.query(
      `UPDATE evaluation.benchmark_runs SET status = $1, completed_at = COALESCE($2, completed_at) WHERE id = $3;`,
      [status, completedAt, runId]
    );
  }

  public async recordBenchmarkResult(res: Omit<BenchmarkResult, "id" | "createdAt">): Promise<BenchmarkResult> {
    const id = generateUUIDv7();
    const query = `
      INSERT INTO evaluation.benchmark_results 
        (id, benchmark_run_id, benchmark_case_id, output_artifact_id, raw_output, score, confidence, 
         latency_ms, input_tokens, output_tokens, is_correct, validation_details)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *;
    `;
    const row = await db.query(query, [
      id, res.benchmarkRunId, res.benchmarkCaseId, res.outputArtifactId || null, res.rawOutput || null,
      res.score, res.confidence, res.latencyMs || null, res.inputTokens || null, res.outputTokens || null,
      res.isCorrect, JSON.stringify(res.validationDetails || {}),
    ]);
    const r = row.rows[0];
    return {
      id: r.id, benchmarkRunId: r.benchmark_run_id, benchmarkCaseId: r.benchmark_case_id,
      outputArtifactId: r.output_artifact_id, rawOutput: r.raw_output, score: Number(r.score),
      confidence: Number(r.confidence), latencyMs: r.latency_ms ? Number(r.latency_ms) : undefined,
      inputTokens: r.input_tokens ? Number(r.input_tokens) : undefined,
      outputTokens: r.output_tokens ? Number(r.output_tokens) : undefined,
      isCorrect: r.is_correct, validationDetails: r.validation_details, createdAt: r.created_at,
    };
  }

  public async getBenchmarkResults(runId: string): Promise<BenchmarkResult[]> {
    const res = await db.query(
      `SELECT * FROM evaluation.benchmark_results WHERE benchmark_run_id = $1 ORDER BY created_at ASC;`,
      [runId]
    );
    return res.rows.map((r) => ({
      id: r.id, benchmarkRunId: r.benchmark_run_id, benchmarkCaseId: r.benchmark_case_id,
      outputArtifactId: r.output_artifact_id, rawOutput: r.raw_output, score: Number(r.score),
      confidence: Number(r.confidence), latencyMs: r.latency_ms ? Number(r.latency_ms) : undefined,
      inputTokens: r.input_tokens ? Number(r.input_tokens) : undefined,
      outputTokens: r.output_tokens ? Number(r.output_tokens) : undefined,
      isCorrect: r.is_correct, validationDetails: r.validation_details, createdAt: r.created_at,
    }));
  }
}

export const benchmarkRepository = new BenchmarkRepository();

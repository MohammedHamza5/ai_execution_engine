import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrator.js";
import { ensureDefaultTenant } from "../src/api/routes/tasks.js";
import { executionEngine } from "../src/engine/executionEngine.js";
import { resourceIntelligence } from "../src/resources/resourceIntelligence.js";
import { GeminiProviderAdapter } from "../src/adapters/geminiAdapter.js";
import { ProviderErrorCode } from "../src/adapters/types.js";
import { ExecutionWorker } from "../src/engine/worker.js";
import { RecoveryPolicy } from "../src/engine/recoveryPolicy.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";

describe("M1.7 — Comprehensive Failure Matrix Tests", () => {
  let tenantId: string;
  let adapter: GeminiProviderAdapter;
  let worker: ExecutionWorker;

  beforeAll(async () => {
    await runMigrations();
    tenantId = await ensureDefaultTenant();
    adapter = new GeminiProviderAdapter();
    worker = new ExecutionWorker(generateUUIDv7(), adapter);
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    adapter.resetSimulation();
    const baseId = await resourceIntelligence.ensureBaseResource();
    await db.query(`DELETE FROM resources.resources WHERE id != $1;`, [baseId]);
  });

  describe("Recovery Policy Classification Matrix", () => {
    const migratableCodes = [
      ProviderErrorCode.QUOTA_EXHAUSTED,
      ProviderErrorCode.RATE_LIMIT,
      ProviderErrorCode.TIMEOUT,
      ProviderErrorCode.NETWORK_ERROR,
      ProviderErrorCode.SERVER_ERROR,
      ProviderErrorCode.SERVICE_UNAVAILABLE,
    ];

    for (const code of migratableCodes) {
      it(`classifies ${code} as MIGRATE_RESOURCE`, () => {
        const error = GeminiProviderAdapter.createNormalizedError(code);
        const decision = RecoveryPolicy.evaluate(error);
        expect(decision.action).toBe("MIGRATE_RESOURCE");
        expect(decision.migrationRecommended).toBe(true);
      });
    }

    const nonRecoverableCodes = [
      ProviderErrorCode.INVALID_REQUEST,
      ProviderErrorCode.AUTHENTICATION,
      ProviderErrorCode.AUTHORIZATION,
      ProviderErrorCode.MODEL_NOT_FOUND,
      ProviderErrorCode.CONTEXT_TOO_LARGE,
      ProviderErrorCode.UNSUPPORTED_CAPABILITY,
      ProviderErrorCode.CONTENT_FILTER,
    ];

    for (const code of nonRecoverableCodes) {
      it(`classifies ${code} as FAIL (non-recoverable)`, () => {
        const error = GeminiProviderAdapter.createNormalizedError(code);
        const decision = RecoveryPolicy.evaluate(error);
        expect(decision.action).toBe("FAIL");
        expect(decision.retryable).toBe(false);
        expect(decision.migrationRecommended).toBe(false);
      });
    }
  });

  describe("End-to-End Worker Recovery Across Matrix Categories", () => {
    it("successfully recovers and migrates when Attempt 1 suffers NETWORK_ERROR", async () => {
      const resourceAId = await resourceIntelligence.ensureBaseResource();
      await db.query(`UPDATE resources.resources SET priority = 100 WHERE id = $1;`, [resourceAId]);

      const resourceBId = await resourceIntelligence.registerResource({
        providerSlug: "gemini",
        providerName: "Google DeepMind",
        modelSlug: "gemini-1.5-flash-8b",
        priority: 50,
      });

      adapter.setResourceFault(resourceAId, ProviderErrorCode.NETWORK_ERROR);

      const taskResult = await executionEngine.createTaskAndPlan({
        tenantId,
        taskType: "network_err_recovery",
        inputPayload: { prompt: "Network error test prompt" },
      });

      const executed = await worker.claimAndExecuteNext(taskResult.stepExecutionId);
      expect(executed).toBe(true);

      const task = await executionEngine.getTask(taskResult.taskId);
      expect(task?.status).toBe("completed");

      const step = await db.query(`SELECT * FROM execution.step_executions WHERE id = $1;`, [taskResult.stepExecutionId]);
      expect(step.rows[0].resource_id).toBe(resourceBId);
      expect(step.rows[0].status).toBe("completed");
    });

    it("successfully recovers and migrates when Attempt 1 suffers SERVICE_UNAVAILABLE (HTTP 503)", async () => {
      const resourceAId = await resourceIntelligence.ensureBaseResource();
      await db.query(`UPDATE resources.resources SET priority = 100 WHERE id = $1;`, [resourceAId]);

      const resourceBId = await resourceIntelligence.registerResource({
        providerSlug: "gemini",
        providerName: "Google DeepMind",
        modelSlug: "gemini-1.5-flash-8b",
        priority: 50,
      });

      adapter.setResourceFault(resourceAId, ProviderErrorCode.SERVICE_UNAVAILABLE);

      const taskResult = await executionEngine.createTaskAndPlan({
        tenantId,
        taskType: "service_unavailable_recovery",
        inputPayload: { prompt: "503 overload test prompt" },
      });

      const executed = await worker.claimAndExecuteNext(taskResult.stepExecutionId);
      expect(executed).toBe(true);

      const task = await executionEngine.getTask(taskResult.taskId);
      expect(task?.status).toBe("completed");

      const step = await db.query(`SELECT * FROM execution.step_executions WHERE id = $1;`, [taskResult.stepExecutionId]);
      expect(step.rows[0].resource_id).toBe(resourceBId);
    });

    it("fails task immediately upon AUTHENTICATION error without attempting migration", async () => {
      const resourceAId = await resourceIntelligence.ensureBaseResource();
      await db.query(`UPDATE resources.resources SET priority = 100 WHERE id = $1;`, [resourceAId]);

      // Auxiliary resource is available, but must NOT be migrated to for Auth failures
      await resourceIntelligence.registerResource({
        providerSlug: "gemini",
        providerName: "Google DeepMind",
        modelSlug: "gemini-1.5-flash-8b",
        priority: 50,
      });

      adapter.setResourceFault(resourceAId, ProviderErrorCode.AUTHENTICATION);

      const taskResult = await executionEngine.createTaskAndPlan({
        tenantId,
        taskType: "auth_failure_test",
        inputPayload: { prompt: "Invalid credentials prompt" },
      });

      const executed = await worker.claimAndExecuteNext(taskResult.stepExecutionId);
      expect(executed).toBe(false);

      const task = await executionEngine.getTask(taskResult.taskId);
      expect(task?.status).toBe("failed");

      const attempts = await db.query(
        `SELECT * FROM execution.execution_attempts WHERE step_execution_id = $1;`,
        [taskResult.stepExecutionId]
      );
      expect(attempts.rows.length).toBe(1);
      expect(attempts.rows[0].status).toBe("failed");
    });

    it("fails task immediately upon CONTEXT_TOO_LARGE without attempting migration", async () => {
      const resourceAId = await resourceIntelligence.ensureBaseResource();
      adapter.setResourceFault(resourceAId, ProviderErrorCode.CONTEXT_TOO_LARGE);

      const taskResult = await executionEngine.createTaskAndPlan({
        tenantId,
        taskType: "context_overflow_test",
        inputPayload: { prompt: "Too long prompt" },
      });

      const executed = await worker.claimAndExecuteNext(taskResult.stepExecutionId);
      expect(executed).toBe(false);

      const task = await executionEngine.getTask(taskResult.taskId);
      expect(task?.status).toBe("failed");

      const attempts = await db.query(
        `SELECT * FROM execution.execution_attempts WHERE step_execution_id = $1;`,
        [taskResult.stepExecutionId]
      );
      expect(attempts.rows.length).toBe(1);
    });
  });
});

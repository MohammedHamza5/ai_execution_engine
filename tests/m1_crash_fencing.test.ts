import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrator.js";
import { ensureDefaultTenant } from "../src/api/routes/tasks.js";
import { executionEngine } from "../src/engine/executionEngine.js";
import { resourceIntelligence } from "../src/resources/resourceIntelligence.js";
import { checkpointService } from "../src/engine/checkpointService.js";
import { GeminiProviderAdapter } from "../src/adapters/geminiAdapter.js";
import { ProviderErrorCode } from "../src/adapters/types.js";
import { ExecutionWorker } from "../src/engine/worker.js";
import { RecoveryPolicy } from "../src/engine/recoveryPolicy.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";
import { seedLiveProviders } from "../src/resources/liveResourceSeeder.js";

describe("M1.8 — Crash, Idempotency & Fencing Hardening Tests", () => {
  let tenantId: string;
  let adapter: GeminiProviderAdapter;

  beforeAll(async () => {
    await runMigrations();
    tenantId = await ensureDefaultTenant();
    adapter = new GeminiProviderAdapter();
  });

  afterAll(async () => {
    await seedLiveProviders();
  });

  beforeEach(async () => {
    adapter.resetSimulation();
    const baseId = await resourceIntelligence.ensureBaseResource();
    await db.query(`DELETE FROM resources.resources WHERE id != $1;`, [baseId]);
  });

  it("Scenario A: Worker 1 crashes before provider call -> lease expires -> Worker 2 recovers and completes step", async () => {
    const taskResult = await executionEngine.createTaskAndPlan({
      tenantId,
      taskType: "crash_recovery_test",
      inputPayload: { prompt: "Crash scenario A test prompt" },
      priority: 10,
    });

    // Simulate Worker 1 claiming the step and then dying immediately
    const worker1 = new ExecutionWorker(generateUUIDv7(), adapter);
    const client1 = await db.getClient();
    await client1.query("BEGIN;");
    await client1.query(
      `UPDATE execution.step_executions
       SET status = 'running',
           worker_id = $1,
           lease_token = gen_random_uuid(),
           lease_expires_at = now() - interval '5 seconds', -- Lease already expired!
           fencing_token = fencing_token + 1
       WHERE id = $2;`,
      [worker1.workerId, taskResult.stepExecutionId]
    );
    await client1.query("COMMIT;");
    client1.release();

    // Worker 2 comes in to claim work (sees status = 'running' AND lease_expires_at <= now())
    const worker2 = new ExecutionWorker(generateUUIDv7(), adapter);
    const claimedByWorker2 = await worker2.claimAndExecuteNext(taskResult.stepExecutionId);
    expect(claimedByWorker2).toBe(true);

    // Verify task completed under Worker 2
    const task = await executionEngine.getTask(taskResult.taskId);
    expect(task?.status).toBe("completed");

    const step = await db.query(`SELECT * FROM execution.step_executions WHERE id = $1;`, [taskResult.stepExecutionId]);
    expect(step.rows[0].worker_id).toBe(worker2.workerId);
    expect(step.rows[0].status).toBe("completed");
    expect(parseInt(step.rows[0].fencing_token, 10)).toBeGreaterThanOrEqual(2);
  });

  it("Scenario C: Crash after durable checkpoint -> recovery state is fully reconstructable from PostgreSQL", async () => {
    const resourceId = await resourceIntelligence.ensureBaseResource();
    const taskResult = await executionEngine.createTaskAndPlan({
      tenantId,
      taskType: "crash_checkpoint_test",
      inputPayload: { prompt: "Crash scenario C prompt" },
    });

    const attemptId = generateUUIDv7();
    await db.query(
      `INSERT INTO execution.execution_attempts (
        id, step_execution_id, attempt_number, resource_id, status, started_at
      ) VALUES ($1, $2, 1, $3, 'running', now());`,
      [attemptId, taskResult.stepExecutionId, resourceId]
    );

    const error = GeminiProviderAdapter.createNormalizedError(ProviderErrorCode.QUOTA_EXHAUSTED);
    const decision = RecoveryPolicy.evaluate(error);

    // Persist durable checkpoint
    const checkpoint = await checkpointService.createCheckpoint({
      taskId: taskResult.taskId,
      executionId: taskResult.executionId,
      stepExecutionId: taskResult.stepExecutionId,
      attemptId,
      attemptNumber: 1,
      resourceId,
      fencingToken: 0,
      executionState: "attempt_failed",
      error,
      recoveryDecision: decision,
    });

    expect(checkpoint.id).toBeDefined();

    // Reconstruct recovery state purely from PostgreSQL (without any in-memory worker state)
    const state = await checkpointService.reconstructRecoveryState(taskResult.executionId);
    expect(state).not.toBeNull();
    expect(state?.taskId).toBe(taskResult.taskId);
    expect(state?.lastAttemptId).toBe(attemptId);
    expect(state?.lastAttemptNumber).toBe(1);
    expect(state?.lastResourceId).toBe(resourceId);
    expect(state?.failureInfo?.code).toBe(ProviderErrorCode.QUOTA_EXHAUSTED);
    expect(state?.canResume).toBe(true);
  });

  it("Scenario E: Zombie Worker fencing: stale worker cannot overwrite newer execution state", async () => {
    const taskResult = await executionEngine.createTaskAndPlan({
      tenantId,
      taskType: "zombie_fencing_test",
      inputPayload: { prompt: "Zombie worker test" },
    });

    // Worker 1 claims with fencing_token = 1
    const worker1 = new ExecutionWorker(generateUUIDv7(), adapter);
    const worker2 = new ExecutionWorker(generateUUIDv7(), adapter);

    const client = await db.getClient();
    await client.query("BEGIN;");
    const r1 = await client.query(
      `UPDATE execution.step_executions
       SET status = 'running', worker_id = $1, fencing_token = fencing_token + 1
       WHERE id = $2 RETURNING fencing_token;`,
      [worker1.workerId, taskResult.stepExecutionId]
    );
    const token1 = parseInt(r1.rows[0].fencing_token, 10);
    await client.query("COMMIT;");

    // Worker 2 takes over and increments fencing_token to 2
    await client.query("BEGIN;");
    const r2 = await client.query(
      `UPDATE execution.step_executions
       SET status = 'running', worker_id = $1, fencing_token = fencing_token + 1
       WHERE id = $2 RETURNING fencing_token;`,
      [worker2.workerId, taskResult.stepExecutionId]
    );
    const token2 = parseInt(r2.rows[0].fencing_token, 10);
    await client.query("COMMIT;");
    client.release();

    expect(token2).toBeGreaterThan(token1);

    // Stale Worker 1 attempts checkpoint write -> must be rejected with STALE_WORKER
    await expect(
      checkpointService.createCheckpoint({
        taskId: taskResult.taskId,
        executionId: taskResult.executionId,
        stepExecutionId: taskResult.stepExecutionId,
        attemptId: generateUUIDv7(),
        attemptNumber: 1,
        resourceId: generateUUIDv7(),
        fencingToken: token1, // Stale token!
        executionState: "stale_write",
      })
    ).rejects.toThrow("STALE_WORKER_CHECKPOINT_REJECTED");

    // Stale Worker 1 attempts final commit -> must be rejected with STALE_WORKER
    await expect(
      executionEngine.commitAttemptSuccess({
        stepExecutionId: taskResult.stepExecutionId,
        executionId: taskResult.executionId,
        taskId: taskResult.taskId,
        tenantId,
        attemptId: generateUUIDv7(),
        fencingToken: token1, // Stale token!
        response: {
          requestId: generateUUIDv7(),
          outputText: "Stale result",
          usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
          latencyMs: 50,
          finishReason: "stop",
        },
      })
    ).rejects.toThrow("STALE_WORKER_COMMIT_REJECTED");
  });

  it("Scenario F: Idempotency under duplicate recovery checkpoint calls", async () => {
    const resourceId = await resourceIntelligence.ensureBaseResource();
    const taskResult = await executionEngine.createTaskAndPlan({
      tenantId,
      taskType: "idempotency_recovery_test",
      inputPayload: { prompt: "Idempotent checkpoint prompt" },
    });

    const attemptId = generateUUIDv7();

    // Call createCheckpoint twice with the same attemptId
    const cp1 = await checkpointService.createCheckpoint({
      taskId: taskResult.taskId,
      executionId: taskResult.executionId,
      stepExecutionId: taskResult.stepExecutionId,
      attemptId,
      attemptNumber: 1,
      resourceId,
      fencingToken: 0,
      executionState: "attempt_1_failed",
    });

    const cp2 = await checkpointService.createCheckpoint({
      taskId: taskResult.taskId,
      executionId: taskResult.executionId,
      stepExecutionId: taskResult.stepExecutionId,
      attemptId,
      attemptNumber: 1,
      resourceId,
      fencingToken: 0,
      executionState: "attempt_1_failed",
    });

    // Idempotent: returns the exact same checkpoint without duplicating rows
    expect(cp1.id).toBe(cp2.id);
    expect(cp1.sequenceNumber).toBe(cp2.sequenceNumber);

    const countRes = await db.query(
      `SELECT count(*) FROM execution.checkpoints WHERE execution_id = $1;`,
      [taskResult.executionId]
    );
    expect(parseInt(countRes.rows[0].count, 10)).toBe(1);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrator.js";
import { executionEngine } from "../src/engine/executionEngine.js";
import { ensureDefaultTenant } from "../src/api/routes/tasks.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";
import { checkpointService } from "../src/engine/checkpointService.js";
import { ProviderErrorCode, NormalizedProviderError } from "../src/adapters/types.js";
import { RecoveryPolicy } from "../src/engine/recoveryPolicy.js";

describe("Durable Checkpoint Persistence Tests (M1.2)", () => {
  let tenantId: string;

  beforeAll(async () => {
    await runMigrations();
    tenantId = await ensureDefaultTenant();
  });

  afterAll(async () => {
    await db.close();
  });

  it("creates a durable ordered checkpoint in PostgreSQL", async () => {
    const taskResult = await executionEngine.createTaskAndPlan({
      tenantId,
      taskType: "checkpoint_test",
      inputPayload: { prompt: "Test checkpoint persistence" },
    });

    const attemptId = generateUUIDv7();
    const resourceRow = await db.query(
      "SELECT resource_id FROM execution.step_executions WHERE id = $1;",
      [taskResult.stepExecutionId]
    );
    const resourceId = resourceRow.rows[0].resource_id;

    await db.query(
      `INSERT INTO execution.execution_attempts (id, step_execution_id, attempt_number, resource_id, status)
       VALUES ($1, $2, 1, $3, 'running');`,
      [attemptId, taskResult.stepExecutionId, resourceId]
    );

    const checkpoint = await checkpointService.createCheckpoint({
      taskId: taskResult.taskId,
      executionId: taskResult.executionId,
      stepExecutionId: taskResult.stepExecutionId,
      attemptId,
      attemptNumber: 1,
      resourceId,
      fencingToken: 0,
      executionState: "running",
      providerSlug: "gemini",
      modelSlug: "gemini-1.5-flash",
      completedArtifactIds: [],
    });

    expect(checkpoint.id).toBeDefined();
    expect(checkpoint.sequenceNumber).toBe(1);
    expect(checkpoint.snapshotData.attemptId).toBe(attemptId);

    // Verify durable record exists in PostgreSQL
    const dbCheck = await db.query(
      "SELECT * FROM execution.checkpoints WHERE id = $1;",
      [checkpoint.id]
    );
    expect(dbCheck.rows.length).toBe(1);
    expect(dbCheck.rows[0].sequence_number).toBe(1);
  });

  it("enforces monotonic ordering of checkpoints (sequence 1, 2, ...)", async () => {
    const taskResult = await executionEngine.createTaskAndPlan({
      tenantId,
      taskType: "ordering_test",
      inputPayload: { prompt: "Test ordering" },
    });

    const stepId = taskResult.stepExecutionId;
    const execId = taskResult.executionId;
    const attempt1 = generateUUIDv7();
    const attempt2 = generateUUIDv7();
    const resId = generateUUIDv7();

    await db.query(
      `INSERT INTO execution.execution_attempts (id, step_execution_id, attempt_number, status)
       VALUES ($1, $2, 1, 'running'), ($3, $2, 2, 'running');`,
      [attempt1, stepId, attempt2]
    );

    const cp1 = await checkpointService.createCheckpoint({
      taskId: taskResult.taskId,
      executionId: execId,
      stepExecutionId: stepId,
      attemptId: attempt1,
      attemptNumber: 1,
      resourceId: resId,
      fencingToken: 0,
      executionState: "running",
    });

    const cp2 = await checkpointService.createCheckpoint({
      taskId: taskResult.taskId,
      executionId: execId,
      stepExecutionId: stepId,
      attemptId: attempt2,
      attemptNumber: 2,
      resourceId: resId,
      fencingToken: 0,
      executionState: "running",
    });

    expect(cp1.sequenceNumber).toBe(1);
    expect(cp2.sequenceNumber).toBe(2);

    const history = await checkpointService.listCheckpoints(execId);
    expect(history.length).toBe(2);
    expect(history[0].sequenceNumber).toBe(1);
    expect(history[1].sequenceNumber).toBe(2);
  });

  it("is idempotent: duplicate checkpoint calls for the same attempt return existing record", async () => {
    const taskResult = await executionEngine.createTaskAndPlan({
      tenantId,
      taskType: "idempotency_test",
      inputPayload: { prompt: "Test idempotency" },
    });

    const attemptId = generateUUIDv7();
    const resId = generateUUIDv7();

    await db.query(
      `INSERT INTO execution.execution_attempts (id, step_execution_id, attempt_number, status)
       VALUES ($1, $2, 1, 'running');`,
      [attemptId, taskResult.stepExecutionId]
    );

    const params = {
      taskId: taskResult.taskId,
      executionId: taskResult.executionId,
      stepExecutionId: taskResult.stepExecutionId,
      attemptId,
      attemptNumber: 1,
      resourceId: resId,
      fencingToken: 0,
      executionState: "running",
    };

    const first = await checkpointService.createCheckpoint(params);
    const second = await checkpointService.createCheckpoint(params);

    expect(second.id).toBe(first.id);
    expect(second.sequenceNumber).toBe(first.sequenceNumber);

    // Verify only ONE checkpoint exists in database
    const countRes = await db.query(
      "SELECT count(*) FROM execution.checkpoints WHERE execution_id = $1;",
      [taskResult.executionId]
    );
    expect(parseInt(countRes.rows[0].count, 10)).toBe(1);
  });

  it("persists failure error and updates attempt status to failed", async () => {
    const taskResult = await executionEngine.createTaskAndPlan({
      tenantId,
      taskType: "failure_checkpoint_test",
      inputPayload: { prompt: "Test failure checkpoint" },
    });

    const attemptId = generateUUIDv7();
    const resId = generateUUIDv7();

    await db.query(
      `INSERT INTO execution.execution_attempts (id, step_execution_id, attempt_number, status)
       VALUES ($1, $2, 1, 'running');`,
      [attemptId, taskResult.stepExecutionId]
    );

    const error: NormalizedProviderError = {
      code: ProviderErrorCode.QUOTA_EXHAUSTED,
      message: "Daily token limit exceeded",
      retryable: true,
      migrationRecommended: true,
      providerCode: "RESOURCE_EXHAUSTED",
    };

    const decision = RecoveryPolicy.evaluate(error);

    const cp = await checkpointService.createCheckpoint({
      taskId: taskResult.taskId,
      executionId: taskResult.executionId,
      stepExecutionId: taskResult.stepExecutionId,
      attemptId,
      attemptNumber: 1,
      resourceId: resId,
      fencingToken: 0,
      executionState: "failed",
      error,
      recoveryDecision: decision,
    });

    expect(cp.snapshotData.failureInfo?.code).toBe("QUOTA_EXHAUSTED");
    expect(cp.snapshotData.recoveryDecision?.action).toBe("MIGRATE_RESOURCE");

    // Verify execution.execution_attempts was updated to failed
    const attemptRow = await db.query(
      "SELECT status, error_id FROM execution.execution_attempts WHERE id = $1;",
      [attemptId]
    );
    expect(attemptRow.rows[0].status).toBe("failed");
    expect(attemptRow.rows[0].error_id).not.toBeNull();

    // Verify execution.execution_errors has the record
    const errorRow = await db.query(
      "SELECT code, provider_code, retryable, migratable FROM execution.execution_errors WHERE id = $1;",
      [attemptRow.rows[0].error_id]
    );
    expect(errorRow.rows[0].code).toBe("QUOTA_EXHAUSTED");
    expect(errorRow.rows[0].migratable).toBe(true);

    // Verify outbox event CHECKPOINT_CREATED was written
    const outboxRow = await db.query(
      "SELECT event_type FROM system.outbox_events WHERE aggregate_id = $1;",
      [taskResult.executionId]
    );
    expect(outboxRow.rows.some((r) => r.event_type === "CHECKPOINT_CREATED")).toBe(true);
  });

  it("rejects stale worker with fencing token mismatch (anti-zombie protection)", async () => {
    const taskResult = await executionEngine.createTaskAndPlan({
      tenantId,
      taskType: "fencing_checkpoint_test",
      inputPayload: { prompt: "Test fencing" },
    });

    const stepId = taskResult.stepExecutionId;
    const attemptId = generateUUIDv7();

    // Bump fencing token to 2 (simulating lease stolen by newer worker)
    await db.query(
      "UPDATE execution.step_executions SET fencing_token = 2 WHERE id = $1;",
      [stepId]
    );

    // Stale worker provides fencingToken = 1
    await expect(
      checkpointService.createCheckpoint({
        taskId: taskResult.taskId,
        executionId: taskResult.executionId,
        stepExecutionId: stepId,
        attemptId,
        attemptNumber: 1,
        resourceId: generateUUIDv7(),
        fencingToken: 1, // STALE!
        executionState: "running",
      })
    ).rejects.toThrow(/STALE_WORKER_CHECKPOINT_REJECTED/);

    // Assert that no checkpoint was inserted
    const countRes = await db.query(
      "SELECT count(*) FROM execution.checkpoints WHERE execution_id = $1;",
      [taskResult.executionId]
    );
    expect(parseInt(countRes.rows[0].count, 10)).toBe(0);
  });

  it("reconstructs recovery state enabling recovery after process/worker restart", async () => {
    const taskResult = await executionEngine.createTaskAndPlan({
      tenantId,
      taskType: "reconstruction_test",
      inputPayload: { prompt: "Test reconstruction" },
    });

    const attemptId = generateUUIDv7();
    const resId = generateUUIDv7();
    const partialArtifactId = generateUUIDv7();

    await db.query(
      `INSERT INTO execution.execution_attempts (id, step_execution_id, attempt_number, status)
       VALUES ($1, $2, 1, 'running');`,
      [attemptId, taskResult.stepExecutionId]
    );

    const error: NormalizedProviderError = {
      code: ProviderErrorCode.TIMEOUT,
      message: "Gateway timeout 504",
      retryable: true,
      migrationRecommended: true,
    };
    const decision = RecoveryPolicy.evaluate(error);

    await checkpointService.createCheckpoint({
      taskId: taskResult.taskId,
      executionId: taskResult.executionId,
      stepExecutionId: taskResult.stepExecutionId,
      attemptId,
      attemptNumber: 1,
      resourceId: resId,
      providerSlug: "gemini",
      modelSlug: "gemini-1.5-flash",
      fencingToken: 0,
      executionState: "checkpointing",
      error,
      recoveryDecision: decision,
      partialArtifactId,
      completedArtifactIds: ["art-1", "art-2"],
    });

    // Simulate complete process restart: Reconstruct recovery context purely from DB
    const state = await checkpointService.reconstructRecoveryState(taskResult.executionId);

    expect(state).not.toBeNull();
    expect(state?.taskId).toBe(taskResult.taskId);
    expect(state?.lastAttemptId).toBe(attemptId);
    expect(state?.lastAttemptNumber).toBe(1);
    expect(state?.lastResourceId).toBe(resId);
    expect(state?.providerSlug).toBe("gemini");
    expect(state?.modelSlug).toBe("gemini-1.5-flash");
    expect(state?.partialArtifactId).toBe(partialArtifactId);
    expect(state?.completedArtifactIds).toEqual(["art-1", "art-2"]);
    expect(state?.canResume).toBe(true);
    expect(state?.recoveryDecision?.action).toBe("MIGRATE_RESOURCE");
  });
});

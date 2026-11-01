import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrator.js";
import { ensureDefaultTenant } from "../src/api/routes/tasks.js";
import { executionEngine } from "../src/engine/executionEngine.js";
import { resourceIntelligence } from "../src/resources/resourceIntelligence.js";
import { GeminiProviderAdapter } from "../src/adapters/geminiAdapter.js";
import { ProviderErrorCode } from "../src/adapters/types.js";
import { ExecutionWorker } from "../src/engine/worker.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";

describe("M1.5 & M1.6 — Multi-Attempt Worker Lifecycle & Migration Integration", () => {
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
    // Clean up auxiliary test resources to keep database predictable
    await db.query(`DELETE FROM resources.resources WHERE id != $1;`, [baseId]);
  });

  it("canonical M1 migration flow: Attempt 1 (QUOTA_EXHAUSTED) -> Checkpoint -> Resource Intelligence -> Attempt 2 (Success) -> Task COMPLETED", async () => {
    // 1. Ensure Resource A exists (primary default) and set high priority
    const resourceAId = await resourceIntelligence.ensureBaseResource();
    await db.query(`UPDATE resources.resources SET priority = 100 WHERE id = $1;`, [resourceAId]);

    // 2. Register Resource B as eligible alternative with secondary priority (50 < 100)
    const resourceBId = await resourceIntelligence.registerResource({
      providerSlug: "gemini",
      providerName: "Google DeepMind",
      modelSlug: "gemini-1.5-flash-8b",
      modelName: "Gemini 1.5 Flash 8B",
      priority: 50,
      tier: "free",
      status: "active",
      quotaRemaining: 100000,
      circuitHealth: "healthy",
      capabilities: ["general_text"],
    });

    // 3. Configure deterministic fault injection: Resource A fails with QUOTA_EXHAUSTED
    adapter.setResourceFault(resourceAId, ProviderErrorCode.QUOTA_EXHAUSTED);

    // 4. Create Task & Plan targeting primary resource
    const taskResult = await executionEngine.createTaskAndPlan({
      tenantId,
      taskType: "e2e_migration_test",
      inputPayload: { prompt: "Analyze distributed failover architectures" },
      priority: 50,
      requirements: {
        allowPaid: false,
      },
    });

    // 5. Worker executes work unit through multi-attempt recovery loop
    const executed = await worker.claimAndExecuteNext(taskResult.stepExecutionId);
    expect(executed).toBe(true);

    // ------------------------------------------------------------------------
    // Comprehensive Database Assertions (Physical Verification)
    // ------------------------------------------------------------------------

    // A. Verify Task completed with output artifact
    const taskQuery = await db.query(`SELECT * FROM tasks.tasks WHERE id = $1;`, [taskResult.taskId]);
    expect(taskQuery.rows.length).toBe(1);
    const taskRow = taskQuery.rows[0];
    expect(taskRow.status).toBe("completed");
    expect(taskRow.output_artifact_id).toBeDefined();
    expect(taskRow.completed_at).not.toBeNull();

    // B. Verify Execution completed
    const execQuery = await db.query(`SELECT * FROM execution.executions WHERE id = $1;`, [taskResult.executionId]);
    expect(execQuery.rows[0].status).toBe("completed");

    // C. Verify Step Execution completed under migrated resource
    const stepQuery = await db.query(`SELECT * FROM execution.step_executions WHERE id = $1;`, [taskResult.stepExecutionId]);
    const stepRow = stepQuery.rows[0];
    expect(stepRow.status).toBe("completed");
    expect(stepRow.resource_id).toBe(resourceBId); // Successfully migrated to Resource B!
    expect(parseInt(stepRow.fencing_token, 10)).toBeGreaterThanOrEqual(2); // Fencing token incremented monotonically

    // D. Verify Exactly Two Distinct Attempts Belonging to the Same Logical Step
    const attemptsQuery = await db.query(
      `SELECT * FROM execution.execution_attempts 
       WHERE step_execution_id = $1 
       ORDER BY attempt_number ASC;`,
      [taskResult.stepExecutionId]
    );
    expect(attemptsQuery.rows.length).toBe(2);

    // Attempt 1: Failed on Resource A
    const attempt1 = attemptsQuery.rows[0];
    expect(attempt1.attempt_number).toBe(1);
    expect(attempt1.resource_id).toBe(resourceAId);
    expect(attempt1.status).toBe("failed");
    expect(attempt1.error_id).not.toBeNull();

    // Attempt 2: Succeeded on Resource B
    const attempt2 = attemptsQuery.rows[1];
    expect(attempt2.attempt_number).toBe(2);
    expect(attempt2.resource_id).toBe(resourceBId);
    expect(attempt2.status).toBe("success");
    expect(attempt2.completed_at).not.toBeNull();

    // E. Verify Execution Error Record
    const errorQuery = await db.query(`SELECT * FROM execution.execution_errors WHERE id = $1;`, [attempt1.error_id]);
    expect(errorQuery.rows.length).toBe(1);
    expect(errorQuery.rows[0].code).toBe(ProviderErrorCode.QUOTA_EXHAUSTED);
    expect(errorQuery.rows[0].migratable).toBe(true);

    // F. Verify Durable Checkpoint
    const checkpointQuery = await db.query(
      `SELECT * FROM execution.checkpoints 
       WHERE execution_id = $1 
       ORDER BY sequence_number ASC;`,
      [taskResult.executionId]
    );
    expect(checkpointQuery.rows.length).toBeGreaterThanOrEqual(1);
    const checkpoint = checkpointQuery.rows[0];
    expect(checkpoint.sequence_number).toBe(1);
    expect(checkpoint.snapshot_data.attemptNumber).toBe(1);
    expect(checkpoint.snapshot_data.resourceId).toBe(resourceAId);
    expect(checkpoint.snapshot_data.failureInfo.code).toBe(ProviderErrorCode.QUOTA_EXHAUSTED);

    // G. Verify Content-Addressed Artifact
    const artifactQuery = await db.query(
      `SELECT * FROM artifacts.artifacts WHERE id = $1;`,
      [taskRow.output_artifact_id]
    );
    expect(artifactQuery.rows.length).toBe(1);
    expect(artifactQuery.rows[0].status).toBe("active");
    expect(artifactQuery.rows[0].content_hash).toBeDefined();

    // H. Verify Validation Gate
    const validationQuery = await db.query(
      `SELECT * FROM validation.validations WHERE step_execution_id = $1;`,
      [taskResult.stepExecutionId]
    );
    expect(validationQuery.rows.length).toBe(1);
    expect(validationQuery.rows[0].status).toBe("passed");

    // I. Verify Outbox Events (Decoupled Domain Auditing)
    const outboxQuery = await db.query(
      `SELECT event_type FROM system.outbox_events 
       WHERE payload->>'taskId' = $1 OR aggregate_id::text = $1 OR payload->>'stepExecutionId' = $2;`,
      [taskResult.taskId, taskResult.stepExecutionId]
    );
    const eventTypes = outboxQuery.rows.map((r: any) => r.event_type);
    expect(eventTypes).toContain("CHECKPOINT_CREATED");
    expect(eventTypes).toContain("RESOURCE_MIGRATED");
    expect(eventTypes).toContain("TASK_COMPLETED");
  });

  it("non-recoverable failure (INVALID_REQUEST) fails execution directly without migration", async () => {
    const resourceAId = await resourceIntelligence.ensureBaseResource();
    adapter.setResourceFault(resourceAId, ProviderErrorCode.INVALID_REQUEST);

    const taskResult = await executionEngine.createTaskAndPlan({
      tenantId,
      taskType: "non_recoverable_test",
      inputPayload: { prompt: "Bad parameter test" },
      priority: 10,
    });

    const executed = await worker.claimAndExecuteNext(taskResult.stepExecutionId);
    expect(executed).toBe(false);

    // Verify task failed directly
    const task = await executionEngine.getTask(taskResult.taskId);
    expect(task?.status).toBe("failed");
    expect(task?.errorId).not.toBeNull();

    // Verify only 1 attempt existed (no pointless migration attempts)
    const attempts = await db.query(
      `SELECT * FROM execution.execution_attempts WHERE step_execution_id = $1;`,
      [taskResult.stepExecutionId]
    );
    expect(attempts.rows.length).toBe(1);
    expect(attempts.rows[0].status).toBe("failed");
  });

  it("handles NO_ELIGIBLE_RESOURCE safely when capacity cannot be found", async () => {
    const resourceAId = await resourceIntelligence.ensureBaseResource();
    adapter.setResourceFault(resourceAId, ProviderErrorCode.QUOTA_EXHAUSTED);

    // No alternative resources registered; only Resource A exists
    const taskResult = await executionEngine.createTaskAndPlan({
      tenantId,
      taskType: "exhaustion_test",
      inputPayload: { prompt: "No alternative resource test" },
      priority: 10,
      requirements: { allowPaid: false },
    });

    const executed = await worker.claimAndExecuteNext(taskResult.stepExecutionId);
    expect(executed).toBe(false);

    // Verify task transitions to failed without infinite busy loops
    const task = await executionEngine.getTask(taskResult.taskId);
    expect(task?.status).toBe("failed");

    const step = await db.query(
      `SELECT status FROM execution.step_executions WHERE id = $1;`,
      [taskResult.stepExecutionId]
    );
    expect(step.rows[0].status).toBe("failed");
  });

  it("guarantees monotonic fencing: stale worker late write is strictly rejected", async () => {
    const resourceAId = await resourceIntelligence.ensureBaseResource();
    const taskResult = await executionEngine.createTaskAndPlan({
      tenantId,
      taskType: "stale_worker_test",
      inputPayload: { prompt: "Fencing race test" },
      priority: 10,
    });

    // Simulate Worker 1 claiming the step
    const worker1 = new ExecutionWorker(generateUUIDv7(), adapter);
    const worker2 = new ExecutionWorker(generateUUIDv7(), adapter);

    // Worker 1 claims
    const client1 = await db.getClient();
    await client1.query("BEGIN;");
    const claimRes1 = await client1.query(
      `UPDATE execution.step_executions
       SET status = 'running',
           worker_id = $1,
           fencing_token = fencing_token + 1
       WHERE id = $2
       RETURNING fencing_token;`,
      [worker1.workerId, taskResult.stepExecutionId]
    );
    const worker1Token = parseInt(claimRes1.rows[0].fencing_token, 10);
    await client1.query("COMMIT;");
    client1.release();

    // Worker 1 freezes. Lease expires. Worker 2 claims and increments fencing token.
    const client2 = await db.getClient();
    await client2.query("BEGIN;");
    const claimRes2 = await client2.query(
      `UPDATE execution.step_executions
       SET status = 'running',
           worker_id = $1,
           fencing_token = fencing_token + 1
       WHERE id = $2
       RETURNING fencing_token;`,
      [worker2.workerId, taskResult.stepExecutionId]
    );
    const worker2Token = parseInt(claimRes2.rows[0].fencing_token, 10);
    await client2.query("COMMIT;");
    client2.release();

    expect(worker2Token).toBeGreaterThan(worker1Token);

    // Worker 1 wakes up and attempts a late completion with its old token
    await expect(
      executionEngine.commitAttemptSuccess({
        stepExecutionId: taskResult.stepExecutionId,
        executionId: taskResult.executionId,
        taskId: taskResult.taskId,
        tenantId,
        attemptId: generateUUIDv7(),
        fencingToken: worker1Token, // Stale token!
        response: {
          requestId: generateUUIDv7(),
          outputText: "Zombie response",
          usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          latencyMs: 100,
          finishReason: "stop",
        },
      })
    ).rejects.toThrow("STALE_WORKER_COMMIT_REJECTED");
  });
});

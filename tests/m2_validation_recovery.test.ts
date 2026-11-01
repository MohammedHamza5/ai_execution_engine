import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrator.js";
import { ExecutionWorker } from "../src/engine/worker.js";
import { executionEngine } from "../src/engine/executionEngine.js";
import { checkpointService } from "../src/engine/checkpointService.js";
import { resourceIntelligence } from "../src/resources/resourceIntelligence.js";
import { GeminiProviderAdapter } from "../src/adapters/geminiAdapter.js";
import { ensureDefaultTenant } from "../src/api/routes/tasks.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";

describe("M2.5 & M2.6 — Validation-Driven Worker Lifecycle & End-to-End Recovery", () => {
  let tenantId: string;
  let adapter: GeminiProviderAdapter;
  let worker: ExecutionWorker;

  beforeAll(async () => {
    await runMigrations();
    tenantId = await ensureDefaultTenant();
    adapter = new GeminiProviderAdapter();
    worker = new ExecutionWorker(generateUUIDv7(), adapter);
  });

  beforeEach(async () => {
    adapter.resetSimulation();
    const baseId = await resourceIntelligence.ensureBaseResource();
    await db.query(`DELETE FROM resources.resources WHERE id != $1;`, [baseId]);
  });

  afterAll(async () => {
    await db.close();
  });

  it("canonical M2 validation recovery: Attempt 1 (Invalid JSON) -> Checkpoint -> Retry Same -> Attempt 2 (Valid JSON) -> COMPLETED", async () => {
    // Sequence: Attempt 1 returns non-JSON text; Attempt 2 returns valid JSON
    adapter.setResponseSequence([
      "Error: Non-JSON raw output that fails schema check",
      JSON.stringify({ status: "success", computationResult: 1234 }),
    ]);

    const taskResult = await executionEngine.createTaskAndPlan({
      tenantId,
      taskType: "code_generation",
      priority: 10,
      inputPayload: {
        prompt: "Generate JSON structure",
        expectJson: true,
      },
    });

    // Worker specifically claims and executes this step execution
    const processed = await worker.claimAndExecuteNext(taskResult.stepExecutionId);
    expect(processed).toBe(true);

    // 1. Verify Task Status is completed
    const taskFinal = await executionEngine.getTask(taskResult.taskId);
    expect(taskFinal?.status).toBe("completed");
    expect(taskFinal?.outputArtifactId).toBeDefined();

    // 2. Verify Attempts in DB: Exactly 2 attempts (Attempt 1 failed, Attempt 2 success)
    const attemptsResult = await db.query(
      `SELECT attempt_number, status, error_id 
       FROM execution.execution_attempts 
       WHERE step_execution_id = $1 
       ORDER BY attempt_number ASC;`,
      [taskResult.stepExecutionId]
    );

    expect(attemptsResult.rows).toHaveLength(2);
    expect(attemptsResult.rows[0].attempt_number).toBe(1);
    expect(attemptsResult.rows[0].status).toBe("failed");
    expect(attemptsResult.rows[0].error_id).toBeDefined(); // Points to execution_errors row

    expect(attemptsResult.rows[1].attempt_number).toBe(2);
    expect(attemptsResult.rows[1].status).toBe("success");

    // 3. Verify Execution Error record created for Attempt 1
    const errorRecord = await db.query(
      `SELECT category, code, message FROM execution.execution_errors WHERE id = $1;`,
      [attemptsResult.rows[0].error_id]
    );
    expect(errorRecord.rows).toHaveLength(1);
    expect(errorRecord.rows[0].category).toBe("VALIDATION_FAILURE");

    // 4. Verify Checkpoints in DB
    const checkpoints = await checkpointService.listCheckpoints(taskResult.executionId);
    expect(checkpoints.length).toBeGreaterThanOrEqual(1);
    const valCheckpoint = checkpoints.find(
      (cp) => cp.snapshotData.validationFailure !== undefined
    );
    expect(valCheckpoint).toBeDefined();
    expect(valCheckpoint?.snapshotData.validationFailure?.recommendedAction).toBe("RETRY_SAME");
    expect(valCheckpoint?.snapshotData.completedArtifactIds).toHaveLength(1);

    // 5. Verify Artifact Lineage: Both Attempt 1 artifact and Attempt 2 artifact exist
    const artifacts = await db.query(
      `SELECT id, inline_content FROM artifacts.artifacts WHERE task_id = $1 ORDER BY created_at ASC;`,
      [taskResult.taskId]
    );
    expect(artifacts.rows).toHaveLength(2);
    expect(artifacts.rows[0].id).not.toBe(artifacts.rows[1].id);
    expect(artifacts.rows[1].id).toBe(taskFinal?.outputArtifactId);

    // 6. Verify Validations: 2 validation runs (1 failed, 1 passed)
    const validations = await db.query(
      `SELECT target_id, status FROM validation.validations WHERE task_id = $1 ORDER BY created_at ASC;`,
      [taskResult.taskId]
    );
    expect(validations.rows).toHaveLength(2);
    expect(validations.rows[0].status).toBe("failed");
    expect(validations.rows[1].status).toBe("passed");
  });

  it("validation migration flow: Persistent schema failure triggers MIGRATE_RESOURCE to alternative model", async () => {
    const resourceAId = await resourceIntelligence.ensureBaseResource();
    await db.query(`UPDATE resources.resources SET priority = 100 WHERE id = $1;`, [resourceAId]);

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

    // Sequence:
    // Attempt 1: Malformed JSON -> RETRY_SAME
    // Attempt 2: Malformed JSON -> MIGRATE_RESOURCE
    // Attempt 3: Valid JSON on migrated resource -> ACCEPT
    adapter.setResponseSequence([
      "Malformed JSON 1",
      "Malformed JSON 2",
      JSON.stringify({ migrated: true, answer: "Validated successfully on alternative model" }),
    ]);

    const taskResult = await executionEngine.createTaskAndPlan({
      tenantId,
      taskType: "code_generation",
      priority: 9,
      inputPayload: {
        prompt: "Generate complex schema",
        expectJson: true,
      },
    });

    const processed = await worker.claimAndExecuteNext(taskResult.stepExecutionId);
    expect(processed).toBe(true);

    const taskFinal = await executionEngine.getTask(taskResult.taskId);
    expect(taskFinal?.status).toBe("completed");

    // Verify 3 attempts were performed
    const attempts = await db.query(
      `SELECT attempt_number, resource_id, status FROM execution.execution_attempts 
       WHERE step_execution_id = $1 ORDER BY attempt_number ASC;`,
      [taskResult.stepExecutionId]
    );

    expect(attempts.rows).toHaveLength(3);
    expect(attempts.rows[0].status).toBe("failed");
    expect(attempts.rows[1].status).toBe("failed");
    expect(attempts.rows[2].status).toBe("success");
    // Attempt 3 used the migrated resource
    expect(attempts.rows[2].resource_id).toBe(resourceBId);

    // Verify RESOURCE_MIGRATED outbox event exists
    const outboxMigration = await db.query(
      `SELECT event_type, payload FROM system.outbox_events 
       WHERE aggregate_id::text = $1 AND event_type = 'RESOURCE_MIGRATED';`,
      [taskResult.stepExecutionId]
    );
    expect(outboxMigration.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("fails task deterministically when validation failures exhaust max attempts", async () => {
    // All attempts fail with malformed output
    adapter.setResponseSequence([
      "Always invalid 1",
      "Always invalid 2",
      "Always invalid 3",
      "Always invalid 4",
    ]);

    const taskResult = await executionEngine.createTaskAndPlan({
      tenantId,
      taskType: "strict_format",
      inputPayload: {
        prompt: "Format required",
        expectJson: true,
      },
    });

    const processed = await worker.claimAndExecuteNext(taskResult.stepExecutionId);
    expect(processed).toBe(false);

    // Task and Step must be failed
    const taskFinal = await executionEngine.getTask(taskResult.taskId);
    expect(taskFinal?.status).toBe("failed");

    const stepResult = await db.query(
      `SELECT status FROM execution.step_executions WHERE id = $1;`,
      [taskResult.stepExecutionId]
    );
    expect(stepResult.rows[0].status).toBe("failed");
  });
});

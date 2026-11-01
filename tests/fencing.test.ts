import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrator.js";
import { executionEngine } from "../src/engine/executionEngine.js";
import { ensureDefaultTenant } from "../src/api/routes/tasks.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";

describe("Monotonic Fencing Token Tests (Anti-Zombie Worker Protection)", () => {
  let tenantId: string;

  beforeAll(async () => {
    await runMigrations();
    tenantId = await ensureDefaultTenant();
  });

  afterAll(async () => {
    await db.close();
  });

  it("stale fencing token cannot commit; newer worker wins (ADR-039 / ADR-082)", async () => {
    const taskResult = await executionEngine.createTaskAndPlan({
      tenantId,
      taskType: "fencing_verification",
      inputPayload: { prompt: "Test zombie worker fencing" },
    });

    const stepId = taskResult.stepExecutionId;
    const attempt1Id = generateUUIDv7();
    const attempt2Id = generateUUIDv7();
    const worker1Id = generateUUIDv7();
    const worker2Id = generateUUIDv7();

    // 1. Worker 1 claims the step -> fencing_token becomes 1
    await db.query(
      `UPDATE execution.step_executions 
       SET status = 'running', fencing_token = 1, worker_id = $2
       WHERE id = $1;`,
      [stepId, worker1Id]
    );

    await db.query(
      `INSERT INTO execution.execution_attempts (id, step_execution_id, attempt_number, status)
       VALUES ($1, $2, 1, 'running');`,
      [attempt1Id, stepId]
    );

    // 2. Worker 1 freezes. Lease expires. Worker 2 claims the step -> fencing_token becomes 2
    await db.query(
      `UPDATE execution.step_executions 
       SET status = 'running', fencing_token = 2, worker_id = $2
       WHERE id = $1;`,
      [stepId, worker2Id]
    );

    await db.query(
      `INSERT INTO execution.execution_attempts (id, step_execution_id, attempt_number, status)
       VALUES ($1, $2, 2, 'running');`,
      [attempt2Id, stepId]
    );

    // 3. Worker 1 wakes up and attempts to commit with STALE fencing_token = 1
    const staleResponse = {
      requestId: generateUUIDv7(),
      outputText: "Stale result from frozen Worker 1",
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
      latencyMs: 500,
      finishReason: "stop" as const,
    };

    // Assert that Worker 1 is rejected by the monotonic fencing barrier!
    await expect(
      executionEngine.commitAttemptSuccess({
        stepExecutionId: stepId,
        executionId: taskResult.planId, // Note: executionId from plan
        taskId: taskResult.taskId,
        tenantId,
        attemptId: attempt1Id,
        fencingToken: 1, // STALE!
        response: staleResponse,
      })
    ).rejects.toThrow(/STALE_WORKER_COMMIT_REJECTED/);

    // 4. Worker 2 commits with VALID fencing_token = 2
    const validResponse = {
      requestId: generateUUIDv7(),
      outputText: "Valid result from active Worker 2",
      usage: { inputTokens: 15, outputTokens: 15, totalTokens: 30 },
      latencyMs: 300,
      finishReason: "stop" as const,
    };

    // Retrieve active executionId from DB
    const execRow = await db.query(
      "SELECT execution_id FROM execution.step_executions WHERE id = $1;",
      [stepId]
    );
    const executionId = execRow.rows[0].execution_id;

    const commitResult = await executionEngine.commitAttemptSuccess({
      stepExecutionId: stepId,
      executionId,
      taskId: taskResult.taskId,
      tenantId,
      attemptId: attempt2Id,
      fencingToken: 2, // VALID!
      response: validResponse,
    });

    expect(commitResult.validationPassed).toBe(true);

    // Assert that the database reflects Worker 2's commit and the task is COMPLETED
    const finalStep = await db.query(
      "SELECT * FROM execution.step_executions WHERE id = $1;",
      [stepId]
    );
    expect(finalStep.rows[0].status).toBe("completed");

    const finalTask = await executionEngine.getTask(taskResult.taskId);
    expect(finalTask?.status).toBe("completed");
  });
});

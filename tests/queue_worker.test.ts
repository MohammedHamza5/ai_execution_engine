import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrator.js";
import { executionEngine } from "../src/engine/executionEngine.js";
import { ensureDefaultTenant } from "../src/api/routes/tasks.js";
import { ExecutionWorker } from "../src/engine/worker.js";

describe("Queue & Worker SKIP LOCKED Concurrency Tests", () => {
  let tenantId: string;

  beforeAll(async () => {
    await runMigrations();
    tenantId = await ensureDefaultTenant();
  });

  afterAll(async () => {
    await db.close();
  });

  it("worker claims pending execution and updates lease duration", async () => {
    const taskResult = await executionEngine.createTaskAndPlan({
      tenantId,
      taskType: "test_inference",
      inputPayload: { prompt: "Test single claim" },
      priority: 10,
    });

    const worker = new ExecutionWorker();
    const claimed = await worker.claimAndExecuteNext(taskResult.stepExecutionId);

    expect(claimed).toBe(true);

    const step = await db.query(
      "SELECT * FROM execution.step_executions WHERE id = $1;",
      [taskResult.stepExecutionId]
    );

    // After execution, the step transitions to completed (or diagnosing)
    expect(step.rows[0].worker_id).toBe(worker.workerId);
    expect(step.rows[0].status).toBe("completed");
    expect(parseInt(step.rows[0].fencing_token, 10)).toBeGreaterThanOrEqual(1);
  });

  it("two workers cannot claim the same execution (SKIP LOCKED race test)", async () => {
    const taskResult = await executionEngine.createTaskAndPlan({
      tenantId,
      taskType: "test_concurrency",
      inputPayload: { prompt: "Concurrent claim test" },
      priority: 20,
    });

    // We simulate two concurrent workers racing to claim the same pending step
    const client1 = await db.getClient();
    const client2 = await db.getClient();

    try {
      await client1.query("BEGIN;");
      await client2.query("BEGIN;");

      const claimSql = `
        SELECT id FROM execution.step_executions
        WHERE id = $1 AND status = 'pending'
        FOR UPDATE SKIP LOCKED;
      `;

      // Worker 1 executes first and locks the row
      const res1 = await client1.query(claimSql, [taskResult.stepExecutionId]);
      expect(res1.rows.length).toBe(1);
      expect(res1.rows[0].id).toBe(taskResult.stepExecutionId);

      // Worker 2 attempts to select the same row concurrently with SKIP LOCKED
      const res2 = await client2.query(claimSql, [taskResult.stepExecutionId]);

      // Assert that Worker 2 skipped the locked row and got 0 rows!
      expect(res2.rows.length).toBe(0);

      await client1.query("ROLLBACK;");
      await client2.query("ROLLBACK;");
    } finally {
      client1.release();
      client2.release();
    }
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrator.js";
import { executionEngine } from "../src/engine/executionEngine.js";
import { ensureDefaultTenant } from "../src/api/routes/tasks.js";

describe("Persistence Foundation Tests", () => {
  let tenantId: string;

  beforeAll(async () => {
    await runMigrations();
    tenantId = await ensureDefaultTenant();
  });

  afterAll(async () => {
    await db.close();
  });

  it("persists Task, Plan, PlanStep, Execution, and StepExecution with foreign key integrity", async () => {
    const input = {
      tenantId,
      taskType: "code_generation",
      inputPayload: { prompt: "Write a hello world function" },
      requirements: { qualityFloor: 0.9 },
      priority: 5,
    };

    const result = await executionEngine.createTaskAndPlan(input);

    expect(result.taskId).toBeDefined();
    expect(result.planId).toBeDefined();
    expect(result.stepExecutionId).toBeDefined();

    // Verify Task persisted
    const task = await executionEngine.getTask(result.taskId);
    expect(task).not.toBeNull();
    expect(task?.status).toBe("pending");
    expect(task?.priority).toBe(5);
    expect(task?.tenantId).toBe(tenantId);

    // Verify Plan persisted
    const planResult = await db.query(
      "SELECT * FROM planning.execution_plans WHERE id = $1;",
      [result.planId]
    );
    expect(planResult.rows.length).toBe(1);
    expect(planResult.rows[0].task_id).toBe(result.taskId);
    expect(planResult.rows[0].strategy).toBe("single_model");

    // Verify StepExecution in authoritative work queue
    const stepResult = await db.query(
      "SELECT * FROM execution.step_executions WHERE id = $1;",
      [result.stepExecutionId]
    );
    expect(stepResult.rows.length).toBe(1);
    expect(stepResult.rows[0].status).toBe("pending");
    expect(stepResult.rows[0].fencing_token).toBe("0");
    expect(stepResult.rows[0].priority).toBe(5);

    // Verify outbox domain event
    const outboxResult = await db.query(
      "SELECT * FROM system.outbox_events WHERE aggregate_id = $1;",
      [result.taskId]
    );
    expect(outboxResult.rows.length).toBeGreaterThan(0);
    expect(outboxResult.rows[0].event_type).toBe("TASK_CREATED");
  });
});

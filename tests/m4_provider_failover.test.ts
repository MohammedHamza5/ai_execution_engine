import { describe, it, expect, beforeEach } from "vitest";
import { GeminiProviderAdapter } from "../src/adapters/geminiAdapter.js";
import { ProviderErrorCode } from "../src/adapters/types.js";
import { ExecutionWorker } from "../src/engine/worker.js";
import { resourceIntelligence } from "../src/resources/resourceIntelligence.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";
import { db } from "../src/db/client.js";

describe("Milestone M4.20 — Live Cross-Provider Failover & Migration", () => {
  beforeEach(async () => {
    await resourceIntelligence.ensureLiveProviders();
  });

  it("should fail on Gemini and migrate dynamically to Groq", async () => {
    const tenantId = generateUUIDv7();
    const taskId = generateUUIDv7();
    const executionId = generateUUIDv7();
    const planId = generateUUIDv7();
    const planStepId = generateUUIDv7();
    const stepExecutionId = generateUUIDv7();
    const geminiResourceId = "01924b00-0000-7000-8000-000000000004";

    await db.query(
      `INSERT INTO identity.tenants (id, name, slug)
       VALUES ($1, 'Tenant', $2) ON CONFLICT DO NOTHING;`,
      [tenantId, `tenant-${tenantId}`]
    );
    await db.query(
      `INSERT INTO tasks.tasks (id, tenant_id, task_type, input_payload, status, policy)
       VALUES ($1, $2, 'text_generation', '{"prompt": "Failover prompt"}', 'running', '{}');`,
      [taskId, tenantId]
    );
    await db.query(
      `INSERT INTO planning.execution_plans (id, task_id, strategy) VALUES ($1, $2, 'single_model');`,
      [planId, taskId]
    );
    await db.query(
      `INSERT INTO execution.executions (id, task_id, plan_id) VALUES ($1, $2, $3);`,
      [executionId, taskId, planId]
    );
    await db.query(
      `INSERT INTO planning.plan_steps (id, plan_id, step_key, name, step_type, order_index)
       VALUES ($1, $2, 'step_1', 'Step 1', 'model_inference', 1);`,
      [planStepId, planId]
    );
    await db.query(
      `INSERT INTO execution.step_executions (
         id, execution_id, plan_step_id, task_id, resource_id, status, priority, available_at
       ) VALUES ($1, $2, $3, $4, $5, 'pending', 10, now());`,
      [stepExecutionId, executionId, planStepId, taskId, geminiResourceId]
    );

    // Inject fault into Gemini adapter
    const geminiMock = new GeminiProviderAdapter();
    geminiMock.setFaultSequence([ProviderErrorCode.QUOTA_EXHAUSTED]);

    const worker = new ExecutionWorker(generateUUIDv7(), geminiMock);
    const executed = await worker.claimAndExecuteNext(stepExecutionId);
    expect(executed).toBe(true);

    // Verify step execution migrated and completed
    const stepCheck = await db.query(
      `SELECT status, resource_id, output_tokens FROM execution.step_executions WHERE id = $1;`,
      [stepExecutionId]
    );
    expect(stepCheck.rows[0].status).toBe("completed");
    expect(stepCheck.rows[0].resource_id).not.toBe(geminiResourceId);

    // Verify attempts audit: attempt 1 failed, attempt 2 succeeded
    const attempts = await db.query(
      `SELECT attempt_number, status FROM execution.execution_attempts
       WHERE step_execution_id = $1 ORDER BY attempt_number ASC;`,
      [stepExecutionId]
    );
    expect(attempts.rows.length).toBe(2);
    expect(attempts.rows[0].status).toBe("failed");
    expect(attempts.rows[1].status).toBe("success");

    // Verify output artifact exists
    const artifactCheck = await db.query(
      `SELECT inline_content FROM artifacts.artifacts WHERE task_id = $1;`,
      [taskId]
    );
    expect(artifactCheck.rows.length).toBeGreaterThan(0);
    expect(typeof artifactCheck.rows[0].inline_content).toBe("string");
    expect(artifactCheck.rows[0].inline_content.length).toBeGreaterThan(0);
  });
});

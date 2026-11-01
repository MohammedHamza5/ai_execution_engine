import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../src/db/client.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";
import { DAGWorkerBridge } from "../src/engine/dagWorkerBridge.js";
import { ExecutionWorker } from "../src/engine/worker.js";
import { executionEngine } from "../src/engine/executionEngine.js";
import { dagService } from "../src/engine/dagService.js";

describe("Milestone M6.12 — Runtime Wiring & Harmonization", () => {
  let tenantId: string;

  beforeAll(async () => {
    tenantId = generateUUIDv7();
    await db.query(
      `INSERT INTO identity.tenants (id, name, slug) VALUES ($1, 'M6 Harmonization Tenant', $2);`,
      [tenantId, `m6-harm-${tenantId}`]
    );
  });

  afterAll(async () => {
    DAGWorkerBridge.stopLeaseReaper(true);
    await db.query(`DELETE FROM tasks.tasks WHERE tenant_id = $1;`, [tenantId]);
    await db.query(`DELETE FROM identity.tenants WHERE id = $1;`, [tenantId]);
  });

  it("G-01: ExecutionWorker and DAGWorkerBridge batch-claim ready DAG steps concurrently", async () => {
    const dagResult = await dagService.createDAGTask({
      tenantId,
      taskType: "dag",
      steps: [
        { stepKey: "stepA", name: "A", dependencies: [], inputPayload: { prompt: "Run A" } },
        { stepKey: "stepB", name: "B", dependencies: [], inputPayload: { prompt: "Run B" } },
      ],
    });

    const dispatchResult = await ExecutionWorker.dispatchDAGBatch(dagResult.executionId, 5);
    expect(dispatchResult.dispatchedStepExecutionIds).toHaveLength(2);
    expect(dispatchResult.inFlightCount).toBe(2);
  });

  it("G-02: DAGWorkerBridge.handleFailure reschedules transient errors and cascades terminal failure", async () => {
    const dagResult = await dagService.createDAGTask({
      tenantId,
      taskType: "dag",
      steps: [
        { stepKey: "upstream", name: "Upstream", dependencies: [], inputPayload: { prompt: "Upstream" } },
        { stepKey: "downstream", name: "Downstream", dependencies: ["upstream"], inputPayload: { prompt: "Downstream" } },
      ],
    });

    const steps = await db.query(
      `SELECT se.id, p.step_key FROM execution.step_executions se
       JOIN planning.plan_steps p ON se.plan_step_id = p.id
       WHERE se.execution_id = $1;`,
      [dagResult.executionId]
    );
    const upstream = steps.rows.find((r) => r.step_key === "upstream")!;
    const downstream = steps.rows.find((r) => r.step_key === "downstream")!;

    // Transient failure with retry
    await db.transaction(async (client) => {
      const decision = await DAGWorkerBridge.handleFailure(client, {
        stepExecutionId: upstream.id,
        executionId: dagResult.executionId,
        attemptNumber: 1,
        failureReason: "Network timeout",
      });
      expect(decision.shouldRetry).toBe(true);
      expect(decision.action).toBe("RETRY");
    });

    // Terminal failure exhausts retries and cascades to downstream
    await db.transaction(async (client) => {
      const decision = await DAGWorkerBridge.handleFailure(client, {
        stepExecutionId: upstream.id,
        executionId: dagResult.executionId,
        attemptNumber: 3,
        failureReason: "Permanent Crash",
      });
      expect(decision.shouldRetry).toBe(false);
      expect(decision.action).toBe("FAIL_TERMINAL");
    });

    const downstreamRes = await db.query(`SELECT status FROM execution.step_executions WHERE id = $1;`, [downstream.id]);
    expect(downstreamRes.rows[0].status).toBe("failed");

    const outbox = await db.query(
      `SELECT event_type FROM system.outbox_events WHERE aggregate_id = $1 AND event_type = 'STEP_CASCADED_FAILURE';`,
      [downstream.id]
    );
    expect(outbox.rows.length).toBeGreaterThan(0);
  });

  it("G-03: executionEngine.commitAttemptSuccess records DAGValidationBarrier for DAG tasks", async () => {
    const dagResult = await dagService.createDAGTask({
      tenantId,
      taskType: "dag",
      steps: [{ stepKey: "barrierStep", name: "Step", dependencies: [], inputPayload: { prompt: "Return JSON" } }],
    });

    const stepRes = await db.query(
      `SELECT id, fencing_token FROM execution.step_executions WHERE execution_id = $1;`,
      [dagResult.executionId]
    );
    const step = stepRes.rows[0];

    const response = {
      outputText: "NOT VALID JSON",
      rawOutput: "NOT VALID JSON",
      usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
      latencyMs: 15,
    };

    await executionEngine.commitAttemptSuccess({
      stepExecutionId: step.id,
      executionId: dagResult.executionId,
      taskId: dagResult.taskId,
      tenantId,
      attemptId: generateUUIDv7(),
      fencingToken: parseInt(step.fencing_token, 10),
      response,
      expectedOutputJson: true,
    });

    const barrierValidations = await db.query(
      `SELECT * FROM validation.validations WHERE step_execution_id = $1 AND validator_type = 'dag_barrier';`,
      [step.id]
    );
    expect(barrierValidations.rows.length).toBe(1);
    expect(barrierValidations.rows[0].status).toBe("failed");

    const quarantinedEvents = await db.query(
      `SELECT * FROM system.outbox_events WHERE aggregate_id = $1 AND event_type = 'STEP_VALIDATION_QUARANTINED';`,
      [step.id]
    );
    expect(quarantinedEvents.rows.length).toBe(1);
  });

  it("G-04: DAGWorkerBridge starts, runs, and stops proactive lease reaper daemon", async () => {
    expect(DAGWorkerBridge.isReaperRunning()).toBe(false);

    ExecutionWorker.startLeaseReaper(100);
    expect(DAGWorkerBridge.isReaperRunning()).toBe(true);

    ExecutionWorker.stopLeaseReaper(true);
    expect(DAGWorkerBridge.isReaperRunning()).toBe(false);
  });
});

import { describe, it, expect, beforeAll } from "vitest";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrator.js";
import { executionEngine } from "../src/engine/executionEngine.js";
import { DAGParallelExecutor } from "../src/engine/dagParallelExecutor.js";
import { DAGRetryScheduler } from "../src/engine/dagRetryScheduler.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";

describe("Milestone M6 Batch C — Parallel Execution & Retry Pipeline (M6.4 & M6.5)", () => {
  let tenantId: string;

  beforeAll(async () => {
    await runMigrations();
    tenantId = generateUUIDv7();
    await db.query(
      `INSERT INTO identity.tenants (id, name, slug) VALUES ($1, $2, $3);`,
      [tenantId, "M6 Batch C Tenant", `m6-batch-c-tenant-${tenantId}`]
    );
  });

  describe("M6.4: DAGParallelExecutor", () => {
    it("enforces concurrency limits and applies backpressure when slots are exhausted", async () => {
      // 4 independent root steps
      const dag = await executionEngine.createDAGTask({
        tenantId,
        taskType: "parallel_concurrency_test",
        steps: [
          { stepKey: "p1", name: "P1", dependencies: [] },
          { stepKey: "p2", name: "P2", dependencies: [] },
          { stepKey: "p3", name: "P3", dependencies: [] },
          { stepKey: "p4", name: "P4", dependencies: [] },
        ],
      });

      // Dispatch with maxConcurrency = 2
      const firstDispatch = await db.transaction(async (client) => {
        return DAGParallelExecutor.dispatchReadySteps(client, {
          executionId: dag.executionId,
          maxConcurrency: 2,
        });
      });

      expect(firstDispatch.dispatchedStepExecutionIds).toHaveLength(2);
      expect(firstDispatch.inFlightCount).toBe(2);
      expect(firstDispatch.backpressureApplied).toBe(true);
      expect(firstDispatch.availableSlots).toBe(0);

      // Attempt second dispatch while slots are full: must dispatch 0
      const blockedDispatch = await db.transaction(async (client) => {
        return DAGParallelExecutor.dispatchReadySteps(client, {
          executionId: dag.executionId,
          maxConcurrency: 2,
        });
      });
      expect(blockedDispatch.dispatchedStepExecutionIds).toHaveLength(0);
      expect(blockedDispatch.inFlightCount).toBe(2);
      expect(blockedDispatch.backpressureApplied).toBe(true);

      // Complete 1 dispatched step: frees 1 slot
      const completedStepId = firstDispatch.dispatchedStepExecutionIds[0];
      await db.query(`UPDATE execution.step_executions SET status = 'completed' WHERE id = $1;`, [completedStepId]);

      // Third dispatch should now claim exactly 1 step
      const thirdDispatch = await db.transaction(async (client) => {
        return DAGParallelExecutor.dispatchReadySteps(client, {
          executionId: dag.executionId,
          maxConcurrency: 2,
        });
      });
      expect(thirdDispatch.dispatchedStepExecutionIds).toHaveLength(1);
      expect(thirdDispatch.inFlightCount).toBe(2);
    });
  });

  describe("M6.5: DAGRetryScheduler", () => {
    it("computes exponential backoff and enforces max attempt boundaries", () => {
      const p1 = DAGRetryScheduler.evaluateRetry({
        attemptNumber: 1,
        retryPolicy: { maxAttempts: 3, backoffMs: 1000 },
      });
      expect(p1.shouldRetry).toBe(true);
      expect(p1.backoffMs).toBe(1000);
      expect(p1.action).toBe("RETRY");

      const p2 = DAGRetryScheduler.evaluateRetry({
        attemptNumber: 2,
        retryPolicy: { maxAttempts: 3, backoffMs: 1000 },
      });
      expect(p2.shouldRetry).toBe(true);
      expect(p2.backoffMs).toBe(2000);

      const p3 = DAGRetryScheduler.evaluateRetry({
        attemptNumber: 3,
        retryPolicy: { maxAttempts: 3, backoffMs: 1000 },
      });
      expect(p3.shouldRetry).toBe(false);
      expect(p3.action).toBe("FAIL_TERMINAL");
      expect(p3.reason).toContain("MAX_ATTEMPTS_EXCEEDED");
    });

    it("rejects retry immediately for permanent unrecoverable errors", () => {
      const permanent = DAGRetryScheduler.evaluateRetry({
        attemptNumber: 1,
        isPermanent: true,
      });
      expect(permanent.shouldRetry).toBe(false);
      expect(permanent.action).toBe("FAIL_TERMINAL");
      expect(permanent.reason).toBe("NON_RETRYABLE_PERMANENT_ERROR");
    });

    it("reschedules transient failed step to pending with backoff and clears lease", async () => {
      const dag = await executionEngine.createDAGTask({
        tenantId,
        taskType: "retry_reschedule_test",
        steps: [{ stepKey: "flaky_step", name: "Flaky", dependencies: [] }],
      });
      const stepId = dag.steps[0].stepExecutionId;

      // Mark running
      await db.query(
        `UPDATE execution.step_executions 
         SET status = 'running', worker_id = gen_random_uuid(), lease_token = 'token-1' 
         WHERE id = $1;`,
        [stepId]
      );

      const decision = await db.transaction(async (client) => {
        return DAGRetryScheduler.handleStepFailure(client, {
          stepExecutionId: stepId,
          executionId: dag.executionId,
          attemptNumber: 1,
          retryPolicy: { maxAttempts: 3, backoffMs: 500 },
          failureReason: "Network 503 Service Unavailable",
        });
      });

      expect(decision.shouldRetry).toBe(true);

      const updated = await db.query(
        `SELECT status, worker_id, lease_token FROM execution.step_executions WHERE id = $1;`,
        [stepId]
      );
      expect(updated.rows[0].status).toBe("pending");
      expect(updated.rows[0].worker_id).toBeNull();
      expect(updated.rows[0].lease_token).toBeNull();

      const outbox = await db.query(
        `SELECT event_type FROM system.outbox_events WHERE aggregate_id = $1 AND event_type = 'STEP_RETRY_SCHEDULED';`,
        [stepId]
      );
      expect(outbox.rows).toHaveLength(1);
    });

    it("marks terminal failure and cascades failure when retries exhausted", async () => {
      const dag = await executionEngine.createDAGTask({
        tenantId,
        taskType: "retry_exhaustion_test",
        steps: [
          { stepKey: "parent", name: "Parent", dependencies: [] },
          { stepKey: "child", name: "Child", dependencies: ["parent"] },
        ],
      });
      const parentId = dag.steps.find((s) => s.stepKey === "parent")!.stepExecutionId;
      const childId = dag.steps.find((s) => s.stepKey === "child")!.stepExecutionId;

      // Fail parent on final attempt 3
      const decision = await db.transaction(async (client) => {
        return DAGRetryScheduler.handleStepFailure(client, {
          stepExecutionId: parentId,
          executionId: dag.executionId,
          attemptNumber: 3,
          retryPolicy: { maxAttempts: 3 },
          failureReason: "Deterministic Syntax Error",
        });
      });

      expect(decision.shouldRetry).toBe(false);
      expect(decision.action).toBe("FAIL_TERMINAL");

      const postParent = await db.query(`SELECT status FROM execution.step_executions WHERE id = $1;`, [parentId]);
      const postChild = await db.query(`SELECT status FROM execution.step_executions WHERE id = $1;`, [childId]);
      expect(postParent.rows[0].status).toBe("failed");
      expect(postChild.rows[0].status).toBe("failed");
    });
  });
});

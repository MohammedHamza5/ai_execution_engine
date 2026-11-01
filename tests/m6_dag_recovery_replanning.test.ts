import { describe, it, expect, beforeAll } from "vitest";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrator.js";
import { executionEngine } from "../src/engine/executionEngine.js";
import { DAGRecoveryManager } from "../src/engine/dagRecoveryManager.js";
import { DAGReplanner } from "../src/engine/dagReplanner.js";
import { DAGStateMachine } from "../src/engine/dagStateMachine.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";

describe("Milestone M6 Batch E — Recovery Manager & Controlled Replanner (M6.8 & M6.9)", () => {
  let tenantId: string;

  beforeAll(async () => {
    await runMigrations();
    tenantId = generateUUIDv7();
    await db.query(
      `INSERT INTO identity.tenants (id, name, slug) VALUES ($1, $2, $3);`,
      [tenantId, "M6 Batch E Tenant", `m6-batch-e-tenant-${tenantId}`]
    );
  });

  describe("M6.8: DAGRecoveryManager", () => {
    it("reaps expired zombie worker leases and increments fencing tokens", async () => {
      const dag = await executionEngine.createDAGTask({
        tenantId,
        taskType: "zombie_reap_test",
        steps: [{ stepKey: "zombie_step", name: "Zombie", dependencies: [] }],
      });
      const stepId = dag.steps[0].stepExecutionId;
      const initialFencing = 0;

      // Simulate worker crash: lease expired 1 minute ago
      await db.query(
        `UPDATE execution.step_executions
         SET status = 'running',
             worker_id = gen_random_uuid(),
             lease_token = 'expired-token',
             lease_expires_at = now() - interval '60 seconds',
             fencing_token = $1
         WHERE id = $2;`,
        [initialFencing, stepId]
      );

      const reaped = await db.transaction(async (client) => {
        return DAGRecoveryManager.reapExpiredLeases(client, { executionId: dag.executionId });
      });

      expect(reaped).toHaveLength(1);
      expect(reaped[0].stepExecutionId).toBe(stepId);
      expect(reaped[0].newFencingToken).toBe(initialFencing + 1);

      const updated = await db.query(
        `SELECT status, worker_id, lease_token, fencing_token FROM execution.step_executions WHERE id = $1;`,
        [stepId]
      );
      expect(updated.rows[0].status).toBe("pending");
      expect(updated.rows[0].worker_id).toBeNull();
      expect(updated.rows[0].lease_token).toBeNull();
      expect(parseInt(updated.rows[0].fencing_token, 10)).toBe(initialFencing + 1);

      // Verify zombie worker's late transition is rejected by fencing token check
      await expect(
        db.transaction(async (client) => {
          await DAGStateMachine.transitionStep(client, {
            stepExecutionId: stepId,
            targetStatus: "completed",
            fencingToken: initialFencing, // Zombie old token
          });
        })
      ).rejects.toThrowError("FENCING_TOKEN_MISMATCH");
    });
  });

  describe("M6.9: DAGReplanner", () => {
    it("accurately identifies affected subgraphs while preserving independent branches", async () => {
      // Diamond: start -> (left, right) -> join
      const dag = await executionEngine.createDAGTask({
        tenantId,
        taskType: "subgraph_analysis_test",
        steps: [
          { stepKey: "start", name: "Start", dependencies: [] },
          { stepKey: "left", name: "Left", dependencies: ["start"] },
          { stepKey: "right", name: "Right", dependencies: ["start"] },
          { stepKey: "join", name: "Join", dependencies: ["left", "right"] },
        ],
      });

      await db.transaction(async (client) => {
        const affected = await DAGReplanner.identifyAffectedSubgraph(client, dag.executionId, "left");
        expect(affected).toContain("left");
        expect(affected).toContain("join");
        expect(affected).not.toContain("right");
        expect(affected).not.toContain("start");
      });
    });

    it("executes controlled subgraph replanning with incremented plan version", async () => {
      const dag = await executionEngine.createDAGTask({
        tenantId,
        taskType: "replan_execution_test",
        steps: [
          { stepKey: "fetch_data", name: "Fetch", dependencies: [] },
          { stepKey: "failing_step", name: "Fail", dependencies: ["fetch_data"] },
        ],
      });

      const res = await db.transaction(async (client) => {
        return DAGReplanner.replanSubgraph(client, {
          executionId: dag.executionId,
          taskId: dag.taskId,
          tenantId,
          failedStepKey: "failing_step",
          replacementNodes: [
            { stepKey: "alt_fetch", name: "Alt Fetch", stepType: "model_inference", dependencies: [] },
            { stepKey: "alt_process", name: "Alt Process", stepType: "transformation", dependencies: ["alt_fetch"] },
          ],
          reason: "Model Endpoint Deprecated",
        });
      });

      expect(res.newPlanVersion).toBe(2);
      expect(res.replacedStepKeys).toContain("failing_step");
      expect(res.newStepExecutionIds).toHaveLength(2);

      const planCheck = await db.query(
        `SELECT p.version FROM execution.executions e JOIN planning.execution_plans p ON e.plan_id = p.id WHERE e.id = $1;`,
        [dag.executionId]
      );
      expect(planCheck.rows[0].version).toBe(2);
    });

    it("prevents infinite replanning loops when MAX_REPLANNING_CYCLES is reached", async () => {
      const dag = await executionEngine.createDAGTask({
        tenantId,
        taskType: "loop_prevention_test",
        steps: [{ stepKey: "loop_step", name: "Loop", dependencies: [] }],
      });

      // Execute 3 replanning cycles (limit = 3)
      for (let i = 0; i < 3; i++) {
        await db.transaction(async (client) => {
          await DAGReplanner.replanSubgraph(client, {
            executionId: dag.executionId,
            taskId: dag.taskId,
            tenantId,
            failedStepKey: "loop_step",
            replacementNodes: [{ stepKey: `rep_${i}`, name: `R${i}`, stepType: "model_inference", dependencies: [] }],
            reason: `Attempt ${i + 1}`,
          });
        });
      }

      // 4th replanning must be rejected
      await expect(
        db.transaction(async (client) => {
          await DAGReplanner.replanSubgraph(client, {
            executionId: dag.executionId,
            taskId: dag.taskId,
            tenantId,
            failedStepKey: "loop_step",
            replacementNodes: [{ stepKey: "rep_4", name: "R4", stepType: "model_inference", dependencies: [] }],
            reason: "Exceeding limit",
          });
        })
      ).rejects.toThrowError("REPLANNING_LIMIT_EXCEEDED");
    });
  });
});

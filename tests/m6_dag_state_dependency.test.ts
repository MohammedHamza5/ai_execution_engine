import { describe, it, expect, beforeAll } from "vitest";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrator.js";
import { executionEngine } from "../src/engine/executionEngine.js";
import { DAGStateMachine } from "../src/engine/dagStateMachine.js";
import { DAGDependencyResolver } from "../src/engine/dagDependencyResolver.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";

describe("Milestone M6 Batch B — State Machine & Dependency Resolver (M6.2 & M6.3)", () => {
  let tenantId: string;

  beforeAll(async () => {
    await runMigrations();
    tenantId = generateUUIDv7();
    await db.query(
      `INSERT INTO identity.tenants (id, name, slug) VALUES ($1, $2, $3);`,
      [tenantId, "M6 Test Tenant", `m6-tenant-${tenantId}`]
    );
  });

  describe("M6.2: DAGStateMachine", () => {
    it("strictly enforces valid and invalid transition boundaries", () => {
      expect(DAGStateMachine.canTransition("blocked", "pending")).toBe(true);
      expect(DAGStateMachine.canTransition("pending", "running")).toBe(true);
      expect(DAGStateMachine.canTransition("running", "completed")).toBe(true);
      expect(DAGStateMachine.canTransition("running", "pending")).toBe(true);
      expect(DAGStateMachine.canTransition("running", "failed")).toBe(true);
      expect(DAGStateMachine.canTransition("blocked", "running")).toBe(false);
      expect(DAGStateMachine.canTransition("completed", "pending")).toBe(false);
      expect(DAGStateMachine.canTransition("failed", "completed")).toBe(false);
      expect(() => DAGStateMachine.assertTransition("blocked", "running")).toThrowError("INVALID_DAG_STATE_TRANSITION");
    });

    it("executes atomic DB status transition and emits outbox events", async () => {
      const dag = await executionEngine.createDAGTask({
        tenantId,
        taskType: "fsm_test",
        steps: [{ stepKey: "s1", name: "S1", dependencies: [] }],
      });
      const stepId = dag.steps[0].stepExecutionId;

      await db.transaction(async (client) => {
        const ok = await DAGStateMachine.transitionStep(client, {
          stepExecutionId: stepId,
          expectedStatus: "pending",
          targetStatus: "running",
          fencingToken: 0,
        });
        expect(ok).toBe(true);
      });

      const updated = await db.query(`SELECT status FROM execution.step_executions WHERE id = $1;`, [stepId]);
      expect(updated.rows[0].status).toBe("running");

      const outbox = await db.query(`SELECT event_type FROM system.outbox_events WHERE aggregate_id = $1;`, [stepId]);
      expect(outbox.rows.some((r) => r.event_type === "STEP_STATUS_TRANSITIONED")).toBe(true);
    });

    it("rejects transition on fencing token mismatch", async () => {
      const dag = await executionEngine.createDAGTask({
        tenantId,
        taskType: "fsm_fencing_test",
        steps: [{ stepKey: "s1", name: "S1", dependencies: [] }],
      });
      const stepId = dag.steps[0].stepExecutionId;

      await expect(
        db.transaction(async (client) => {
          await DAGStateMachine.transitionStep(client, {
            stepExecutionId: stepId,
            targetStatus: "running",
            fencingToken: 999, // Wrong token
          });
        })
      ).rejects.toThrowError("FENCING_TOKEN_MISMATCH");
    });

    it("cascades failure to all direct and indirect downstream steps", async () => {
      const dag = await executionEngine.createDAGTask({
        tenantId,
        taskType: "fsm_cascade_test",
        steps: [
          { stepKey: "a", name: "A", dependencies: [] },
          { stepKey: "b", name: "B", dependencies: ["a"] },
          { stepKey: "c", name: "C", dependencies: ["b"] },
        ],
      });
      const stepA = dag.steps.find((s) => s.stepKey === "a")!.stepExecutionId;
      const stepB = dag.steps.find((s) => s.stepKey === "b")!.stepExecutionId;
      const stepC = dag.steps.find((s) => s.stepKey === "c")!.stepExecutionId;

      const cascaded = await db.transaction(async (client) => {
        return DAGStateMachine.failStepCascading(client, {
          failedStepExecutionId: stepA,
          executionId: dag.executionId,
          reason: "Model Timeout 504",
        });
      });

      expect(cascaded).toHaveLength(2);
      expect(cascaded).toContain(stepB);
      expect(cascaded).toContain(stepC);

      const postB = await db.query(`SELECT status FROM execution.step_executions WHERE id = $1;`, [stepB]);
      const postC = await db.query(`SELECT status FROM execution.step_executions WHERE id = $1;`, [stepC]);
      expect(postB.rows[0].status).toBe("failed");
      expect(postC.rows[0].status).toBe("failed");
    });
  });

  describe("M6.3: DAGDependencyResolver", () => {
    it("correctly resolves readiness and unblocks fork-join diamond steps", async () => {
      const dag = await executionEngine.createDAGTask({
        tenantId,
        taskType: "resolver_diamond_test",
        steps: [
          { stepKey: "start", name: "Start", dependencies: [] },
          { stepKey: "left", name: "Left", dependencies: ["start"] },
          { stepKey: "right", name: "Right", dependencies: ["start"] },
          { stepKey: "join", name: "Join", dependencies: ["left", "right"] },
        ],
      });

      const startStep = dag.steps.find((s) => s.stepKey === "start")!.stepExecutionId;
      const leftStep = dag.steps.find((s) => s.stepKey === "left")!.stepExecutionId;
      const rightStep = dag.steps.find((s) => s.stepKey === "right")!.stepExecutionId;
      const joinStep = dag.steps.find((s) => s.stepKey === "join")!.stepExecutionId;

      // 1. Initially, left, right, join are blocked
      await db.transaction(async (client) => {
        const initial = await DAGDependencyResolver.evaluateDependencies(client, dag.executionId);
        expect(initial.readyStepExecutionIds).toHaveLength(0);
        expect(initial.blockedStepExecutionIds).toHaveLength(3);
      });

      // 2. Mark 'start' completed -> left & right become unblocked
      await db.query(`UPDATE execution.step_executions SET status = 'completed' WHERE id = $1;`, [startStep]);
      await db.transaction(async (client) => {
        const unblocked = await DAGDependencyResolver.unblockReadySteps(client, dag.executionId);
        expect(unblocked).toHaveLength(2);
        expect(unblocked).toContain(leftStep);
        expect(unblocked).toContain(rightStep);
      });

      // 3. Complete only 'left' -> 'join' remains blocked
      await db.query(`UPDATE execution.step_executions SET status = 'completed' WHERE id = $1;`, [leftStep]);
      await db.transaction(async (client) => {
        const evalMid = await DAGDependencyResolver.evaluateDependencies(client, dag.executionId);
        expect(evalMid.readyStepExecutionIds).toHaveLength(0);
        expect(evalMid.blockedStepExecutionIds).toContain(joinStep);
      });

      // 4. Complete 'right' -> 'join' unblocked
      await db.query(`UPDATE execution.step_executions SET status = 'completed' WHERE id = $1;`, [rightStep]);
      await db.transaction(async (client) => {
        const unblocked = await DAGDependencyResolver.unblockReadySteps(client, dag.executionId);
        expect(unblocked).toEqual([joinStep]);
      });

      const finalJoin = await db.query(`SELECT status FROM execution.step_executions WHERE id = $1;`, [joinStep]);
      expect(finalJoin.rows[0].status).toBe("pending");
    });

    it("resolves and binds validated output artifacts from upstream steps", async () => {
      const dag = await executionEngine.createDAGTask({
        tenantId,
        taskType: "artifact_binding_test",
        steps: [
          { stepKey: "producer", name: "Producer", dependencies: [] },
          { stepKey: "consumer", name: "Consumer", dependencies: ["producer"] },
        ],
      });

      const producerId = dag.steps.find((s) => s.stepKey === "producer")!.stepExecutionId;
      const consumerId = dag.steps.find((s) => s.stepKey === "consumer")!.stepExecutionId;
      const artifactId = generateUUIDv7();
      const validationId = generateUUIDv7();

      await db.query(
        `INSERT INTO artifacts.artifacts (
          id, tenant_id, task_id, type, storage_uri, inline_content, content_hash, size_bytes, status
        ) VALUES ($1, $2, $3, 'text_output', 'artifact://test', 'Producer generated text', 'hash-123', 23, 'active');`,
        [artifactId, tenantId, dag.taskId]
      );
      await db.query(
        `INSERT INTO validation.validations (
          id, task_id, execution_id, step_execution_id, target_type, target_id, validator_type, status, confidence
        ) VALUES ($1, $2, $3, $4, 'artifact', $5, 'deterministic', 'passed', 0.99);`,
        [validationId, dag.taskId, dag.executionId, producerId, artifactId]
      );

      await db.transaction(async (client) => {
        const resolved = await DAGDependencyResolver.resolveStepArtifactInputs(client, {
          stepExecutionId: consumerId,
          executionId: dag.executionId,
          inputReferences: [{ sourceStepKey: "producer", artifactType: "text_output", required: true }],
        });

        expect(resolved.missingRequiredArtifacts).toHaveLength(0);
        expect(resolved.resolvedPayload["producer"]).toBeDefined();
        const producerInput = resolved.resolvedPayload["producer"] as any;
        expect(producerInput.artifactId).toBe(artifactId);
        expect(producerInput.content).toBe("Producer generated text");
      });
    });
  });
});

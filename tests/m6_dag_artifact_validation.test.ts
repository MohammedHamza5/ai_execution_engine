import { describe, it, expect, beforeAll } from "vitest";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrator.js";
import { executionEngine } from "../src/engine/executionEngine.js";
import { DAGArtifactFlow } from "../src/engine/dagArtifactFlow.js";
import { DAGValidationBarrier } from "../src/engine/dagValidationBarrier.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";

describe("Milestone M6 Batch D — Artifact Flow & Validation Gate (M6.6 & M6.7)", () => {
  let tenantId: string;

  beforeAll(async () => {
    await runMigrations();
    tenantId = generateUUIDv7();
    await db.query(
      `INSERT INTO identity.tenants (id, name, slug) VALUES ($1, $2, $3);`,
      [tenantId, "M6 Batch D Tenant", `m6-batch-d-tenant-${tenantId}`]
    );
  });

  describe("M6.6: DAGArtifactFlow", () => {
    it("aggregates multiple parallel branch outputs with lineage hash", async () => {
      const dag = await executionEngine.createDAGTask({
        tenantId,
        taskType: "merge_flow_test",
        steps: [
          { stepKey: "branch_a", name: "A", dependencies: [] },
          { stepKey: "branch_b", name: "B", dependencies: [] },
          { stepKey: "merge", name: "M", dependencies: ["branch_a", "branch_b"] },
        ],
      });

      const stepA = dag.steps.find((s) => s.stepKey === "branch_a")!.stepExecutionId;
      const stepB = dag.steps.find((s) => s.stepKey === "branch_b")!.stepExecutionId;

      // Commit and validate outputs for both branches
      await db.transaction(async (client) => {
        const artA = await DAGArtifactFlow.commitStepArtifact(client, {
          executionId: dag.executionId,
          taskId: dag.taskId,
          tenantId,
          stepExecutionId: stepA,
          content: "Analysis from Branch A",
        });

        const artB = await DAGArtifactFlow.commitStepArtifact(client, {
          executionId: dag.executionId,
          taskId: dag.taskId,
          tenantId,
          stepExecutionId: stepB,
          content: "Analysis from Branch B",
        });

        await client.query(
          `INSERT INTO validation.validations (
            id, task_id, execution_id, step_execution_id, target_type, target_id, validator_type, status, confidence
          ) VALUES 
            ($1, $2, $3, $4, 'artifact', $5, 'deterministic', 'passed', 0.95),
            ($6, $2, $3, $7, 'artifact', $8, 'deterministic', 'passed', 0.90);`,
          [generateUUIDv7(), dag.taskId, dag.executionId, stepA, artA.artifactId, generateUUIDv7(), stepB, artB.artifactId]
        );
      });

      // Build merge context for target 'merge'
      await db.transaction(async (client) => {
        const context = await DAGArtifactFlow.buildMergeContext(client, {
          executionId: dag.executionId,
          targetStepKey: "merge",
          expectedInputKeys: ["branch_a", "branch_b"],
        });

        expect(context.hasMissingRequiredInputs).toBe(false);
        expect(context.hasUncertainInputs).toBe(false);
        expect(context.inputs).toHaveLength(2);
        expect(context.mergedPayload["branch_a"]).toBeDefined();
        expect(context.mergedPayload["branch_b"]).toBeDefined();
        expect(context.lineageHash).toHaveLength(64); // SHA-256
      });
    });

    it("flags missing required branch outputs gracefully", async () => {
      const dag = await executionEngine.createDAGTask({
        tenantId,
        taskType: "missing_branch_test",
        steps: [
          { stepKey: "w1", name: "W1", dependencies: [] },
          { stepKey: "w2", name: "W2", dependencies: [] },
        ],
      });

      await db.transaction(async (client) => {
        const context = await DAGArtifactFlow.buildMergeContext(client, {
          executionId: dag.executionId,
          targetStepKey: "merge",
          expectedInputKeys: ["w1", "w2"],
          requiredKeys: ["w1", "w2"],
        });

        expect(context.hasMissingRequiredInputs).toBe(true);
        expect(context.inputs[0].status).toBe("missing");
      });
    });
  });

  describe("M6.7: DAGValidationBarrier", () => {
    it("strictly evaluates tri-state validation gates", () => {
      // 1. Deterministic failure
      const r1 = DAGValidationBarrier.evaluate({ confidence: 0.99, deterministicPassed: false });
      expect(r1.decision).toBe("REJECT");
      expect(r1.isQuarantined).toBe(true);

      // 2. Active peer dispute
      const r2 = DAGValidationBarrier.evaluate({ confidence: 0.95, deterministicPassed: true, disputeFlag: true });
      expect(r2.decision).toBe("UNCERTAIN");
      expect(r2.recommendation).toBe("REQUIRE_ARBITRATION");
      expect(r2.isQuarantined).toBe(true);

      // 3. Accepted high confidence
      const r3 = DAGValidationBarrier.evaluate({ confidence: 0.92, deterministicPassed: true });
      expect(r3.decision).toBe("ACCEPT");
      expect(r3.isQuarantined).toBe(false);
      expect(r3.recommendation).toBe("COMMIT_AND_UNBLOCK");

      // 4. Uncertain intermediate confidence
      const r4 = DAGValidationBarrier.evaluate({ confidence: 0.70, deterministicPassed: true });
      expect(r4.decision).toBe("UNCERTAIN");
      expect(r4.isQuarantined).toBe(true);

      // 5. Rejected low confidence
      const r5 = DAGValidationBarrier.evaluate({ confidence: 0.40, deterministicPassed: true });
      expect(r5.decision).toBe("REJECT");
      expect(r5.isQuarantined).toBe(true);
    });

    it("records quarantine status and emits outbox events on rejected outputs", async () => {
      const dag = await executionEngine.createDAGTask({
        tenantId,
        taskType: "quarantine_test",
        steps: [{ stepKey: "bad_step", name: "Bad", dependencies: [] }],
      });
      const stepId = dag.steps[0].stepExecutionId;
      const artifactId = generateUUIDv7();

      const evalResult = DAGValidationBarrier.evaluate({
        confidence: 0.45,
        deterministicPassed: true,
      });

      await db.transaction(async (client) => {
        const valId = await DAGValidationBarrier.recordAndEnforceBarrier(client, {
          stepExecutionId: stepId,
          executionId: dag.executionId,
          taskId: dag.taskId,
          artifactId,
          evaluation: evalResult,
        });
        expect(valId).toBeDefined();
      });

      const valRecord = await db.query(
        `SELECT status, confidence FROM validation.validations WHERE step_execution_id = $1;`,
        [stepId]
      );
      expect(valRecord.rows[0].status).toBe("failed");

      const outbox = await db.query(
        `SELECT event_type FROM system.outbox_events WHERE aggregate_id = $1 AND event_type = 'STEP_VALIDATION_QUARANTINED';`,
        [stepId]
      );
      expect(outbox.rows).toHaveLength(1);
    });
  });
});

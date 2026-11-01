import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrator.js";
import { executionEngine } from "../src/engine/executionEngine.js";
import { ExecutionWorker } from "../src/engine/worker.js";
import { DAGParallelExecutor } from "../src/engine/dagParallelExecutor.js";
import { DAGArtifactFlow } from "../src/engine/dagArtifactFlow.js";
import { DAGValidationBarrier } from "../src/engine/dagValidationBarrier.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";

describe("Milestone M6 Batch F — E2E Adversarial Matrix & Stress Suite (M6.10)", () => {
  let tenantId: string;
  let testWorker: ExecutionWorker;

  beforeAll(async () => {
    await runMigrations();
    tenantId = generateUUIDv7();
    await db.query(
      `INSERT INTO identity.tenants (id, name, slug) VALUES ($1, $2, $3);`,
      [tenantId, "M6 Batch F Tenant", `m6-batch-f-tenant-${tenantId}`]
    );
    testWorker = new ExecutionWorker();
  });

  afterAll(() => {
    testWorker.stop();
  });

  it("Scenario 1: End-to-End Linear DAG workflow execution through worker lifecycle", async () => {
    const dag = await executionEngine.createDAGTask({
      tenantId,
      taskType: "e2e_linear_dag",
      steps: [
        { stepKey: "s1", name: "Step 1", dependencies: [], inputPayload: { prompt: "Ingest data" } },
        { stepKey: "s2", name: "Step 2", dependencies: ["s1"], inputPayload: { prompt: "Process data" } },
        { stepKey: "s3", name: "Step 3", dependencies: ["s2"], inputPayload: { prompt: "Final report" } },
      ],
    });

    const s1 = dag.steps.find((s) => s.stepKey === "s1")!.stepExecutionId;
    const s2 = dag.steps.find((s) => s.stepKey === "s2")!.stepExecutionId;
    const s3 = dag.steps.find((s) => s.stepKey === "s3")!.stepExecutionId;

    // Execute s1
    const ok1 = await testWorker.claimAndExecuteNext(s1);
    expect(ok1).toBe(true);

    const s2StatusMid = await db.query(`SELECT status FROM execution.step_executions WHERE id = $1;`, [s2]);
    expect(s2StatusMid.rows[0].status).toBe("pending"); // Reactively unblocked!

    // Execute s2
    const ok2 = await testWorker.claimAndExecuteNext(s2);
    expect(ok2).toBe(true);

    // Execute s3 (Terminal)
    const ok3 = await testWorker.claimAndExecuteNext(s3);
    expect(ok3).toBe(true);

    const taskFinal = await db.query(`SELECT status, output_artifact_id FROM tasks.tasks WHERE id = $1;`, [dag.taskId]);
    expect(taskFinal.rows[0].status).toBe("completed");
    expect(taskFinal.rows[0].output_artifact_id).toBeDefined();
  });

  it("Scenario 2: E2E Diamond Fork-Join DAG with artifact flow and context lineage", async () => {
    const dag = await executionEngine.createDAGTask({
      tenantId,
      taskType: "e2e_diamond_dag",
      steps: [
        { stepKey: "init", name: "Init", dependencies: [] },
        { stepKey: "branch_x", name: "Branch X", dependencies: ["init"] },
        { stepKey: "branch_y", name: "Branch Y", dependencies: ["init"] },
        { stepKey: "synthesis", name: "Synthesis", dependencies: ["branch_x", "branch_y"] },
      ],
    });

    const initId = dag.steps.find((s) => s.stepKey === "init")!.stepExecutionId;
    const xId = dag.steps.find((s) => s.stepKey === "branch_x")!.stepExecutionId;
    const yId = dag.steps.find((s) => s.stepKey === "branch_y")!.stepExecutionId;
    const synthId = dag.steps.find((s) => s.stepKey === "synthesis")!.stepExecutionId;

    await testWorker.claimAndExecuteNext(initId);

    // Both X and Y are now unblocked and ready for parallel execution
    const parallelResult = await db.transaction(async (client) => {
      return DAGParallelExecutor.dispatchReadySteps(client, {
        executionId: dag.executionId,
        maxConcurrency: 5,
      });
    });
    expect(parallelResult.dispatchedStepExecutionIds).toHaveLength(2);
    expect(parallelResult.dispatchedStepExecutionIds).toContain(xId);
    expect(parallelResult.dispatchedStepExecutionIds).toContain(yId);

    // Simulate completion of X and Y with verified artifacts
    await db.transaction(async (client) => {
      const artX = await DAGArtifactFlow.commitStepArtifact(client, {
        executionId: dag.executionId,
        taskId: dag.taskId,
        tenantId,
        stepExecutionId: xId,
        content: "Data X Output",
      });
      const artY = await DAGArtifactFlow.commitStepArtifact(client, {
        executionId: dag.executionId,
        taskId: dag.taskId,
        tenantId,
        stepExecutionId: yId,
        content: "Data Y Output",
      });

      await client.query(
        `INSERT INTO validation.validations (id, task_id, execution_id, step_execution_id, target_type, target_id, validator_type, status, confidence)
         VALUES ($1, $2, $3, $4, 'artifact', $5, 'deterministic', 'passed', 0.96);`,
        [generateUUIDv7(), dag.taskId, dag.executionId, xId, artX.artifactId]
      );
      await client.query(
        `INSERT INTO validation.validations (id, task_id, execution_id, step_execution_id, target_type, target_id, validator_type, status, confidence)
         VALUES ($1, $2, $3, $4, 'artifact', $5, 'deterministic', 'passed', 0.94);`,
        [generateUUIDv7(), dag.taskId, dag.executionId, yId, artY.artifactId]
      );

      await client.query(`UPDATE execution.step_executions SET status = 'completed' WHERE id IN ($1, $2);`, [xId, yId]);
    });

    // Synthesis is now eligible for merge context
    await db.transaction(async (client) => {
      const mergeCtx = await DAGArtifactFlow.buildMergeContext(client, {
        executionId: dag.executionId,
        targetStepKey: "synthesis",
        expectedInputKeys: ["branch_x", "branch_y"],
      });
      expect(mergeCtx.hasMissingRequiredInputs).toBe(false);
      expect(mergeCtx.lineageHash).toHaveLength(64);
    });
  });

  it("Scenario 3: High-concurrency stress test across multiple simultaneous DAG tasks", async () => {
    // Dispatch 5 DAGs concurrently
    const taskPromises = Array.from({ length: 5 }).map((_, i) =>
      executionEngine.createDAGTask({
        tenantId,
        taskType: `concurrent_dag_${i}`,
        steps: [
          { stepKey: "r1", name: "Root 1", dependencies: [] },
          { stepKey: "r2", name: "Root 2", dependencies: [] },
        ],
      })
    );

    const createdDAGs = await Promise.all(taskPromises);
    expect(createdDAGs).toHaveLength(5);

    // Each DAG should have 2 steps in 'pending' status
    for (const d of createdDAGs) {
      const steps = await db.query(
        `SELECT COUNT(*) AS pending_count FROM execution.step_executions WHERE execution_id = $1 AND status = 'pending';`,
        [d.executionId]
      );
      expect(parseInt(steps.rows[0].pending_count, 10)).toBe(2);
    }
  });

  it("Scenario 4: Byzantine low-confidence output triggers quarantine and prevents downstream progress", async () => {
    const dag = await executionEngine.createDAGTask({
      tenantId,
      taskType: "byzantine_dag",
      steps: [
        { stepKey: "corrupted_step", name: "Corrupted", dependencies: [] },
        { stepKey: "dependent_step", name: "Dependent", dependencies: ["corrupted_step"] },
      ],
    });

    const badStepId = dag.steps[0].stepExecutionId;
    const depStepId = dag.steps[1].stepExecutionId;

    // Byzantine result: confidence 0.35
    const barrier = DAGValidationBarrier.evaluate({ confidence: 0.35, deterministicPassed: false });
    expect(barrier.decision).toBe("REJECT");
    expect(barrier.isQuarantined).toBe(true);

    await db.transaction(async (client) => {
      await DAGValidationBarrier.recordAndEnforceBarrier(client, {
        stepExecutionId: badStepId,
        executionId: dag.executionId,
        taskId: dag.taskId,
        artifactId: generateUUIDv7(),
        evaluation: barrier,
      });
    });

    // Dependent step must remain blocked
    const depPost = await db.query(`SELECT status FROM execution.step_executions WHERE id = $1;`, [depStepId]);
    expect(depPost.rows[0].status).toBe("blocked");
  });
});

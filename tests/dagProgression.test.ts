import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrator.js";
import { executionEngine } from "../src/engine/executionEngine.js";
import { ExecutionWorker } from "../src/engine/worker.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";

describe("DAG Reactive Progression Tests (M4.2 & M4.3)", () => {
  let tenantId: string;
  let testWorker: ExecutionWorker;

  beforeAll(async () => {
    await runMigrations();

    tenantId = generateUUIDv7();
    await db.query(
      `INSERT INTO identity.tenants (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING;`,
      [tenantId, "DAG Test Tenant", `dag-tenant-${tenantId}`]
    );

    testWorker = new ExecutionWorker();
  });

  afterAll(async () => {
    testWorker.stop();
  });

  it("linear DAG execution: Step 1 -> Step 2 -> Step 3 unblocks reactively and completes task", async () => {
    // 1. Create a 3-step linear DAG
    const dagResult = await executionEngine.createDAGTask({
      tenantId,
      taskType: "linear_dag_test",
      strategy: "dag_workflow",
      steps: [
        {
          stepKey: "step_1",
          name: "Ingest Data",
          dependencies: [],
          inputPayload: { prompt: "Return step 1 output text" },
        },
        {
          stepKey: "step_2",
          name: "Process Data",
          dependencies: ["step_1"],
          inputPayload: { prompt: "Return step 2 processed output" },
        },
        {
          stepKey: "step_3",
          name: "Final Summary",
          dependencies: ["step_2"],
          inputPayload: { prompt: "Return step 3 summary report" },
        },
      ],
    });

    expect(dagResult.steps).toHaveLength(3);
    expect(dagResult.rootStepKeys).toEqual(["step_1"]);
    expect(dagResult.terminalStepKeys).toEqual(["step_3"]);

    // Verify initial database states
    const step1 = dagResult.steps.find((s) => s.stepKey === "step_1")!;
    const step2 = dagResult.steps.find((s) => s.stepKey === "step_2")!;
    const step3 = dagResult.steps.find((s) => s.stepKey === "step_3")!;

    expect(step1.status).toBe("pending");
    expect(step2.status).toBe("blocked");
    expect(step3.status).toBe("blocked");

    const taskPre = await db.query(`SELECT status FROM tasks.tasks WHERE id = $1;`, [dagResult.taskId]);
    expect(taskPre.rows[0].status).toBe("pending");

    // 2. Execute Step 1
    const step1Executed = await testWorker.claimAndExecuteNext(step1.stepExecutionId);
    expect(step1Executed).toBe(true);

    // Verify Step 1 is completed, Step 2 is unblocked ('pending'), Step 3 remains 'blocked'
    const step1Post = await db.query(`SELECT status FROM execution.step_executions WHERE id = $1;`, [step1.stepExecutionId]);
    const step2Post1 = await db.query(`SELECT status FROM execution.step_executions WHERE id = $1;`, [step2.stepExecutionId]);
    const step3Post1 = await db.query(`SELECT status FROM execution.step_executions WHERE id = $1;`, [step3.stepExecutionId]);

    expect(step1Post.rows[0].status).toBe("completed");
    expect(step2Post1.rows[0].status).toBe("pending");
    expect(step3Post1.rows[0].status).toBe("blocked");

    const taskMid1 = await db.query(`SELECT status FROM tasks.tasks WHERE id = $1;`, [dagResult.taskId]);
    expect(taskMid1.rows[0].status).toBe("pending");

    // 3. Execute Step 2
    const step2Executed = await testWorker.claimAndExecuteNext(step2.stepExecutionId);
    expect(step2Executed).toBe(true);

    // Verify Step 2 is completed, Step 3 is unblocked ('pending')
    const step2Post2 = await db.query(`SELECT status FROM execution.step_executions WHERE id = $1;`, [step2.stepExecutionId]);
    const step3Post2 = await db.query(`SELECT status FROM execution.step_executions WHERE id = $1;`, [step3.stepExecutionId]);

    expect(step2Post2.rows[0].status).toBe("completed");
    expect(step3Post2.rows[0].status).toBe("pending");

    // 4. Execute Step 3 (Terminal Step)
    const step3Executed = await testWorker.claimAndExecuteNext(step3.stepExecutionId);
    expect(step3Executed).toBe(true);

    // Verify Step 3 is completed and entire Task & Execution are completed
    const step3Post3 = await db.query(`SELECT status FROM execution.step_executions WHERE id = $1;`, [step3.stepExecutionId]);
    const taskFinal = await db.query(`SELECT status, output_artifact_id FROM tasks.tasks WHERE id = $1;`, [dagResult.taskId]);
    const execFinal = await db.query(`SELECT status FROM execution.executions WHERE id = $1;`, [dagResult.executionId]);

    expect(step3Post3.rows[0].status).toBe("completed");
    expect(taskFinal.rows[0].status).toBe("completed");
    expect(taskFinal.rows[0].output_artifact_id).toBeTruthy();
    expect(execFinal.rows[0].status).toBe("completed");
  });

  it("diamond DAG execution: A -> (B, C) -> D synchronizes join step D correctly", async () => {
    // Diamond topology:
    //      A
    //     / \
    //    B   C
    //     \ /
    //      D
    const dagResult = await executionEngine.createDAGTask({
      tenantId,
      taskType: "diamond_dag_test",
      strategy: "diamond_workflow",
      steps: [
        {
          stepKey: "step_a",
          name: "Root Generator",
          dependencies: [],
          inputPayload: { prompt: "Generate source specification" },
        },
        {
          stepKey: "step_b",
          name: "Branch B Analysis",
          dependencies: ["step_a"],
          inputPayload: { prompt: "Perform analysis B" },
        },
        {
          stepKey: "step_c",
          name: "Branch C Analysis",
          dependencies: ["step_a"],
          inputPayload: { prompt: "Perform analysis C" },
        },
        {
          stepKey: "step_d",
          name: "Join Aggregator",
          dependencies: ["step_b", "step_c"],
          inputPayload: { prompt: "Synthesize findings B and C" },
        },
      ],
    });

    expect(dagResult.rootStepKeys).toEqual(["step_a"]);
    expect(dagResult.terminalStepKeys).toEqual(["step_d"]);

    const stepA = dagResult.steps.find((s) => s.stepKey === "step_a")!;
    const stepB = dagResult.steps.find((s) => s.stepKey === "step_b")!;
    const stepC = dagResult.steps.find((s) => s.stepKey === "step_c")!;
    const stepD = dagResult.steps.find((s) => s.stepKey === "step_d")!;

    // 1. Execute Step A
    await testWorker.claimAndExecuteNext(stepA.stepExecutionId);

    // Verify both B and C are unblocked to 'pending', but D remains 'blocked'
    const statusB1 = await db.query(`SELECT status FROM execution.step_executions WHERE id = $1;`, [stepB.stepExecutionId]);
    const statusC1 = await db.query(`SELECT status FROM execution.step_executions WHERE id = $1;`, [stepC.stepExecutionId]);
    const statusD1 = await db.query(`SELECT status FROM execution.step_executions WHERE id = $1;`, [stepD.stepExecutionId]);

    expect(statusB1.rows[0].status).toBe("pending");
    expect(statusC1.rows[0].status).toBe("pending");
    expect(statusD1.rows[0].status).toBe("blocked");

    // 2. Execute only Step B
    await testWorker.claimAndExecuteNext(stepB.stepExecutionId);

    // Verify B is completed, C is pending, and D is STILL blocked (waiting for C)
    const statusB2 = await db.query(`SELECT status FROM execution.step_executions WHERE id = $1;`, [stepB.stepExecutionId]);
    const statusD2 = await db.query(`SELECT status FROM execution.step_executions WHERE id = $1;`, [stepD.stepExecutionId]);

    expect(statusB2.rows[0].status).toBe("completed");
    expect(statusD2.rows[0].status).toBe("blocked"); // INVARIANT: Join step must wait for ALL parents!

    // 3. Execute Step C
    await testWorker.claimAndExecuteNext(stepC.stepExecutionId);

    // Verify C is completed and D is NOW unblocked to 'pending'!
    const statusC3 = await db.query(`SELECT status FROM execution.step_executions WHERE id = $1;`, [stepC.stepExecutionId]);
    const statusD3 = await db.query(`SELECT status FROM execution.step_executions WHERE id = $1;`, [stepD.stepExecutionId]);

    expect(statusC3.rows[0].status).toBe("completed");
    expect(statusD3.rows[0].status).toBe("pending");

    // 4. Execute Step D (Join step)
    await testWorker.claimAndExecuteNext(stepD.stepExecutionId);

    // Verify D is completed and task is complete
    const statusD4 = await db.query(`SELECT status FROM execution.step_executions WHERE id = $1;`, [stepD.stepExecutionId]);
    const taskFinal = await db.query(`SELECT status FROM tasks.tasks WHERE id = $1;`, [dagResult.taskId]);

    expect(statusD4.rows[0].status).toBe("completed");
    expect(taskFinal.rows[0].status).toBe("completed");
  });
});

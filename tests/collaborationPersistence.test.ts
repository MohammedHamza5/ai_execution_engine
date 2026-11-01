import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../src/db/client.js";
import { executionEngine } from "../src/engine/executionEngine.js";
import { collaborationService } from "../src/engine/collaborationService.js";
import { resourceIntelligence } from "../src/resources/resourceIntelligence.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";
import { ensureDefaultTenant } from "../src/api/routes/tasks.js";

describe("M3 Batch A — Collaboration Persistence & Branch Lifecycle Integration", () => {
  let baseResourceId: string;
  let tenantId: string;

  beforeAll(async () => {
    tenantId = await ensureDefaultTenant();
    baseResourceId = await resourceIntelligence.ensureBaseResource();
  });

  afterAll(async () => {
    // Keep connection clean
  });

  it("Task M3.3: atomically creates a collaboration task, plan, run, and parallel branches with outbox events", async () => {
    const result = await executionEngine.createCollaborationTask({
      tenantId,
      taskType: "multi_model_analysis",
      objective: "Analyze code performance and security across multiple perspectives",
      strategy: "parallel_generation",
      completionPolicy: {
        type: "ALL_REQUIRED",
      },
      branches: [
        {
          branchKey: "branch_perf",
          role: "specialist",
          name: "Performance Specialist",
          description: "Analyzes algorithmic complexity and latency bottlenecks",
          resourceId: baseResourceId,
        },
        {
          branchKey: "branch_sec",
          role: "specialist",
          name: "Security Specialist",
          description: "Analyzes security vulnerabilities and untrusted inputs",
          resourceId: baseResourceId,
        },
      ],
      inputPayload: {
        code: "function process(input) { return eval(input); }",
      },
    });

    expect(result.taskId).toBeDefined();
    expect(result.planId).toBeDefined();
    expect(result.executionId).toBeDefined();
    expect(result.collaborationRunId).toBeDefined();
    expect(result.branches).toHaveLength(2);

    // 1. Verify Task
    const task = await executionEngine.getTask(result.taskId);
    expect(task).not.toBeNull();
    expect(task?.status).toBe("pending");
    expect(task?.taskType).toBe("multi_model_analysis");

    // 2. Verify Plan & Strategy
    const planRes = await db.query(
      `SELECT * FROM planning.execution_plans WHERE id = $1;`,
      [result.planId]
    );
    expect(planRes.rows).toHaveLength(1);
    expect(planRes.rows[0].strategy).toBe("parallel_generation");

    // 3. Verify Collaboration Run
    const run = await collaborationService.getCollaborationRun(result.collaborationRunId);
    expect(run).not.toBeNull();
    expect(run?.state).toBe("CREATED");
    expect(run?.strategy).toBe("parallel_generation");
    expect(run?.branchCount).toBe(2);
    expect(run?.objective).toContain("Analyze code performance and security");

    // 4. Verify Collaboration Branches
    const branches = await collaborationService.getCollaborationBranches(result.collaborationRunId);
    expect(branches).toHaveLength(2);
    expect(branches.map((b) => b.branchKey).sort()).toEqual(["branch_perf", "branch_sec"]);
    expect(branches.every((b) => b.status === "pending")).toBe(true);

    // 5. Verify Plan Steps & Step Executions in work queue
    const stepsRes = await db.query(
      `SELECT * FROM execution.step_executions WHERE execution_id = $1 ORDER BY priority DESC;`,
      [result.executionId]
    );
    expect(stepsRes.rows).toHaveLength(2);
    expect(stepsRes.rows.every((s) => s.status === "pending")).toBe(true);

    // 6. Verify Outbox Events
    const outboxRes = await db.query(
      `SELECT event_type FROM system.outbox_events 
       WHERE aggregate_id IN ($1, $2)
       ORDER BY event_type ASC;`,
      [result.taskId, result.collaborationRunId]
    );
    const eventTypes = outboxRes.rows.map((r) => r.event_type);
    expect(eventTypes).toContain("TASK_CREATED");
    expect(eventTypes).toContain("COLLABORATION_CREATED");
  });

  it("Task M3.2: enforces relational uniqueness on (collaboration_run_id, branch_key)", async () => {
    const runId = generateUUIDv7();
    const taskId = generateUUIDv7();
    const executionId = generateUUIDv7();
    const planId = generateUUIDv7();

    // Setup parent entities
    await db.query(
      `INSERT INTO tasks.tasks (id, tenant_id, task_type, input_payload)
       VALUES ($1, $2, 'test_task', '{}');`,
      [taskId, tenantId]
    );
    await db.query(
      `INSERT INTO planning.execution_plans (id, task_id, strategy)
       VALUES ($1, $2, 'single_model');`,
      [planId, taskId]
    );
    await db.query(
      `INSERT INTO execution.executions (id, task_id, plan_id)
       VALUES ($1, $2, $3);`,
      [executionId, taskId, planId]
    );
    await db.query(
      `INSERT INTO execution.collaboration_runs (id, task_id, execution_id, plan_id, strategy, objective)
       VALUES ($1, $2, $3, $4, 'parallel_generation', 'Test uniqueness');`,
      [runId, taskId, executionId, planId]
    );

    // Create a plan step and step execution for FK
    const planStepId = generateUUIDv7();
    await db.query(
      `INSERT INTO planning.plan_steps (id, plan_id, step_key, name, step_type, order_index)
       VALUES ($1, $2, 'step_1', 'Step 1', 'model_inference', 1);`,
      [planStepId, planId]
    );
    const stepExecId = generateUUIDv7();
    await db.query(
      `INSERT INTO execution.step_executions (id, execution_id, plan_step_id, task_id, status)
       VALUES ($1, $2, $3, $4, 'pending');`,
      [stepExecId, executionId, planStepId, taskId]
    );

    const modelRes = await db.query(`SELECT model_id FROM resources.resources WHERE id = $1;`, [baseResourceId]);
    const modelId = modelRes.rows[0].model_id;

    // First branch insert succeeds
    const branch1Id = generateUUIDv7();
    await db.query(
      `INSERT INTO execution.collaboration_branches (
        id, collaboration_run_id, branch_key, role, step_execution_id, resource_id, model_id
      ) VALUES ($1, $2, 'duplicate_key', 'generator', $3, $4, $5);`,
      [branch1Id, runId, stepExecId, baseResourceId, modelId]
    );

    // Second branch insert with duplicate branch_key must fail
    const branch2Id = generateUUIDv7();
    await expect(
      db.query(
        `INSERT INTO execution.collaboration_branches (
          id, collaboration_run_id, branch_key, role, step_execution_id, resource_id, model_id
        ) VALUES ($1, $2, 'duplicate_key', 'critic', $3, $4, $5);`,
        [branch2Id, runId, stepExecId, baseResourceId, modelId]
      )
    ).rejects.toThrow();
  });

  it("Task M3.1 & M3.2: verifies collaboration state transitions and branch completion evaluation", async () => {
    const taskResult = await executionEngine.createCollaborationTask({
      tenantId,
      taskType: "generator_critic_analysis",
      objective: "Generate code and independently verify with critic",
      strategy: "generator_critic",
      completionPolicy: {
        type: "PRIMARY_PLUS_VALIDATION",
      },
      branches: [
        {
          branchKey: "generator",
          role: "generator",
          resourceId: baseResourceId,
        },
        {
          branchKey: "critic",
          role: "critic",
          resourceId: baseResourceId,
        },
      ],
    });

    const runId = taskResult.collaborationRunId;

    // Forward transition: CREATED -> PLANNED -> DISPATCHING -> RUNNING
    const runPlanned = await collaborationService.transitionState(runId, "PLANNED");
    expect(runPlanned.state).toBe("PLANNED");

    const runDispatching = await collaborationService.transitionState(runId, "DISPATCHING");
    expect(runDispatching.state).toBe("DISPATCHING");

    const runRunning = await collaborationService.transitionState(runId, "RUNNING");
    expect(runRunning.state).toBe("RUNNING");

    // Check initial progress: 0 completed
    let progress = await collaborationService.evaluateRunProgress(runId);
    expect(progress.isSatisfied).toBe(false);
    expect(progress.completedCount).toBe(0);
    expect(progress.pendingCount).toBe(2);

    // Record branch 1 completion with a mock artifact
    const artifactId = generateUUIDv7();
    await db.query(
      `INSERT INTO artifacts.artifacts (
        id, tenant_id, task_id, type, storage_uri, inline_content, content_hash, size_bytes, status
      ) VALUES ($1, $2, $3, 'text_output', 'artifact://mock/1', 'Generated Output', 'hash1', 16, 'active');`,
      [artifactId, tenantId, taskResult.taskId]
    );

    const branches = await collaborationService.getCollaborationBranches(runId);
    const generatorBranch = branches.find((b) => b.branchKey === "generator")!;
    const updatedGen = await collaborationService.recordBranchResult({
      branchId: generatorBranch.id,
      status: "completed",
      outputArtifactId: artifactId,
    });
    expect(updatedGen.status).toBe("completed");
    expect(updatedGen.outputArtifactId).toBe(artifactId);

    // Check intermediate progress: 1 completed, 1 pending
    progress = await collaborationService.evaluateRunProgress(runId);
    expect(progress.isSatisfied).toBe(false);
    expect(progress.completedCount).toBe(1);

    // Record branch 2 completion
    const criticBranch = branches.find((b) => b.branchKey === "critic")!;
    await collaborationService.recordBranchResult({
      branchId: criticBranch.id,
      status: "completed",
    });

    // Check final progress: satisfied!
    progress = await collaborationService.evaluateRunProgress(runId);
    expect(progress.isSatisfied).toBe(true);
    expect(progress.completedCount).toBe(2);
    expect(progress.canProceedToSynthesis).toBe(true);

    // Transition to COLLECTING -> SYNTHESIZING -> VALIDATING -> COMPLETED
    await collaborationService.transitionState(runId, "COLLECTING");
    await collaborationService.transitionState(runId, "SYNTHESIZING");
    await collaborationService.transitionState(runId, "VALIDATING");

    const completedRun = await collaborationService.completeCollaboration(runId, artifactId, 0.98);
    expect(completedRun.state).toBe("COMPLETED");
    expect(completedRun.resultArtifactId).toBe(artifactId);

    // Verify parent task and execution advanced to completed
    const finalTask = await executionEngine.getTask(taskResult.taskId);
    expect(finalTask?.status).toBe("completed");
    expect(finalTask?.outputArtifactId).toBe(artifactId);
    expect(finalTask?.qualityScore).toBe(0.98);

    const execRes = await db.query(`SELECT status FROM execution.executions WHERE id = $1;`, [taskResult.executionId]);
    expect(execRes.rows[0].status).toBe("completed");
  });
});

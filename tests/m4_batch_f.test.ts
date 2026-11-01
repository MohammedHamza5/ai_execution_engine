import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrator.js";
import { ensureDefaultTenant } from "../src/api/routes/tasks.js";
import { executionEngine } from "../src/engine/executionEngine.js";
import { resourceIntelligence } from "../src/resources/resourceIntelligence.js";
import { GeminiProviderAdapter } from "../src/adapters/geminiAdapter.js";
import { ProviderErrorCode } from "../src/adapters/types.js";
import { ExecutionWorker } from "../src/engine/worker.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";

describe("Milestone M4 Batch F — End-to-End Integration With M0–M3 (M4.16 – M4.19)", () => {
  let tenantId: string;
  let adapter: GeminiProviderAdapter;
  let worker: ExecutionWorker;

  beforeAll(async () => {
    await runMigrations();
    tenantId = await ensureDefaultTenant();
    adapter = new GeminiProviderAdapter();
    worker = new ExecutionWorker(generateUUIDv7(), adapter);
  });

  afterAll(async () => {
    await resourceIntelligence.ensureBaseResource();
    await db.close();
  });

  beforeEach(async () => {
    adapter.resetSimulation();
    await db.query(`
      DELETE FROM resources.resource_reservations;
      DELETE FROM resources.resource_decisions;
      DELETE FROM resources.resource_health;
      DELETE FROM resources.resource_quotas;
      DELETE FROM resources.resources;
    `);
    await resourceIntelligence.ensureBaseResource();
  });

  describe("Task M4.16: Execution Integration (End-to-End Vertical Slice)", () => {
    it("full execution flow: Task -> Selection -> Reservation -> Dispatch -> Reconciliation -> Artifact -> Validation -> Completed", async () => {
      // 1. Ensure clean high-priority resource
      const resourceId = await resourceIntelligence.ensureBaseResource();
      await db.query("UPDATE resources.resources SET priority = 100 WHERE id = $1;", [resourceId]);

      // 2. Create Task & Plan targeting selected resource
      const taskResult = await executionEngine.createTaskAndPlan({
        tenantId,
        taskType: "e2e_m4_vertical_slice",
        inputPayload: { prompt: "Explain thermodynamic entropy in physics" },
        requirements: { requiredCapabilities: ["TEXT_GENERATION"] },
        policy: { allowPaid: false },
      });

      // 3. Select resource through Resource Intelligence with Task Context (Task M4.4-M4.6)
      const selection = await resourceIntelligence.selectResource(
        { requiredCapabilities: ["TEXT_GENERATION"] },
        { allowPaid: false },
        { taskId: taskResult.taskId }
      );
      expect(selection.resource.id).toBe(resourceId);

      // 4. Reserve capacity prior to execution (Task M4.8)
      const reservation = await resourceIntelligence.reserveQuota({
        resourceId,
        taskId: taskResult.taskId,
        stepExecutionId: taskResult.stepExecutionId,
        estimatedTokens: 600,
        estimatedRequests: 1,
      });
      expect(reservation.granted).toBe(true);
      expect(reservation.reservationId).toBeDefined();

      // 5. Worker executes work unit
      const executed = await worker.claimAndExecuteNext(taskResult.stepExecutionId);
      expect(executed).toBe(true);

      // 6. Reconcile usage after execution (Task M4.8)
      const rec = await resourceIntelligence.reconcileUsage(reservation.reservationId!, {
        inputTokens: 300,
        outputTokens: 250,
      });
      expect(rec.actualTokens).toBe(550);
      expect(rec.estimatedTokens).toBe(600);

      // 7. Verify Task and Execution completed in PostgreSQL
      const taskQuery = await db.query("SELECT * FROM tasks.tasks WHERE id = $1;", [taskResult.taskId]);
      expect(taskQuery.rows[0].status).toBe("completed");
      expect(taskQuery.rows[0].output_artifact_id).toBeDefined();

      const stepQuery = await db.query("SELECT * FROM execution.step_executions WHERE id = $1;", [taskResult.stepExecutionId]);
      expect(stepQuery.rows[0].status).toBe("completed");

      // 8. Verify decision audit trail was recorded (Task M4.6)
      const decisionCheck = await db.query(
        "SELECT * FROM resources.resource_decisions WHERE task_id = $1;",
        [taskResult.taskId]
      );
      expect(decisionCheck.rows.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Task M4.17: M1 Integration (Provider Failure & Resource Migration)", () => {
    it("migrates from failing primary resource to healthy secondary resource via Resource Intelligence", async () => {
      // 1. Primary Resource A
      const resA = await resourceIntelligence.ensureBaseResource();
      await db.query("UPDATE resources.resources SET priority = 100 WHERE id = $1;", [resA]);

      // 2. Secondary Resource B
      const resB = await resourceIntelligence.registerResource({
        providerSlug: "gemini",
        modelSlug: "gemini-1.5-flash-8b",
        status: "active",
        priority: 50,
        quotaRemaining: 1000,
        isPaid: false,
      });

      // 3. Inject deterministic fault: Resource A suffers QUOTA_EXHAUSTED
      adapter.setResourceFault(resA, ProviderErrorCode.QUOTA_EXHAUSTED);

      // 4. Create Task
      const taskResult = await executionEngine.createTaskAndPlan({
        tenantId,
        taskType: "e2e_m1_m4_integration",
        inputPayload: { prompt: "Compute fibonacci sequence up to 20" },
        requirements: { allowPaid: false },
      });

      // 5. Worker executes: Attempt 1 fails -> Checkpoint -> Resource Intelligence selects Res B -> Attempt 2 succeeds
      const executed = await worker.claimAndExecuteNext(taskResult.stepExecutionId);
      expect(executed).toBe(true);

      // 6. Verify Task completed under migrated resource B
      const taskRow = (await db.query("SELECT * FROM tasks.tasks WHERE id = $1;", [taskResult.taskId])).rows[0];
      expect(taskRow.status).toBe("completed");

      const attempts = (await db.query(
        "SELECT * FROM execution.execution_attempts WHERE step_execution_id = $1 ORDER BY attempt_number ASC;",
        [taskResult.stepExecutionId]
      )).rows;

      expect(attempts).toHaveLength(2);
      expect(attempts[0].resource_id).toBe(resA);
      expect(attempts[1].resource_id).toBe(resB);
      expect(attempts[1].status).toBe("success");

      // 7. Verify failure was observed in ResourceHealthService
      const healthA = await resourceIntelligence.loadNormalizedCandidates();
      const candA = healthA.find((c) => c.resourceId === resA)!;
      expect(candA.health).not.toBe("HEALTHY");
    });
  });

  describe("Task M4.18: M2 Integration (Validation Recovery With Resource Intelligence)", () => {
    it("validation failure triggers policy migration to capable model and finishes successfully", async () => {
      const resA = await resourceIntelligence.ensureBaseResource();
      await db.query("UPDATE resources.resources SET priority = 100 WHERE id = $1;", [resA]);
      await db.query(
        `UPDATE ai.models SET metadata = jsonb_set(metadata::jsonb, '{capabilities}', '["text", "code", "json"]') WHERE slug = 'gemini-1.5-flash';`
      );

      const resB = await resourceIntelligence.registerResource({
        providerSlug: "gemini",
        modelSlug: "gemini-1.5-pro",
        status: "active",
        priority: 50,
        quotaRemaining: 1000,
        isPaid: false,
        capabilities: ["text", "code", "json"],
      });

      // Simulation: Resource A returns invalid JSON; Resource B returns valid JSON
      adapter.setResponseSequence([
        "This is not valid json! Plain text output.",
        JSON.stringify({ status: "success", summary: "JSON Output Verified" }),
      ]);

      const taskResult = await executionEngine.createTaskAndPlan({
        tenantId,
        taskType: "e2e_m2_m4_integration",
        inputPayload: { prompt: "Generate structured JSON summary", expectJson: true },
        requirements: { requiredCapabilities: ["JSON"], allowPaid: false },
      });

      const executed = await worker.claimAndExecuteNext(taskResult.stepExecutionId);
      expect(executed).toBe(true);

      const taskRow = (await db.query("SELECT * FROM tasks.tasks WHERE id = $1;", [taskResult.taskId])).rows[0];
      expect(taskRow.status).toBe("completed");

      // Verify attempts show recovery migration
      const attempts = (await db.query(
        "SELECT * FROM execution.execution_attempts WHERE step_execution_id = $1 ORDER BY attempt_number ASC;",
        [taskResult.stepExecutionId]
      )).rows;
      expect(attempts.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Task M4.19: M3 Integration (Multi-Model Collaboration With Resource Intelligence)", () => {
    it("executes multi-branch collaboration with distinct resources selected by Resource Intelligence", async () => {
      const resGen = await resourceIntelligence.ensureBaseResource();
      await db.query("UPDATE resources.resources SET priority = 100 WHERE id = $1;", [resGen]);

      const resCritic = await resourceIntelligence.registerResource({
        providerSlug: "gemini",
        modelSlug: "gemini-1.5-pro",
        status: "active",
        priority: 50,
        quotaRemaining: 1000,
        isPaid: false,
        capabilities: ["text", "code", "reasoning"],
      });

      const collabResult = await executionEngine.createCollaborationTask({
        tenantId,
        taskType: "e2e_m3_m4_collaboration",
        objective: "Multi-model review of microservices architecture",
        strategy: "parallel_specialist",
        completionPolicy: { type: "ALL_REQUIRED" },
        branches: [
          {
            branchKey: "generator_branch",
            role: "generator",
            resourceId: resGen,
          },
          {
            branchKey: "critic_branch",
            role: "critic",
            resourceId: resCritic,
          },
        ],
        inputPayload: {
          prompt: "Draft and review distributed cache architecture",
          branches: {
            generator_branch: { prompt: "Draft caching design" },
            critic_branch: { prompt: "Critique caching consistency" },
          },
        },
      });

      // Claim and execute both branches
      const branch1 = await worker.claimAndExecuteNext(collabResult.branches[0].stepExecutionId);
      const branch2 = await worker.claimAndExecuteNext(collabResult.branches[1].stepExecutionId);

      expect(branch1).toBe(true);
      expect(branch2).toBe(true);

      // Verify both step executions completed under their respective assigned resources
      const step1 = (await db.query("SELECT * FROM execution.step_executions WHERE id = $1;", [collabResult.branches[0].stepExecutionId])).rows[0];
      const step2 = (await db.query("SELECT * FROM execution.step_executions WHERE id = $1;", [collabResult.branches[1].stepExecutionId])).rows[0];

      expect(step1.status).toBe("completed");
      expect(step2.status).toBe("completed");
      expect(step1.resource_id).toBe(resGen);
      expect(step2.resource_id).toBe(resCritic);
    });
  });
});

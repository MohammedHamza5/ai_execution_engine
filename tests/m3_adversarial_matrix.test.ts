import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { db } from "../src/db/client.js";
import { executionEngine } from "../src/engine/executionEngine.js";
import { collaborationService } from "../src/engine/collaborationService.js";
import { resourceIntelligence, SelectedResource } from "../src/resources/resourceIntelligence.js";
import { ExecutionWorker } from "../src/engine/worker.js";
import { GeminiProviderAdapter } from "../src/adapters/geminiAdapter.js";
import { ProviderErrorCode } from "../src/adapters/types.js";
import { ensureDefaultTenant } from "../src/api/routes/tasks.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";

describe("M3 Batch D — Adversarial Stress, Concurrency & Hardening Matrix", () => {
  let tenantId: string;
  let baseResourceId: string;
  let altResourceId: string;
  let adapter: GeminiProviderAdapter;

  beforeAll(async () => {
    tenantId = await ensureDefaultTenant();
    baseResourceId = await resourceIntelligence.ensureBaseResource();

    // Register a free alternative resource
    altResourceId = await resourceIntelligence.registerResource({
      providerSlug: "gemini",
      providerName: "Google DeepMind",
      modelSlug: "gemini-1.5-pro",
      modelName: "Gemini 1.5 Pro",
      status: "active",
      priority: 25,
      isPaid: false,
      capabilities: ["text", "code"],
    });

    adapter = new GeminiProviderAdapter();
  });

  beforeEach(async () => {
    adapter.resetSimulation();
  });

  describe("Task M3.11: High Concurrency Stress & Branch Migration Isolation", () => {
    it("Stress: 6 parallel branches executed concurrently across 3 workers without deadlocks or duplicate claims", async () => {
      const taskResult = await executionEngine.createCollaborationTask({
        tenantId,
        taskType: "high_concurrency_stress",
        objective: "Stress test 6 parallel branches across concurrent workers",
        strategy: "parallel_specialist",
        completionPolicy: { type: "ALL_REQUIRED" },
        branches: [
          { branchKey: "b1", role: "specialist", resourceId: baseResourceId },
          { branchKey: "b2", role: "specialist", resourceId: altResourceId },
          { branchKey: "b3", role: "specialist", resourceId: baseResourceId },
          { branchKey: "b4", role: "specialist", resourceId: altResourceId },
          { branchKey: "b5", role: "specialist", resourceId: baseResourceId },
          { branchKey: "b6", role: "specialist", resourceId: altResourceId },
        ],
        inputPayload: {
          prompt: "Execute specialist analysis step",
        },
      });

      const worker1 = new ExecutionWorker(generateUUIDv7(), adapter);
      const worker2 = new ExecutionWorker(generateUUIDv7(), adapter);
      const worker3 = new ExecutionWorker(generateUUIDv7(), adapter);

      // Execute all 6 branches concurrently in 2 batches of 3
      const stepIds = taskResult.branches.map((b) => b.stepExecutionId);
      const batch1 = await Promise.all([
        worker1.claimAndExecuteNext(stepIds[0]),
        worker2.claimAndExecuteNext(stepIds[1]),
        worker3.claimAndExecuteNext(stepIds[2]),
      ]);

      const batch2 = await Promise.all([
        worker1.claimAndExecuteNext(stepIds[3]),
        worker2.claimAndExecuteNext(stepIds[4]),
        worker3.claimAndExecuteNext(stepIds[5]),
      ]);

      expect(batch1).toEqual([true, true, true]);
      expect(batch2).toEqual([true, true, true]);

      // Verify all 6 branches completed with distinct artifacts
      const branches = await collaborationService.getCollaborationBranches(taskResult.collaborationRunId);
      expect(branches).toHaveLength(6);
      expect(branches.every((b) => b.status === "completed")).toBe(true);

      const artifactIds = new Set(branches.map((b) => b.outputArtifactId));
      expect(artifactIds.size).toBe(6);

      // Policy progress must be satisfied
      const progress = await collaborationService.evaluateRunProgress(taskResult.collaborationRunId);
      expect(progress.isSatisfied).toBe(true);
      expect(progress.completedCount).toBe(6);
    });

    it("Branch Migration Isolation: Branch 1 migrates on QUOTA_EXHAUSTED while Branch 2 succeeds on Attempt 1", async () => {
      // Injects deterministic fault specifically on baseResourceId
      adapter.setResourceFault(baseResourceId, ProviderErrorCode.QUOTA_EXHAUSTED);

      const taskResult = await executionEngine.createCollaborationTask({
        tenantId,
        taskType: "branch_migration_isolation",
        objective: "Verify migration of single branch preserves collaboration integrity",
        strategy: "parallel_generation",
        completionPolicy: { type: "ALL_REQUIRED" },
        branches: [
          { branchKey: "branch_migrating", role: "generator", resourceId: baseResourceId },
          { branchKey: "branch_healthy", role: "generator", resourceId: altResourceId },
        ],
        inputPayload: {
          prompt: "Generate resilient computation",
        },
      });

      const worker = new ExecutionWorker(generateUUIDv7(), adapter);
      const bMigrating = taskResult.branches.find((b) => b.branchKey === "branch_migrating")!;
      const bHealthy = taskResult.branches.find((b) => b.branchKey === "branch_healthy")!;

      // Execute Branch 1 -> Suffers QUOTA_EXHAUSTED on Attempt 1, Migrates to altResourceId on Attempt 2, Succeeds
      const res1 = await worker.claimAndExecuteNext(bMigrating.stepExecutionId);
      expect(res1).toBe(true);

      // Execute Branch 2 -> Succeeds on Attempt 1
      const res2 = await worker.claimAndExecuteNext(bHealthy.stepExecutionId);
      expect(res2).toBe(true);

      // Verify attempts for Branch 1 (Must have Attempt 1 failed + Attempt 2 success)
      const attemptsMigrating = await db.query(
        `SELECT attempt_number, status, resource_id FROM execution.execution_attempts
         WHERE step_execution_id = $1 ORDER BY attempt_number ASC;`,
        [bMigrating.stepExecutionId]
      );
      expect(attemptsMigrating.rows).toHaveLength(2);
      expect(attemptsMigrating.rows[0].attempt_number).toBe(1);
      expect(attemptsMigrating.rows[0].status).toBe("failed");
      expect(attemptsMigrating.rows[1].attempt_number).toBe(2);
      expect(attemptsMigrating.rows[1].status).toBe("success");
      expect(attemptsMigrating.rows[1].resource_id).not.toBe(baseResourceId);

      // Verify attempts for Branch 2 (Must have only 1 attempt)
      const attemptsHealthy = await db.query(
        `SELECT attempt_number, status FROM execution.execution_attempts
         WHERE step_execution_id = $1;`,
        [bHealthy.stepExecutionId]
      );
      expect(attemptsHealthy.rows).toHaveLength(1);
      expect(attemptsHealthy.rows[0].status).toBe("success");

      // Verify overall collaboration run progress is satisfied
      const progress = await collaborationService.evaluateRunProgress(taskResult.collaborationRunId);
      expect(progress.isSatisfied).toBe(true);
      expect(progress.completedCount).toBe(2);
    });

    it("Policy Invariant: ALL_REQUIRED strictly fails when unrecoverable branch error occurs", async () => {
      const taskResult = await executionEngine.createCollaborationTask({
        tenantId,
        taskType: "all_required_failure",
        objective: "Verify ALL_REQUIRED policy rejects partial completion",
        strategy: "parallel_generation",
        completionPolicy: { type: "ALL_REQUIRED" },
        branches: [
          { branchKey: "branch_ok", role: "generator", resourceId: baseResourceId },
          { branchKey: "branch_err", role: "generator", resourceId: altResourceId },
        ],
        inputPayload: {
          prompt: "Generate output",
          branches: {
            branch_err: {
              simulationFault: "AUTHENTICATION", // Non-recoverable error
            },
          },
        },
      });

      const worker = new ExecutionWorker(generateUUIDv7(), adapter);
      const bOk = taskResult.branches.find((b) => b.branchKey === "branch_ok")!;
      const bErr = taskResult.branches.find((b) => b.branchKey === "branch_err")!;

      await worker.claimAndExecuteNext(bOk.stepExecutionId);
      await worker.claimAndExecuteNext(bErr.stepExecutionId);

      const branches = await collaborationService.getCollaborationBranches(taskResult.collaborationRunId);
      const okStatus = branches.find((b) => b.branchKey === "branch_ok")?.status;
      const errStatus = branches.find((b) => b.branchKey === "branch_err")?.status;

      expect(okStatus).toBe("completed");
      expect(errStatus).toBe("failed");

      // ALL_REQUIRED evaluation must strictly be unsatisfied
      const progress = await collaborationService.evaluateRunProgress(taskResult.collaborationRunId);
      expect(progress.isSatisfied).toBe(false);
      expect(progress.canProceedToSynthesis).toBe(false);
      expect(progress.failedCount).toBe(1);
      expect(progress.completedCount).toBe(1);
    });
  });

  describe("Task M3.12: Hardening Guards (Economic & Truth Safety)", () => {
    it("Hardening Guard 1: Zero Silent Paid Spend — branch refuses paid resource migration when allowPaid = false", async () => {
      // Register a paid resource
      const paidResourceId = await resourceIntelligence.registerResource({
        providerSlug: "gemini",
        providerName: "Google DeepMind",
        modelSlug: "gemini-1.5-pro-paid",
        modelName: "Gemini 1.5 Pro Paid",
        status: "active",
        priority: 100, // Highest priority
        isPaid: true,
        tier: "paid",
        credentialType: "paid",
        capabilities: ["text", "code"],
      });

      // Temporarily disable all other resources to leave only baseResourceId (free) and paidResourceId
      await db.query(`UPDATE resources.resources SET status = 'disabled' WHERE id NOT IN ($1, $2);`, [baseResourceId, paidResourceId]);

      try {
        const taskResult = await executionEngine.createCollaborationTask({
          tenantId,
          taskType: "economic_guard_test",
          objective: "Ensure paid resource is not silently used without permission",
          strategy: "parallel_generation",
          completionPolicy: { type: "ALL_REQUIRED" },
          branches: [
            { branchKey: "branch_free_only", role: "generator", resourceId: baseResourceId },
          ],
          policy: {
            allowPaid: false, // Strict zero silent spend!
          },
          inputPayload: {
            prompt: "Test paid guard",
            simulationFault: "QUOTA_EXHAUSTED", // Exhaust baseResourceId
          },
        });

        const worker = new ExecutionWorker(generateUUIDv7(), adapter);
        const executed = await worker.claimAndExecuteNext(taskResult.branches[0].stepExecutionId);

        // Worker must fail execution because NO_ELIGIBLE_RESOURCE matches allowPaid: false
        expect(executed).toBe(false);

        const branch = await collaborationService.getBranchByStepExecutionId(taskResult.branches[0].stepExecutionId);
        expect(branch?.status).toBe("failed");
        expect(branch?.errorMessage).toContain("NO_ELIGIBLE_RESOURCE");
      } finally {
        // Restore all resources and cleanup paidResourceId
        await db.query(`UPDATE resources.resources SET status = 'active' WHERE id != $1;`, [paidResourceId]);
        await db.query(`DELETE FROM resources.resources WHERE id = $1;`, [paidResourceId]);
      }
    });

    it("Hardening Guard 2: Monotonic Fencing Protection — rejects stale worker late write on collaboration branch", async () => {
      const taskResult = await executionEngine.createCollaborationTask({
        tenantId,
        taskType: "fencing_guard_test",
        objective: "Test stale worker rejection on branch",
        strategy: "parallel_generation",
        completionPolicy: { type: "ALL_REQUIRED" },
        branches: [
          { branchKey: "fenced_branch", role: "generator", resourceId: baseResourceId },
        ],
      });

      const branchStepId = taskResult.branches[0].stepExecutionId;

      // Simulate Worker 1 claims with fencing_token = 1
      await db.query(
        `UPDATE execution.step_executions
         SET status = 'running', fencing_token = 1, lease_expires_at = now() - interval '10 seconds'
         WHERE id = $1;`,
        [branchStepId]
      );

      // Simulate Worker 2 takes over expired lease with fencing_token = 2
      await db.query(
        `UPDATE execution.step_executions
         SET status = 'running', fencing_token = 2, lease_expires_at = now() + interval '30 seconds'
         WHERE id = $1;`,
        [branchStepId]
      );

      // Worker 1 tries to commit with stale fencing_token 1 -> MUST throw STALE_WORKER_COMMIT_REJECTED
      await expect(
        executionEngine.commitAttemptSuccess({
          stepExecutionId: branchStepId,
          executionId: taskResult.executionId,
          taskId: taskResult.taskId,
          tenantId,
          attemptId: generateUUIDv7(),
          fencingToken: 1, // STALE! Current is 2
          response: {
            outputText: "Stale zombie output",
            usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
            latencyMs: 100,
          },
        })
      ).rejects.toThrow("STALE_WORKER_COMMIT_REJECTED");
    });
  });
});

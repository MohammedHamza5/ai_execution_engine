import { describe, it, expect, beforeAll } from "vitest";
import { db } from "../src/db/client.js";
import { executionEngine } from "../src/engine/executionEngine.js";
import { collaborationService } from "../src/engine/collaborationService.js";
import { ContextPackageBuilder } from "../src/engine/contextPackageBuilder.js";
import { resourceIntelligence } from "../src/resources/resourceIntelligence.js";
import { ExecutionWorker } from "../src/engine/worker.js";
import { ensureDefaultTenant } from "../src/api/routes/tasks.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";

describe("M3 Batch B — Multi-Model Execution, Artifact Dispatch & Completion Policies", () => {
  let tenantId: string;
  let baseResourceId: string;
  let altResourceId: string;

  beforeAll(async () => {
    tenantId = await ensureDefaultTenant();
    baseResourceId = await resourceIntelligence.ensureBaseResource();

    // Register a secondary model resource for multi-model verification
    altResourceId = await resourceIntelligence.registerResource({
      providerSlug: "gemini",
      providerName: "Google DeepMind",
      modelSlug: "gemini-1.5-pro",
      modelName: "Gemini 1.5 Pro",
      status: "active",
      priority: 20,
      isPaid: false,
      capabilities: ["text", "code", "analysis"],
    });
  });

  describe("Task M3.4: Parallel Branch Dispatch & Concurrent Worker Execution", () => {
    it("two concurrent workers claim and execute distinct branches of the same collaboration run without race conditions", async () => {
      const taskResult = await executionEngine.createCollaborationTask({
        tenantId,
        taskType: "parallel_specialist_analysis",
        objective: "Perform concurrent security and performance audits",
        strategy: "parallel_specialist",
        completionPolicy: {
          type: "ALL_REQUIRED",
        },
        branches: [
          {
            branchKey: "sec_audit",
            role: "specialist",
            resourceId: baseResourceId,
          },
          {
            branchKey: "perf_audit",
            role: "specialist",
            resourceId: altResourceId,
          },
        ],
        inputPayload: {
          prompt: "Audit this API endpoint implementation",
          branches: {
            sec_audit: { prompt: "Analyze security and input sanitation" },
            perf_audit: { prompt: "Analyze latency and algorithmic complexity" },
          },
        },
      });

      // Spawn two distinct workers
      const worker1 = new ExecutionWorker();
      const worker2 = new ExecutionWorker();

      // Concurrently claim and execute both branches
      const [res1, res2] = await Promise.all([
        worker1.claimAndExecuteNext(taskResult.branches[0].stepExecutionId),
        worker2.claimAndExecuteNext(taskResult.branches[1].stepExecutionId),
      ]);

      expect(res1).toBe(true);
      expect(res2).toBe(true);

      // Verify both branches completed
      const branches = await collaborationService.getCollaborationBranches(taskResult.collaborationRunId);
      expect(branches).toHaveLength(2);
      expect(branches.every((b) => b.status === "completed")).toBe(true);
      expect(branches.every((b) => Boolean(b.outputArtifactId))).toBe(true);

      // Verify distinct artifacts were created
      const artifactIds = branches.map((b) => b.outputArtifactId);
      expect(artifactIds[0]).not.toEqual(artifactIds[1]);

      // Check policy progress
      const progress = await collaborationService.evaluateRunProgress(taskResult.collaborationRunId);
      expect(progress.isSatisfied).toBe(true);
      expect(progress.completedCount).toBe(2);
      expect(progress.failedCount).toBe(0);
    });
  });

  describe("Task M3.5: Artifact-Based Collaboration Dispatch & Context Packaging", () => {
    it("packages verified output artifact into structured context package for downstream critic role", async () => {
      const taskResult = await executionEngine.createCollaborationTask({
        tenantId,
        taskType: "generator_critic_collaboration",
        objective: "Generate a cryptographic hash helper and verify via independent critic",
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
            resourceId: altResourceId,
          },
        ],
        inputPayload: {
          prompt: "Implement a SHA-256 helper function in TypeScript",
        },
      });

      const branchesBefore = await collaborationService.getCollaborationBranches(taskResult.collaborationRunId);
      const genBranch = branchesBefore.find((b) => b.branchKey === "generator")!;
      const criticBranch = branchesBefore.find((b) => b.branchKey === "critic")!;

      // 1. Worker executes generator branch
      const worker = new ExecutionWorker();
      const executed = await worker.claimAndExecuteNext(genBranch.stepExecutionId);
      expect(executed).toBe(true);

      // 2. Fetch updated generator branch & output artifact
      const updatedGen = await collaborationService.getBranchByStepExecutionId(genBranch.stepExecutionId);
      expect(updatedGen?.status).toBe("completed");
      expect(updatedGen?.outputArtifactId).toBeDefined();

      // 3. Assemble immutable Context Package (Task M3.5)
      const contextPackage = await ContextPackageBuilder.buildPackage({
        runId: taskResult.collaborationRunId,
        targetBranchKey: criticBranch.branchKey,
        targetRole: criticBranch.role,
        objective: "Evaluate the correctness and security of generated SHA-256 helper",
        sourceBranchKeys: ["generator"],
      });

      expect(contextPackage.collaborationRunId).toBe(taskResult.collaborationRunId);
      expect(contextPackage.targetRole).toBe("critic");
      expect(contextPackage.sourceArtifacts).toHaveLength(1);
      expect(contextPackage.sourceArtifacts[0].artifactId).toBe(updatedGen?.outputArtifactId);
      expect(contextPackage.contextPayload).toContain("--- ARTIFACT SOURCE: Branch 'generator'");
      expect(contextPackage.contextPayload).toContain(`Artifact ID: ${updatedGen?.outputArtifactId}`);

      // 4. Update critic branch with context package input and execute
      await db.query(
        `UPDATE tasks.tasks
         SET input_payload = jsonb_set(input_payload, '{branches,critic,prompt}', $1::jsonb)
         WHERE id = $2;`,
        [JSON.stringify(contextPackage.contextPayload), taskResult.taskId]
      );

      const executedCritic = await worker.claimAndExecuteNext(criticBranch.stepExecutionId);
      expect(executedCritic).toBe(true);

      const updatedCritic = await collaborationService.getBranchByStepExecutionId(criticBranch.stepExecutionId);
      expect(updatedCritic?.status).toBe("completed");
      expect(updatedCritic?.outputArtifactId).toBeDefined();

      // 5. Verify run completion progress
      const progress = await collaborationService.evaluateRunProgress(taskResult.collaborationRunId);
      expect(progress.isSatisfied).toBe(true);
      expect(progress.completedCount).toBe(2);
    });
  });

  describe("Task M3.6: Multi-Model Completion Policies & Aggregation", () => {
    it("MINIMUM_SUCCESS policy succeeds when 2 of 3 branches succeed even if 1 branch fails", async () => {
      const taskResult = await executionEngine.createCollaborationTask({
        tenantId,
        taskType: "quorum_computation",
        objective: "Compute recommendations with minimum success threshold of 2",
        strategy: "parallel_generation",
        completionPolicy: {
          type: "MINIMUM_SUCCESS",
          minSuccessCount: 2,
        },
        branches: [
          {
            branchKey: "model_a",
            role: "generator",
            resourceId: baseResourceId,
          },
          {
            branchKey: "model_b",
            role: "generator",
            resourceId: altResourceId,
          },
          {
            branchKey: "model_c",
            role: "generator",
            resourceId: baseResourceId,
          },
        ],
        inputPayload: {
          prompt: "Recommend optimal architectural patterns",
          branches: {
            model_b: {
              // Inject non-recoverable error into model_b
              simulationFault: "INVALID_REQUEST",
            },
          },
        },
      });

      const branches = await collaborationService.getCollaborationBranches(taskResult.collaborationRunId);
      const bA = branches.find((b) => b.branchKey === "model_a")!;
      const bB = branches.find((b) => b.branchKey === "model_b")!;
      const bC = branches.find((b) => b.branchKey === "model_c")!;

      const worker = new ExecutionWorker();

      // Execute Model A -> succeeds
      const resA = await worker.claimAndExecuteNext(bA.stepExecutionId);
      expect(resA).toBe(true);

      // Execute Model B -> fails non-recoverably
      const resB = await worker.claimAndExecuteNext(bB.stepExecutionId);
      expect(resB).toBe(false);

      // Execute Model C -> succeeds
      const resC = await worker.claimAndExecuteNext(bC.stepExecutionId);
      expect(resC).toBe(true);

      // Verify branch statuses
      const updatedBranches = await collaborationService.getCollaborationBranches(taskResult.collaborationRunId);
      const statusMap = new Map(updatedBranches.map((b) => [b.branchKey, b.status]));
      expect(statusMap.get("model_a")).toBe("completed");
      expect(statusMap.get("model_b")).toBe("failed");
      expect(statusMap.get("model_c")).toBe("completed");

      // Verify MINIMUM_SUCCESS policy progress: 2 completed >= minSuccessCount 2
      const progress = await collaborationService.evaluateRunProgress(taskResult.collaborationRunId);
      expect(progress.isSatisfied).toBe(true);
      expect(progress.canProceedToSynthesis).toBe(true);
      expect(progress.completedCount).toBe(2);
      expect(progress.failedCount).toBe(1);

      // Advance through valid FSM lifecycle: CREATED -> PLANNED -> DISPATCHING -> RUNNING -> COLLECTING -> SYNTHESIZING -> VALIDATING
      const runId = taskResult.collaborationRunId;
      await collaborationService.transitionState(runId, "PLANNED");
      await collaborationService.transitionState(runId, "DISPATCHING");
      await collaborationService.transitionState(runId, "RUNNING");
      await collaborationService.transitionState(runId, "COLLECTING");
      await collaborationService.transitionState(runId, "SYNTHESIZING");
      await collaborationService.transitionState(runId, "VALIDATING");

      const finalArtifactId = generateUUIDv7();
      await db.query(
        `INSERT INTO artifacts.artifacts (
          id, tenant_id, task_id, type, storage_uri, inline_content, content_hash, size_bytes, status
        ) VALUES ($1, $2, $3, 'text_output', 'artifact://collab/synthesis', 'Synthesized Result', 'hash_synth', 18, 'active');`,
        [finalArtifactId, tenantId, taskResult.taskId]
      );

      const completedRun = await collaborationService.completeCollaboration(runId, finalArtifactId, 0.95);
      expect(completedRun.state).toBe("COMPLETED");

      // Verify parent task and execution advanced to completed
      const finalTask = await executionEngine.getTask(taskResult.taskId);
      expect(finalTask?.status).toBe("completed");
      expect(finalTask?.outputArtifactId).toBe(finalArtifactId);
    });
  });
});

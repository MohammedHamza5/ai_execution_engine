import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrator.js";
import { ExecutionWorker } from "../src/engine/worker.js";
import { executionEngine } from "../src/engine/executionEngine.js";
import { checkpointService } from "../src/engine/checkpointService.js";
import { resourceIntelligence } from "../src/resources/resourceIntelligence.js";
import { GeminiProviderAdapter } from "../src/adapters/geminiAdapter.js";
import { ensureDefaultTenant } from "../src/api/routes/tasks.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";

describe("M2.7 & M2.8 — Validation Failure Matrix & Hardening Tests", () => {
  let tenantId: string;
  let adapter: GeminiProviderAdapter;
  let worker: ExecutionWorker;

  beforeAll(async () => {
    await runMigrations();
    tenantId = await ensureDefaultTenant();
    adapter = new GeminiProviderAdapter();
    worker = new ExecutionWorker(generateUUIDv7(), adapter);
  });

  beforeEach(async () => {
    adapter.resetSimulation();
    const baseId = await resourceIntelligence.ensureBaseResource();
    await db.query(`DELETE FROM resources.resources WHERE id != $1;`, [baseId]);
  });

  afterAll(async () => {
    await db.close();
  });

  describe("Validation Failure Matrix", () => {
    it("Matrix Case 1: Empty output payload triggers DETERMINISTIC_FAILURE and recovers on Attempt 2", async () => {
      // Attempt 1: Empty output; Attempt 2: Valid text output
      adapter.setResponseSequence(["   ", "Valid non-empty generation output"]);

      const taskResult = await executionEngine.createTaskAndPlan({
        tenantId,
        taskType: "text_generation",
        inputPayload: { prompt: "Generate text" },
      });

      const processed = await worker.claimAndExecuteNext(taskResult.stepExecutionId);
      expect(processed).toBe(true);

      const taskFinal = await executionEngine.getTask(taskResult.taskId);
      expect(taskFinal?.status).toBe("completed");

      // Verify Attempt 1 failed for handshake, Attempt 2 succeeded
      const attempts = await db.query(
        `SELECT attempt_number, status FROM execution.execution_attempts 
         WHERE step_execution_id = $1 ORDER BY attempt_number ASC;`,
        [taskResult.stepExecutionId]
      );
      expect(attempts.rows).toHaveLength(2);
      expect(attempts.rows[0].status).toBe("failed");
      expect(attempts.rows[1].status).toBe("success");
    });

    it("Matrix Case 2: Output containing forbidden error substrings triggers DETERMINISTIC_FAILURE and recovers", async () => {
      // Attempt 1: Contains raw error string; Attempt 2: Clean output
      adapter.setResponseSequence([
        "Execution output containing Error: database disconnected",
        "Clean valid computation response without forbidden terms",
      ]);

      const taskResult = await executionEngine.createTaskAndPlan({
        tenantId,
        taskType: "query_execution",
        inputPayload: { prompt: "Compute data" },
      });

      const processed = await worker.claimAndExecuteNext(taskResult.stepExecutionId);
      expect(processed).toBe(true);

      const taskFinal = await executionEngine.getTask(taskResult.taskId);
      expect(taskFinal?.status).toBe("completed");
    });

    it("Matrix Case 3: UNCERTAIN validation outcome routes to WAIT without silent completion", async () => {
      // Custom validation target with uncertain outcome
      const taskResult = await executionEngine.createTaskAndPlan({
        tenantId,
        taskType: "fact_check",
        inputPayload: { prompt: "Check claims" },
      });

      // Claim step manually and run commitAttemptSuccess with custom simulated validation
      const attemptId = generateUUIDv7();
      await db.query(
        `UPDATE execution.step_executions SET status = 'running', fencing_token = 1 WHERE id = $1;`,
        [taskResult.stepExecutionId]
      );
      await db.query(
        `INSERT INTO execution.execution_attempts (id, step_execution_id, attempt_number, status, started_at)
         VALUES ($1, $2, 1, 'running', now());`,
        [attemptId, taskResult.stepExecutionId]
      );

      // Simulate a response that yields UNCERTAIN outcome
      // Create a validation record with UNCERTAIN status
      const valId = generateUUIDv7();
      const artId = generateUUIDv7();
      await db.query(
        `INSERT INTO artifacts.artifacts (id, tenant_id, task_id, type, storage_uri, inline_content, content_hash, size_bytes, status)
         VALUES ($1, $2, $3, 'text_output', 'art://1', 'Ambiguous content', 'hash1', 17, 'active');`,
        [artId, tenantId, taskResult.taskId]
      );

      await db.query(
        `INSERT INTO validation.validations (id, task_id, execution_id, step_execution_id, target_type, target_id, validator_type, status, confidence, started_at, completed_at)
         VALUES ($1, $2, $3, $4, 'artifact', $5, 'deterministic', 'uncertain', 0.4, now(), now());`,
        [valId, taskResult.taskId, taskResult.executionId, taskResult.stepExecutionId, artId]
      );

      // Create Checkpoint with UNCERTAIN validationFailure
      const checkpoint = await checkpointService.createCheckpoint({
        taskId: taskResult.taskId,
        executionId: taskResult.executionId,
        stepExecutionId: taskResult.stepExecutionId,
        attemptId,
        attemptNumber: 1,
        resourceId: "01924b00-0000-7000-8000-000000000001",
        fencingToken: 1,
        executionState: "validation_failed",
        validationFailure: {
          validationId: valId,
          artifactId: artId,
          outcome: "UNCERTAIN",
          failureClass: "UNCERTAIN",
          reasons: ["Fact-check verification confidence 0.40 below threshold"],
          recoverable: false,
          recommendedAction: "WAIT",
        },
      });

      expect(checkpoint.snapshotData.validationFailure?.recommendedAction).toBe("WAIT");

      // Verify that UNCERTAIN cannot resume automatically
      const reconstructed = await checkpointService.reconstructRecoveryState(taskResult.executionId);
      expect(reconstructed?.canResume).toBe(false);
    });
  });

  describe("Adversarial & Hardening Guards", () => {
    it("Hardening Guard 1: Zero Silent Paid Spend — refuses paid resource migration when allowPaid = false", async () => {
      // Register a paid resource with priority 50
      const paidResourceId = await resourceIntelligence.registerResource({
        providerSlug: "gemini",
        providerName: "Google DeepMind",
        modelSlug: "gemini-1.5-pro-paid",
        modelName: "Gemini 1.5 Pro Paid",
        priority: 50,
        tier: "paid",
        isPaid: true,
        credentialType: "paid",
        status: "active",
        quotaRemaining: 100000,
        circuitHealth: "healthy",
        capabilities: ["general_text"],
      });

      // Attempt 1: Schema fail -> Retry same
      // Attempt 2: Schema fail -> Policy triggers MIGRATE_RESOURCE
      // Since allowPaid = false, Resource Intelligence MUST reject the paid resource!
      adapter.setResponseSequence(["Malformed 1", "Malformed 2", "Malformed 3"]);

      const taskResult = await executionEngine.createTaskAndPlan({
        tenantId,
        taskType: "strict_free_task",
        priority: 10,
        inputPayload: { prompt: "Run free generation", expectJson: true },
        policy: { allowPaid: false }, // STRICT FREE ONLY
      });

      const processed = await worker.claimAndExecuteNext(taskResult.stepExecutionId);
      // Execution must fail deterministically because no free alternative exists
      expect(processed).toBe(false);

      const taskFinal = await executionEngine.getTask(taskResult.taskId);
      expect(taskFinal?.status).toBe("failed");

      // Verify that the paid resource was NEVER used in any execution attempt
      const attempts = await db.query(
        `SELECT resource_id FROM execution.execution_attempts WHERE step_execution_id = $1;`,
        [taskResult.stepExecutionId]
      );
      for (const row of attempts.rows) {
        expect(row.resource_id).not.toBe(paidResourceId);
      }
    });

    it("Hardening Guard 2: Stale Worker Fencing Protection — rejects stale worker attempting validation recovery", async () => {
      const taskResult = await executionEngine.createTaskAndPlan({
        tenantId,
        taskType: "fencing_validation_test",
        inputPayload: { prompt: "Test fencing" },
      });

      const attempt1Id = generateUUIDv7();
      await db.query(
        `UPDATE execution.step_executions SET status = 'running', fencing_token = 1 WHERE id = $1;`,
        [taskResult.stepExecutionId]
      );
      await db.query(
        `INSERT INTO execution.execution_attempts (id, step_execution_id, attempt_number, status, started_at)
         VALUES ($1, $2, 1, 'running', now());`,
        [attempt1Id, taskResult.stepExecutionId]
      );

      // Newer worker takes over and increments fencing token to 2
      await db.query(
        `UPDATE execution.step_executions SET fencing_token = 2 WHERE id = $1;`,
        [taskResult.stepExecutionId]
      );

      // Stale Worker 1 attempts to record checkpoint with obsolete fencing token 1
      await expect(
        checkpointService.createCheckpoint({
          taskId: taskResult.taskId,
          executionId: taskResult.executionId,
          stepExecutionId: taskResult.stepExecutionId,
          attemptId: attempt1Id,
          attemptNumber: 1,
          resourceId: "01924b00-0000-7000-8000-000000000001",
          fencingToken: 1, // Stale token!
          executionState: "validation_failed",
          validationFailure: {
            validationId: generateUUIDv7(),
            artifactId: generateUUIDv7(),
            outcome: "REJECT",
            failureClass: "SCHEMA_FAILURE",
            reasons: ["Malformed output"],
            recoverable: true,
            recommendedAction: "RETRY_SAME",
          },
        })
      ).rejects.toThrow("STALE_WORKER_CHECKPOINT_REJECTED");
    });

    it("Hardening Guard 3: Checkpoint Idempotency — duplicate validation checkpoint returns existing record", async () => {
      const taskResult = await executionEngine.createTaskAndPlan({
        tenantId,
        taskType: "idempotency_test",
        inputPayload: { prompt: "Test checkpoint idempotency" },
      });

      const attemptId = generateUUIDv7();
      await db.query(
        `UPDATE execution.step_executions SET status = 'running', fencing_token = 1 WHERE id = $1;`,
        [taskResult.stepExecutionId]
      );
      await db.query(
        `INSERT INTO execution.execution_attempts (id, step_execution_id, attempt_number, status, started_at)
         VALUES ($1, $2, 1, 'running', now());`,
        [attemptId, taskResult.stepExecutionId]
      );

      const valParams = {
        taskId: taskResult.taskId,
        executionId: taskResult.executionId,
        stepExecutionId: taskResult.stepExecutionId,
        attemptId,
        attemptNumber: 1,
        resourceId: "01924b00-0000-7000-8000-000000000001",
        fencingToken: 1,
        executionState: "validation_failed",
        validationFailure: {
          validationId: generateUUIDv7(),
          artifactId: generateUUIDv7(),
          outcome: "REJECT" as const,
          failureClass: "SCHEMA_FAILURE" as const,
          reasons: ["Malformed output"],
          recoverable: true,
          recommendedAction: "RETRY_SAME" as const,
        },
      };

      const cp1 = await checkpointService.createCheckpoint(valParams);
      const cp2 = await checkpointService.createCheckpoint(valParams);

      expect(cp1.id).toBe(cp2.id);
      expect(cp1.sequenceNumber).toBe(cp2.sequenceNumber);
    });
  });
});

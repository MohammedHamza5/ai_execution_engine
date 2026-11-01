import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrator.js";
import { executionEngine } from "../src/engine/executionEngine.js";
import { checkpointService } from "../src/engine/checkpointService.js";
import { ValidationOutcomeNormalizer } from "../src/engine/validationOutcome.js";
import { ValidationDiagnosisEngine } from "../src/engine/validationDiagnosis.js";
import { ensureDefaultTenant } from "../src/api/routes/tasks.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";

describe("M2.3 — Validation Failure Persistence & Traceability", () => {
  let tenantId: string;

  beforeAll(async () => {
    await runMigrations();
    tenantId = await ensureDefaultTenant();
  });

  afterAll(async () => {
    await db.close();
  });

  it("persists rejected artifact and failure validation records with immutable lineage", async () => {
    const taskRes = await executionEngine.createTaskAndPlan({
      tenantId,
      taskType: "code_generation",
      priority: 5,
      inputPayload: { prompt: "Generate JSON", expectJson: true },
    });

    const attempt1Id = generateUUIDv7();

    // Insert Attempt 1 row
    await db.query(
      `INSERT INTO execution.execution_attempts (
        id, step_execution_id, attempt_number, status, started_at
      ) VALUES ($1, $2, 1, 'running', now());`,
      [attempt1Id, taskRes.stepExecutionId]
    );

    // Commit Attempt 1 with invalid JSON output (Malformed JSON)
    const commitAttempt1 = await executionEngine.commitAttemptSuccess({
      stepExecutionId: taskRes.stepExecutionId,
      executionId: taskRes.executionId,
      taskId: taskRes.taskId,
      tenantId,
      attemptId: attempt1Id,
      fencingToken: 0,
      response: {
        outputText: "Malformed non-JSON output",
        model: "gemini-2.5-flash",
        finishReason: "stop",
        usage: { promptTokens: 10, outputTokens: 20, totalTokens: 30 },
        latencyMs: 120,
      },
      expectedOutputJson: true,
    });

    expect(commitAttempt1.validationPassed).toBe(false);
    expect(commitAttempt1.artifactId).toBeDefined();
    expect(commitAttempt1.validationId).toBeDefined();

    // Verify Attempt 1 record in execution_attempts was marked as failed
    const attempt1Row = await db.query(
      `SELECT status FROM execution.execution_attempts WHERE id = $1;`,
      [attempt1Id]
    );
    expect(attempt1Row.rows[0].status).toBe("failed");

    // Verify artifact is durable
    const art1Row = await db.query(
      `SELECT id, inline_content, status FROM artifacts.artifacts WHERE id = $1;`,
      [commitAttempt1.artifactId]
    );
    expect(art1Row.rows[0].id).toBe(commitAttempt1.artifactId);
    expect(art1Row.rows[0].inline_content).toBe("Malformed non-JSON output");
    expect(art1Row.rows[0].status).toBe("active");

    // Verify validation record links to artifact and step execution
    const valRow = await db.query(
      `SELECT id, target_id, step_execution_id, status FROM validation.validations WHERE id = $1;`,
      [commitAttempt1.validationId]
    );
    expect(valRow.rows[0].target_id).toBe(commitAttempt1.artifactId);
    expect(valRow.rows[0].step_execution_id).toBe(taskRes.stepExecutionId);
    expect(valRow.rows[0].status).toBe("failed");

    // Verify individual rule results
    const resultsRows = await db.query(
      `SELECT status, details FROM validation.validation_results WHERE validation_id = $1;`,
      [commitAttempt1.validationId]
    );
    expect(resultsRows.rows.some((r) => r.status === "fail")).toBe(true);

    // Diagnose and record durable checkpoint
    const normalized = ValidationOutcomeNormalizer.normalize(commitAttempt1.decision);
    const diagnosis = ValidationDiagnosisEngine.diagnose({
      validationId: commitAttempt1.validationId,
      artifactId: commitAttempt1.artifactId,
      normalizedOutcome: normalized,
      attemptNumber: 1,
    });

    const checkpoint = await checkpointService.createCheckpoint({
      taskId: taskRes.taskId,
      executionId: taskRes.executionId,
      stepExecutionId: taskRes.stepExecutionId,
      attemptId: attempt1Id,
      attemptNumber: 1,
      resourceId: "01924b00-0000-7000-8000-000000000001",
      fencingToken: 0,
      executionState: "diagnosing",
      validationFailure: {
        validationId: commitAttempt1.validationId,
        artifactId: commitAttempt1.artifactId,
        outcome: diagnosis.outcome,
        failureClass: diagnosis.failureClass,
        reasons: diagnosis.reasons,
        recoverable: diagnosis.recoverable,
        recommendedAction: diagnosis.recommendedAction,
      },
      completedArtifactIds: [commitAttempt1.artifactId],
    });

    expect(checkpoint.id).toBeDefined();
    expect(checkpoint.snapshotData.validationFailure?.failureClass).toBe("SCHEMA_FAILURE");

    // Now execute Attempt 2 on same step with valid JSON output
    // Advance fencing token to 1
    await db.query(
      `UPDATE execution.step_executions SET fencing_token = 1 WHERE id = $1;`,
      [taskRes.stepExecutionId]
    );

    const attempt2Id = generateUUIDv7();
    await db.query(
      `INSERT INTO execution.execution_attempts (
        id, step_execution_id, attempt_number, status, started_at
      ) VALUES ($1, $2, 2, 'running', now());`,
      [attempt2Id, taskRes.stepExecutionId]
    );

    const commitAttempt2 = await executionEngine.commitAttemptSuccess({
      stepExecutionId: taskRes.stepExecutionId,
      executionId: taskRes.executionId,
      taskId: taskRes.taskId,
      tenantId,
      attemptId: attempt2Id,
      fencingToken: 1,
      response: {
        outputText: JSON.stringify({ status: "success", result: 42 }),
        model: "gemini-2.5-flash",
        finishReason: "stop",
        usage: { promptTokens: 15, outputTokens: 25, totalTokens: 40 },
        latencyMs: 140,
      },
      expectedOutputJson: true,
    });

    expect(commitAttempt2.validationPassed).toBe(true);

    // Verify Attempt 2 record was marked as success
    const attempt2Row = await db.query(
      `SELECT status FROM execution.execution_attempts WHERE id = $1;`,
      [attempt2Id]
    );
    expect(attempt2Row.rows[0].status).toBe("success");

    // Verify Attempt 1 artifact and Attempt 2 artifact both exist independently (Lineage Preserved)
    expect(commitAttempt1.artifactId).not.toBe(commitAttempt2.artifactId);

    const allArtifacts = await db.query(
      `SELECT id, inline_content FROM artifacts.artifacts WHERE task_id = $1 ORDER BY created_at ASC;`,
      [taskRes.taskId]
    );
    expect(allArtifacts.rows).toHaveLength(2);
    expect(allArtifacts.rows[0].id).toBe(commitAttempt1.artifactId);
    expect(allArtifacts.rows[1].id).toBe(commitAttempt2.artifactId);

    // Verify both validation records exist
    const allValidations = await db.query(
      `SELECT id, target_id, status FROM validation.validations WHERE task_id = $1 ORDER BY created_at ASC;`,
      [taskRes.taskId]
    );
    expect(allValidations.rows).toHaveLength(2);
    expect(allValidations.rows[0].status).toBe("failed");
    expect(allValidations.rows[1].status).toBe("passed");

    // Verify task is completed with Attempt 2's artifact
    const taskFinal = await executionEngine.getTask(taskRes.taskId);
    expect(taskFinal?.status).toBe("completed");
    expect(taskFinal?.outputArtifactId).toBe(commitAttempt2.artifactId);
  });
});

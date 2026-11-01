import { describe, it, expect } from "vitest";
import { validationEngine } from "../src/validation/validationEngine.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";

describe("Truth & Validation Engine Tests", () => {
  it("valid output satisfies deterministic gate and yields ACCEPT", async () => {
    const validationId = generateUUIDv7();
    const decision = await validationEngine.validate(validationId, {
      artifactId: generateUUIDv7(),
      content: "This is a legitimate verified text output from model.",
    });

    expect(decision.outcome).toBe("ACCEPT");
    expect(decision.confidence).toBe(1.0);
    expect(decision.results.length).toBeGreaterThan(0);
    expect(decision.results.every((r) => r.status === "pass")).toBe(true);
  });

  it("structurally invalid JSON yields REJECT when JSON schema expected", async () => {
    const validationId = generateUUIDv7();
    const decision = await validationEngine.validate(validationId, {
      artifactId: generateUUIDv7(),
      content: "Malformed { key: 'missing_closing_brace' ",
      requiresJson: true,
    });

    expect(decision.outcome).toBe("REJECT");
    expect(decision.confidence).toBe(0.0);
    expect(decision.reasons.some((r) => r.includes("Schema Validation failed"))).toBe(true);
  });

  it("empty output payload yields REJECT on Generation Handshake", async () => {
    const validationId = generateUUIDv7();
    const decision = await validationEngine.validate(validationId, {
      artifactId: generateUUIDv7(),
      content: "   ",
    });

    expect(decision.outcome).toBe("REJECT");
    expect(decision.reasons.some((r) => r.includes("Generation Handshake failed"))).toBe(true);
  });

  it("output containing raw internal error substrings yields REJECT", async () => {
    const validationId = generateUUIDv7();
    const decision = await validationEngine.validate(validationId, {
      artifactId: generateUUIDv7(),
      content: "Error: Connection closed by remote server unexpectedly",
    });

    expect(decision.outcome).toBe("REJECT");
    expect(decision.reasons.some((r) => r.includes("Deterministic Check failed"))).toBe(true);
  });

  it("provider HTTP success with validation REJECT does NOT mark task completed (Rule E-007)", async () => {
    const { executionEngine } = await import("../src/engine/executionEngine.js");
    const { ensureDefaultTenant } = await import("../src/api/routes/tasks.js");
    const { db } = await import("../src/db/client.js");

    const tenantId = await ensureDefaultTenant();
    const taskResult = await executionEngine.createTaskAndPlan({
      tenantId,
      taskType: "json_validation_test",
      inputPayload: { prompt: "Return JSON data", expectJson: true },
    });

    const attemptId = generateUUIDv7();
    await db.query(
      `INSERT INTO execution.execution_attempts (id, step_execution_id, attempt_number, status)
       VALUES ($1, $2, 1, 'running');`,
      [attemptId, taskResult.stepExecutionId]
    );

    // Provider returns 200 HTTP success, but output text is INVALID JSON
    const providerSuccessResponse = {
      requestId: generateUUIDv7(),
      outputText: "Not valid JSON: { broken }",
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
      latencyMs: 150,
      finishReason: "stop" as const,
    };

    const commitRes = await executionEngine.commitAttemptSuccess({
      stepExecutionId: taskResult.stepExecutionId,
      executionId: taskResult.executionId,
      taskId: taskResult.taskId,
      tenantId,
      attemptId,
      fencingToken: 0,
      response: providerSuccessResponse,
      expectedOutputJson: true,
    });

    expect(commitRes.validationPassed).toBe(false);

    // Assert that Task status is NOT 'completed'!
    const task = await executionEngine.getTask(taskResult.taskId);
    expect(task?.status).not.toBe("completed");

    // Assert that Step status is 'diagnosing'
    const stepRow = await db.query(
      "SELECT status FROM execution.step_executions WHERE id = $1;",
      [taskResult.stepExecutionId]
    );
    expect(stepRow.rows[0].status).toBe("diagnosing");
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { providerAdapterRegistry } from "../src/adapters/adapterRegistry.js";
import { OpenAICompatibleProviderAdapter } from "../src/adapters/openAICompatibleAdapter.js";
import { ProviderErrorCode, UnifiedRequest } from "../src/adapters/types.js";
import { ExecutionWorker } from "../src/engine/worker.js";
import { resourceIntelligence } from "../src/resources/resourceIntelligence.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";
import { db } from "../src/db/client.js";

describe("OpenAICompatibleProviderAdapter & Free Fleet Tests", () => {
  beforeEach(async () => {
    await resourceIntelligence.ensureLiveProviders();
  });

  describe("1. Registry & Fleet Pre-Registration", () => {
    it("should have Cerebras and Mistral registered in ProviderAdapterRegistry", () => {
      expect(providerAdapterRegistry.hasAdapter("cerebras")).toBe(true);
      expect(providerAdapterRegistry.hasAdapter("mistral")).toBe(true);
      expect(providerAdapterRegistry.getAdapter("cerebras")?.providerId).toBe("cerebras");
      expect(providerAdapterRegistry.getAdapter("mistral")?.providerId).toBe("mistral");
    });

    it("should allow dynamic registration of new free providers from awesome lists", async () => {
      providerAdapterRegistry.registerOpenAICompatible({
        providerId: "anyapi",
        baseUrl: "https://api.anyapi.ai/v1",
        defaultModel: "llama-3.3-70b",
      });
      expect(providerAdapterRegistry.hasAdapter("anyapi")).toBe(true);
      const adapter = providerAdapterRegistry.getAdapter("anyapi")!;
      expect(adapter.providerId).toBe("anyapi");

      const req: UnifiedRequest = {
        requestId: generateUUIDv7(),
        taskId: generateUUIDv7(),
        stepId: generateUUIDv7(),
        attemptId: generateUUIDv7(),
        resourceId: generateUUIDv7(),
        modelId: "llama-3.3-70b",
        prompt: "Hello AnyAPI",
      };
      const res = await adapter.execute(req);
      expect(res.outputText).toContain("[anyapi Simulated Response]");
    });
  });

  describe("2. Error Normalization & Simulation Matrix", () => {
    const adapter = new OpenAICompatibleProviderAdapter({
      providerId: "cerebras",
      baseUrl: "https://api.cerebras.ai/v1",
      defaultModel: "llama3.3-70b",
    });

    it("should normalize 401 and 403 as AUTHENTICATION", () => {
      const err = adapter.normalizeError({ status: 401, body: "invalid_api_key" });
      expect(err.code).toBe(ProviderErrorCode.AUTHENTICATION);
      expect(err.retryable).toBe(false);
    });

    it("should normalize 429 rate limit with retry-after header", () => {
      const err = adapter.normalizeError({ status: 429, retryAfterMs: 7000 });
      expect(err.code).toBe(ProviderErrorCode.RATE_LIMIT);
      expect(err.retryable).toBe(true);
      expect(err.retryAfterMs).toBe(7000);
    });

    it("should normalize 429 quota exhaustion with retryable=false", () => {
      const err = adapter.normalizeError({ status: 429, body: "insufficient_quota" });
      expect(err.code).toBe(ProviderErrorCode.QUOTA_EXHAUSTED);
      expect(err.retryable).toBe(false);
      expect(err.migrationRecommended).toBe(true);
    });

    it("should normalize 404, 503, 500, and AbortError", () => {
      expect(adapter.normalizeError({ status: 404 }).code).toBe(ProviderErrorCode.MODEL_NOT_FOUND);
      expect(adapter.normalizeError({ status: 503 }).code).toBe(ProviderErrorCode.SERVICE_UNAVAILABLE);
      expect(adapter.normalizeError({ status: 500 }).code).toBe(ProviderErrorCode.SERVER_ERROR);
      expect(adapter.normalizeError({ name: "AbortError" }).code).toBe(ProviderErrorCode.TIMEOUT);
    });

    it("should execute simulated faults deterministically", async () => {
      adapter.setSimulatedFault(ProviderErrorCode.SERVICE_UNAVAILABLE);
      const req: UnifiedRequest = {
        requestId: generateUUIDv7(),
        taskId: generateUUIDv7(),
        stepId: generateUUIDv7(),
        attemptId: generateUUIDv7(),
        resourceId: generateUUIDv7(),
        modelId: "llama3.3-70b",
        prompt: "Fault test",
      };
      await expect(adapter.execute(req)).rejects.toMatchObject({
        code: ProviderErrorCode.SERVICE_UNAVAILABLE,
      });
      adapter.resetSimulation();
    });
  });

  describe("3. End-to-End Worker Execution with Cerebras and Mistral", () => {
    it("should execute task assigned to Cerebras resource and persist artifact", async () => {
      const tenantId = generateUUIDv7();
      const taskId = generateUUIDv7();
      const executionId = generateUUIDv7();
      const planId = generateUUIDv7();
      const planStepId = generateUUIDv7();
      const stepExecutionId = generateUUIDv7();
      const cerebrasResourceId = "01924b00-0000-7000-8000-000000000044";

      await db.query(
        `INSERT INTO identity.tenants (id, name, slug) VALUES ($1, 'Test Tenant', $2) ON CONFLICT DO NOTHING;`,
        [tenantId, `tenant-${tenantId}`]
      );
      await db.query(
        `INSERT INTO tasks.tasks (id, tenant_id, task_type, input_payload, status, policy)
         VALUES ($1, $2, 'code_generation', '{"prompt": "Write binary search in TS"}', 'running', '{}');`,
        [taskId, tenantId]
      );
      await db.query(
        `INSERT INTO planning.execution_plans (id, task_id, strategy) VALUES ($1, $2, 'single_model');`,
        [planId, taskId]
      );
      await db.query(
        `INSERT INTO execution.executions (id, task_id, plan_id) VALUES ($1, $2, $3);`,
        [executionId, taskId, planId]
      );
      await db.query(
        `INSERT INTO planning.plan_steps (id, plan_id, step_key, name, step_type, order_index)
         VALUES ($1, $2, 'step_cerebras', 'Cerebras Step', 'model_inference', 1);`,
        [planStepId, planId]
      );
      await db.query(
        `INSERT INTO execution.step_executions (
           id, execution_id, plan_step_id, task_id, resource_id, status, priority, available_at
         ) VALUES ($1, $2, $3, $4, $5, 'pending', 10, now());`,
        [stepExecutionId, executionId, planStepId, taskId, cerebrasResourceId]
      );

      const worker = new ExecutionWorker();
      const executed = await worker.claimAndExecuteNext(stepExecutionId);
      expect(executed).toBe(true);

      const stepCheck = await db.query(
        `SELECT status, output_tokens FROM execution.step_executions WHERE id = $1;`,
        [stepExecutionId]
      );
      expect(stepCheck.rows[0].status).toBe("completed");

      const artifactCheck = await db.query(
        `SELECT inline_content FROM artifacts.artifacts WHERE task_id = $1;`,
        [taskId]
      );
      expect(artifactCheck.rows.length).toBeGreaterThan(0);
      expect(artifactCheck.rows[0].inline_content).toContain("[cerebras Simulated Response]");
    });
  });
});

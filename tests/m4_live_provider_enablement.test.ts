import { describe, it, expect, beforeEach, vi } from "vitest";
import { providerAdapterRegistry, ProviderAdapterRegistry } from "../src/adapters/adapterRegistry.js";
import { GroqProviderAdapter } from "../src/adapters/groqAdapter.js";
import { CloudflareProviderAdapter } from "../src/adapters/cloudflareAdapter.js";
import { OpenRouterProviderAdapter } from "../src/adapters/openrouterAdapter.js";
import { ProviderErrorCode, UnifiedRequest } from "../src/adapters/types.js";
import { ExecutionWorker } from "../src/engine/worker.js";
import { resourceIntelligence } from "../src/resources/resourceIntelligence.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";
import { db } from "../src/db/client.js";

describe("Milestone M4.20 — Live Provider Enablement & Multi-Provider Architecture", () => {
  beforeEach(async () => {
    await resourceIntelligence.ensureLiveProviders();
  });

  describe("1. Provider Adapter Registry & Catalog Lookup", () => {
    it("should initialize with all 4 supported providers pre-registered", () => {
      expect(providerAdapterRegistry.hasAdapter("gemini")).toBe(true);
      expect(providerAdapterRegistry.hasAdapter("groq")).toBe(true);
      expect(providerAdapterRegistry.hasAdapter("cloudflare")).toBe(true);
      expect(providerAdapterRegistry.hasAdapter("openrouter")).toBe(true);
      expect(providerAdapterRegistry.getAdapter("groq")?.providerId).toBe("groq");
      expect(providerAdapterRegistry.getAdapter("cloudflare")?.providerId).toBe("cloudflare");
      expect(providerAdapterRegistry.getAdapter("openrouter")?.providerId).toBe("openrouter");
    });

    it("should allow dynamic cloning and registration of custom adapters", () => {
      const cloned = providerAdapterRegistry.clone();
      const mockCustom = new GroqProviderAdapter();
      cloned.registerAdapter("custom-provider", mockCustom);
      expect(cloned.hasAdapter("custom-provider")).toBe(true);
      expect(providerAdapterRegistry.hasAdapter("custom-provider")).toBe(false);
    });
  });

  describe("2. Concrete Adapters Simulation & Normalization", () => {
    it("Groq adapter should execute simulated request and normalize errors", async () => {
      const adapter = new GroqProviderAdapter();
      const req: UnifiedRequest = {
        requestId: generateUUIDv7(),
        taskId: generateUUIDv7(),
        stepId: generateUUIDv7(),
        attemptId: generateUUIDv7(),
        resourceId: "01924b00-0000-7000-8000-000000000014",
        modelId: "llama-3.1-8b-instant",
        prompt: "Hello Groq",
      };

      const res = await adapter.execute(req);
      expect(res.outputText).toContain("Groq Simulated Response");
      expect(res.usage.totalTokens).toBeGreaterThan(0);

      const authErr = adapter.normalizeError({ status: 401, body: "invalid_api_key" });
      expect(authErr.code).toBe(ProviderErrorCode.AUTHENTICATION);

      const rateErr = adapter.normalizeError({ status: 429, retryAfterMs: 4000 });
      expect(rateErr.code).toBe(ProviderErrorCode.RATE_LIMIT);
      expect(rateErr.retryAfterMs).toBe(4000);
    });

    it("Cloudflare adapter should execute simulated request and normalize errors", async () => {
      const adapter = new CloudflareProviderAdapter();
      const req: UnifiedRequest = {
        requestId: generateUUIDv7(),
        taskId: generateUUIDv7(),
        stepId: generateUUIDv7(),
        attemptId: generateUUIDv7(),
        resourceId: "01924b00-0000-7000-8000-000000000024",
        modelId: "@cf/meta/llama-3.1-8b-instruct",
        prompt: "Hello Cloudflare",
      };

      const res = await adapter.execute(req);
      expect(res.outputText).toContain("Cloudflare Simulated Response");

      const authErr = adapter.normalizeError({ status: 403, body: "10000 Authentication error" });
      expect(authErr.code).toBe(ProviderErrorCode.AUTHENTICATION);
    });

    it("Cloudflare adapter should default to @cf/meta/llama-3.1-8b-instruct when modelId is omitted", async () => {
      const adapter = new CloudflareProviderAdapter();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () => {
        return new Response(JSON.stringify({ result: { response: "Default model output" }, success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const req: UnifiedRequest = {
        requestId: generateUUIDv7(),
        taskId: generateUUIDv7(),
        stepId: generateUUIDv7(),
        attemptId: generateUUIDv7(),
        resourceId: "01924b00-0000-7000-8000-000000000024",
        prompt: "Hello Cloudflare Default",
        parameters: { accountId: "test-account" },
      };

      const res = await adapter.execute(req, "test-token");
      expect(fetchSpy).toHaveBeenCalled();
      const requestedUrl = String(fetchSpy.mock.calls[0][0]);
      expect(requestedUrl).toContain("/ai/run/@cf/meta/llama-3.1-8b-instruct");
      expect(res.outputText).toBe("Default model output");
      fetchSpy.mockRestore();
    });

    it("Cloudflare adapter should respect explicit modelId when provided", async () => {
      const adapter = new CloudflareProviderAdapter();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () => {
        return new Response(JSON.stringify({ result: { response: "Explicit model output" }, success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const req: UnifiedRequest = {
        requestId: generateUUIDv7(),
        taskId: generateUUIDv7(),
        stepId: generateUUIDv7(),
        attemptId: generateUUIDv7(),
        resourceId: "01924b00-0000-7000-8000-000000000024",
        modelId: "@cf/baai/bge-large-en-v1.5",
        prompt: "Hello Cloudflare Custom",
        parameters: { accountId: "test-account" },
      };

      const res = await adapter.execute(req, "test-token");
      expect(fetchSpy).toHaveBeenCalled();
      const requestedUrl = String(fetchSpy.mock.calls[0][0]);
      expect(requestedUrl).toContain("/ai/run/@cf/baai/bge-large-en-v1.5");
      expect(res.outputText).toBe("Explicit model output");
      fetchSpy.mockRestore();
    });

    it("OpenRouter adapter should execute simulated request and normalize errors", async () => {
      const adapter = new OpenRouterProviderAdapter();
      const req: UnifiedRequest = {
        requestId: generateUUIDv7(),
        taskId: generateUUIDv7(),
        stepId: generateUUIDv7(),
        attemptId: generateUUIDv7(),
        resourceId: "01924b00-0000-7000-8000-000000000034",
        modelId: "meta-llama/llama-3.1-8b-instruct:free",
        prompt: "Hello OpenRouter",
      };

      const res = await adapter.execute(req);
      expect(res.outputText).toContain("OpenRouter Simulated Response");

      const quotaErr = adapter.normalizeError({ status: 429, body: "free tier limit reached or quota exceeded" });
      expect(quotaErr.code).toBe(ProviderErrorCode.QUOTA_EXHAUSTED);
    });
  });

  describe("3. ExecutionWorker Dynamic Dispatch & Cross-Provider Failover", () => {
    it("should resolve correct adapter dynamically based on claimed providerSlug", async () => {
      const worker = new ExecutionWorker();
      expect(worker.resolveAdapter("gemini").providerId).toBe("gemini");
      expect(worker.resolveAdapter("groq").providerId).toBe("groq");
      expect(worker.resolveAdapter("cloudflare").providerId).toBe("cloudflare");
      expect(worker.resolveAdapter("openrouter").providerId).toBe("openrouter");
    });

    it("should seamlessly execute tasks assigned to non-gemini provider", async () => {
      const tenantId = generateUUIDv7();
      const taskId = generateUUIDv7();
      const executionId = generateUUIDv7();
      const planId = generateUUIDv7();
      const planStepId = generateUUIDv7();
      const stepExecutionId = generateUUIDv7();
      const groqResourceId = "01924b00-0000-7000-8000-000000000014";

      await db.query(
        `INSERT INTO identity.tenants (id, name, slug)
         VALUES ($1, 'Test Tenant', $2)
         ON CONFLICT DO NOTHING;`,
        [tenantId, `test-tenant-${tenantId}`]
      );
      await db.query(
        `INSERT INTO tasks.tasks (id, tenant_id, task_type, input_payload, status, policy)
         VALUES ($1, $2, 'text_generation', '{"prompt": "Test Groq dispatch"}', 'running', '{}');`,
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
         VALUES ($1, $2, 'step_1', 'Step 1', 'model_inference', 1);`,
        [planStepId, planId]
      );
      await db.query(
        `INSERT INTO execution.step_executions (
           id, execution_id, plan_step_id, task_id, resource_id, status, priority, available_at
         ) VALUES ($1, $2, $3, $4, $5, 'pending', 10, now());`,
        [stepExecutionId, executionId, planStepId, taskId, groqResourceId]
      );

      const worker = new ExecutionWorker();
      const executed = await worker.claimAndExecuteNext(stepExecutionId);
      expect(executed).toBe(true);

      const stepCheck = await db.query(
        `SELECT status, output_tokens FROM execution.step_executions WHERE id = $1;`,
        [stepExecutionId]
      );
      expect(stepCheck.rows[0].status).toBe("completed");
      expect(Number(stepCheck.rows[0].output_tokens)).toBeGreaterThan(0);

      const artifactCheck = await db.query(
        `SELECT inline_content FROM artifacts.artifacts WHERE task_id = $1;`,
        [taskId]
      );
      expect(artifactCheck.rows.length).toBeGreaterThan(0);
      expect(artifactCheck.rows[0].inline_content).toContain("Groq Simulated Response");
    });
  });
});

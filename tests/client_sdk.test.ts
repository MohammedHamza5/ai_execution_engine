import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildServer } from "../src/api/server.js";
import { AIExecutionEngineClient } from "../src/client/index.js";
import { applyPlatformNetworkPolicy } from "../src/config/networkPolicy.js";
import { apiKeyService } from "../src/api/auth/apiKeyService.js";
import { db } from "../src/db/client.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";

describe("Official Client SDK Tests (AIExecutionEngineClient)", () => {
  let app: FastifyInstance;
  let client: AIExecutionEngineClient;
  let serverUrl: string;
  let tenantId: string;

  beforeAll(async () => {
    applyPlatformNetworkPolicy();

    tenantId = generateUUIDv7();
    await db.query(
      `INSERT INTO identity.tenants (id, name, slug)
       VALUES ($1, 'SDK Test Tenant', $2)
       ON CONFLICT (id) DO NOTHING;`,
      [tenantId, `sdk-tenant-${tenantId}`]
    );

    const keyResult = await apiKeyService.createApiKey({
      tenantId,
      name: "SDK Test Key",
    });

    app = buildServer();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address() as any;
    serverUrl = `http://127.0.0.1:${address.port}`;
    client = new AIExecutionEngineClient({
      baseUrl: serverUrl,
      apiKey: keyResult.apiKey,
      tenantId,
      timeoutMs: 15_000,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("1. client.health() checks server liveness", async () => {
    const health = await client.health();
    expect(health).toBeDefined();
    expect(health.status).toBe("healthy");
  });

  it("2. client.models.list() retrieves supported models catalog", async () => {
    const models = await client.models.list();
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThanOrEqual(1);
    expect(models.some((m) => m.id === "auto")).toBe(true);
  });

  it("3. client.chat.completions.create() executes fast inference", async () => {
    const res = await client.chat.completions.create({
      model: "auto",
      messages: [{ role: "user", content: "What is 2 + 2? Answer in one word." }],
      max_tokens: 50,
    });

    expect(res).toBeDefined();
    expect(res.choices).toBeDefined();
    expect(res.choices.length).toBeGreaterThan(0);
    expect(res.choices[0].message.content).toBeDefined();
  });

  it("4. client.chat.completions.create({ stream: true }) streams SSE chunks", async () => {
    const stream = await client.chat.completions.create({
      model: "auto",
      messages: [{ role: "user", content: "Count from 1 to 3." }],
      stream: true,
    });

    const chunks: string[] = [];
    for await (const chunk of stream) {
      if (chunk.choices?.[0]?.delta?.content) {
        chunks.push(chunk.choices[0].delta.content);
      }
    }

    expect(chunks.length).toBeGreaterThan(0);
  });

  it("5. client.memory.store() and client.memory.search() integrates vector memory", async () => {
    const stored = await client.memory.store(
      "test_ns",
      "Antigravity is an AI pair programming engine",
      { category: "test" }
    );

    expect(stored.success).toBe(true);
    expect(stored.record.id).toBeDefined();

    const searchResults = await client.memory.search("test_ns", "What is Antigravity?", 3);
    expect(Array.isArray(searchResults)).toBe(true);
    expect(searchResults.length).toBeGreaterThan(0);
    expect(searchResults[0].content).toContain("Antigravity");
  });

  it("6. client.tasks.submit() and client.tasks.get() handles durable tasks", async () => {
    const submitResult = await client.tasks.submit({
      title: "SDK Test Task",
      prompt: "Summarize quantum computing in one sentence",
    });

    expect(submitResult.taskId).toBeDefined();
    expect(submitResult.status).toBe("pending");

    const taskStatus = await client.tasks.get(submitResult.taskId);
    expect(taskStatus.id).toBe(submitResult.taskId);
    expect(taskStatus.status).toBeDefined();
  });

  it("7. client.tasks.dag.submit() and client.tasks.dag.get() manages DAG workflows", async () => {
    const dagResult = await client.tasks.dag.submit({
      title: "SDK Test DAG",
      nodes: [
        {
          nodeId: "step_research",
          name: "Research",
          prompt: "Research topic A",
          dependencies: [],
        },
        {
          nodeId: "step_synthesis",
          name: "Synthesis",
          prompt: "Synthesize findings",
          dependencies: ["step_research"],
        },
      ],
    });

    expect(dagResult.taskId).toBeDefined();
    expect(dagResult.status).toBe("pending");

    const dagStatus = await client.tasks.dag.get(dagResult.taskId);
    expect(dagStatus.taskId).toBe(dagResult.taskId);
    expect(dagStatus.nodes.length).toBe(2);
  });
});

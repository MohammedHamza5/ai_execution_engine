import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { applyPlatformNetworkPolicy } from "../src/config/networkPolicy.js";
import { buildServer } from "../src/api/server.js";
import { FastifyInstance } from "fastify";
import { keyPoolManager } from "../src/engine/fastGateway/keyPoolManager.js";
import { CognitiveIntentAnalyzer } from "../src/engine/fastGateway/intentAnalyzer.js";
import { FastInferenceDispatcher } from "../src/engine/fastGateway/fastDispatcher.js";

describe("Fast Multi-Tier Gateway & OpenAI Compatibility Tests", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    applyPlatformNetworkPolicy();
    app = buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /v1/models returns standard OpenAI models list", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/models",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.object).toBe("list");
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.some((m: any) => m.id === "auto")).toBe(true);
    expect(body.data.some((m: any) => m.id === "llama-3.3-70b")).toBe(true);
  });

  it("GET /v1/fleet/stats returns operational key pool metrics", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/fleet/stats",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("operational");
    expect(body.keyPools).toBeDefined();
    expect(body.keyPools.groq).toBeDefined();
    expect(body.keyPools.groq.totalKeys).toBeGreaterThanOrEqual(1);
  });

  it("POST /v1/chat/completions executes fast direct inference (OpenAI standard)", async () => {
    const startTime = Date.now();
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "Content-Type": "application/json" },
      payload: {
        model: "auto",
        messages: [{ role: "user", content: "What is 2 + 2? Answer in one word." }],
        temperature: 0.2,
      },
    });

    const elapsed = Date.now() - startTime;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.object).toBe("chat.completion");
    expect(body.choices.length).toBeGreaterThan(0);
    expect(body.choices[0].message.role).toBe("assistant");
    expect(body.choices[0].message.content).toBeDefined();
    expect(body.usage).toBeDefined();
    console.log(`[FastGateway Test] Latency: ${elapsed}ms | Model: ${body.model} | Answer: ${body.choices[0].message.content.trim()}`);
  });

  it("POST /v1/chat/completions with stream: true returns SSE chunks", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "Content-Type": "application/json" },
      payload: {
        model: "auto",
        messages: [{ role: "user", content: "Say hi in one word" }],
        stream: true,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.body).toContain("data: {");
    expect(res.body).toContain("data: [DONE]");
  });

  it("POST /v1/chat/completions supports response_format: { type: 'json_object' } (FORMA & MarketIntel compatibility)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "Content-Type": "application/json" },
      payload: {
        model: "auto",
        messages: [{ role: "user", content: "Return a JSON object with key 'status' set to 'ok' and 'code' set to 200." }],
        response_format: { type: "json_object" },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const content = body.choices[0].message.content;
    const parsedJson = JSON.parse(content);
    expect(parsedJson).toBeDefined();
    expect(parsedJson.status).toBe("ok");
    expect(parsedJson.code).toBe(200);
  });

  it("POST /v1/chat/completions supports models array (pulseOs compatibility)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "Content-Type": "application/json" },
      payload: {
        models: ["qwen/qwen3.8-27b", "openrouter/free"],
        messages: [{ role: "user", content: "Say OK in one word." }],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.choices[0].message.content).toBeDefined();
  });

  it("CognitiveIntentAnalyzer accurately classifies Arabic, Canvas, and Reasoning domains", () => {
    // 1. Arabic
    const arabicIntent = CognitiveIntentAnalyzer.analyze({
      messages: [{ role: "user", content: "ما هي أهم مميزات المعمارية النظيفة في تطبيقات فلاتر؟" }],
    });
    expect(arabicIntent.domain).toBe("ARABIC_SPECIALIST");

    // 2. Visual Canvas
    const canvasIntent = CognitiveIntentAnalyzer.analyze({
      messages: [{ role: "user", content: "Create a rectangle shape at x: 100, y: 200 with blue border on the canvas" }],
    });
    expect(canvasIntent.domain).toBe("VISUAL_CANVAS");

    // 3. Deep Market Intelligence & Reasoning
    const reasoningIntent = CognitiveIntentAnalyzer.analyze({
      messages: [{ role: "user", content: "Perform a competitive market intelligence analysis for competitor pricing strategy in SaaS" }],
    });
    expect(reasoningIntent.domain).toBe("DEEP_REASONING");

    // 4. Code Systems
    const codeIntent = CognitiveIntentAnalyzer.analyze({
      messages: [{ role: "user", content: "Write a TypeScript function to implement a monotonic fencing token validator" }],
    });
    expect(codeIntent.domain).toBe("CODE_SYSTEMS");
  });

  it("FastInferenceDispatcher builds domain champion candidate chain dynamically", () => {
    // Arabic request chain starts with Arabic specialist (allam-2-7b)
    const arabicChain = FastInferenceDispatcher.buildCandidateChain("auto", {
      messages: [{ role: "user", content: "أريد ملخصاً سريعاً باللغة العربية" }],
    });
    expect(arabicChain[0].model).toBe("allam-2-7b");

    // Visual canvas chain starts with fast JSON generator (qwen3.8-27b)
    const canvasChain = FastInferenceDispatcher.buildCandidateChain("auto", {
      messages: [{ role: "user", content: "draw an arrow between shape A and shape B on canvas" }],
    });
    expect(canvasChain[0].model).toBe("qwen/qwen3.8-27b");

    // Deep reasoning chain starts with DeepSeek R1
    const reasoningChain = FastInferenceDispatcher.buildCandidateChain("auto", {
      messages: [{ role: "user", content: "analyze market intelligence data and calculate financial ROI" }],
    });
    expect(reasoningChain[0].model).toBe("deepseek/deepseek-r1:free");
  });

  it("KeyPoolManager rotates keys and handles cooldowns cleanly", () => {
    const key1 = keyPoolManager.getNextKey("groq");
    expect(key1).not.toBeNull();
    expect(key1?.apiKey).toBeDefined();

    // Mark cooldown
    keyPoolManager.markCooldown("groq", key1!.apiKey, 5000);
    const key2 = keyPoolManager.getNextKey("groq");
    expect(key2).not.toBeNull();
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { embeddingsDispatcher } from "../src/engine/fastGateway/embeddingsDispatcher.js";
import { vectorMemory } from "../src/memory/vectorMemory.js";
import { MCP_TOOLS, executeMcpTool } from "../src/mcp/tools.js";
import { buildServer } from "../src/api/server.js";

describe("Phase 2: Shared Vector Memory & Embeddings", () => {
  beforeEach(() => {
    vectorMemory.clearNamespace("test-forma");
    vectorMemory.clearNamespace("test-pulse");
  });

  describe("Embeddings Dispatcher", () => {
    it("generates 1024-dimension float vectors for string input", async () => {
      const res = await embeddingsDispatcher.getEmbeddings("Cognitive multi-agent canvas architecture");
      expect(res.embeddings).toHaveLength(1);
      expect(res.embeddings[0]).toHaveLength(1024);
      expect(res.usage.prompt_tokens).toBeGreaterThan(0);
    });

    it("handles batch array inputs correctly", async () => {
      const res = await embeddingsDispatcher.getEmbeddings(["Prompt A", "Prompt B", "Prompt C"]);
      expect(res.embeddings).toHaveLength(3);
      expect(res.embeddings[0]).toHaveLength(1024);
      expect(res.embeddings[1]).toHaveLength(1024);
      expect(res.embeddings[2]).toHaveLength(1024);
    });

    it("throws an error when input is empty", async () => {
      await expect(embeddingsDispatcher.getEmbeddings("   ")).rejects.toThrow("Input text for embeddings must not be empty");
    });
  });

  describe("Vector Memory & Cosine Similarity Math", () => {
    it("computes cosine similarity accurately", () => {
      const vecA = [1, 0, 0];
      const vecB = [1, 0, 0];
      const vecC = [0, 1, 0];
      const vecD = [-1, 0, 0];

      expect(vectorMemory.cosineSimilarity(vecA, vecB)).toBeCloseTo(1.0, 5);
      expect(vectorMemory.cosineSimilarity(vecA, vecC)).toBeCloseTo(0.0, 5);
      expect(vectorMemory.cosineSimilarity(vecA, vecD)).toBeCloseTo(-1.0, 5);
    });

    it("stores and recalls memories with namespace isolation", async () => {
      const emb1 = (await embeddingsDispatcher.getEmbeddings("Drawing vector diagrams on infinite canvas")).embeddings[0];
      const emb2 = (await embeddingsDispatcher.getEmbeddings("Pulse rate measurement and health sensors")).embeddings[0];

      await vectorMemory.store("test-forma", "Drawing shapes on canvas", emb1, { tool: "pen" });
      await vectorMemory.store("test-pulse", "Heart rate telemetry", emb2, { sensor: "bpm" });

      const formaMatches = await vectorMemory.search("test-forma", emb1, 5, 0.0);
      expect(formaMatches).toHaveLength(1);
      expect(formaMatches[0].content).toBe("Drawing shapes on canvas");
      expect(formaMatches[0].metadata).toEqual({ tool: "pen" });

      // Ensure test-pulse memories do not leak into test-forma
      const pulseMatches = await vectorMemory.search("test-forma", emb2, 5, 0.0);
      expect(pulseMatches.length).toBe(1);
      expect(pulseMatches[0].content).toBe("Drawing shapes on canvas"); // Still only returns forma records
    });
  });

  describe("Fastify HTTP Endpoints", () => {
    const app = buildServer();

    it("POST /v1/embeddings conforms to OpenAI response specification", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/embeddings",
        payload: {
          input: "Swarm intelligence consensus",
        },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.object).toBe("list");
      expect(json.data[0].object).toBe("embedding");
      expect(json.data[0].index).toBe(0);
      expect(json.data[0].embedding).toHaveLength(1024);
      expect(json.usage).toBeDefined();
    });

    it("POST /v1/memory/store & /v1/memory/search workflow", async () => {
      const storeRes = await app.inject({
        method: "POST",
        url: "/v1/memory/store",
        payload: {
          namespace: "test-forma",
          content: "Infinite canvas node connecting algorithms",
          metadata: { version: 2 },
        },
      });

      expect(storeRes.statusCode).toBe(201);
      const storeJson = JSON.parse(storeRes.body);
      expect(storeJson.success).toBe(true);
      expect(storeJson.record.namespace).toBe("test-forma");

      const searchRes = await app.inject({
        method: "POST",
        url: "/v1/memory/search",
        payload: {
          namespace: "test-forma",
          query: "canvas nodes algorithm",
          topK: 3,
        },
      });

      expect(searchRes.statusCode).toBe(200);
      const searchJson = JSON.parse(searchRes.body);
      expect(searchJson.success).toBe(true);
      expect(searchJson.matches.length).toBeGreaterThanOrEqual(1);
      expect(searchJson.matches[0].content).toContain("Infinite canvas node");
    });
  });

  describe("MCP Tool Integrations", () => {
    it("exposes ai_memory_store and ai_memory_search in MCP_TOOLS", () => {
      const toolNames = MCP_TOOLS.map((t) => t.name);
      expect(toolNames).toContain("ai_memory_store");
      expect(toolNames).toContain("ai_memory_search");
    });

    it("executes ai_memory_store and ai_memory_search via executeMcpTool", async () => {
      const storeResult = await executeMcpTool("ai_memory_store", {
        namespace: "test-forma",
        content: "Canvas layout state vector",
        metadata: { zoom: 1.5 },
      });

      expect(storeResult.isError).toBeFalsy();
      const storeData = JSON.parse(storeResult.content[0].text);
      expect(storeData.status).toBe("stored");

      const searchResult = await executeMcpTool("ai_memory_search", {
        namespace: "test-forma",
        query: "zoom layout state",
      });

      expect(searchResult.isError).toBeFalsy();
      const searchData = JSON.parse(searchResult.content[0].text);
      expect(searchData.totalMatches).toBeGreaterThanOrEqual(1);
    });
  });
});

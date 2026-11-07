import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { FastInferenceDispatcher } from "../../engine/fastGateway/fastDispatcher.js";
import { keyPoolManager } from "../../engine/fastGateway/keyPoolManager.js";
import { swarmSmoother } from "../../engine/fastGateway/swarmConcurrencySmoother.js";
import { ChatCompletionRequest } from "../../engine/fastGateway/types.js";
import { vectorMemory } from "../../memory/vectorMemory.js";
import { embeddingsDispatcher } from "../../engine/fastGateway/embeddingsDispatcher.js";

const chatSchema = z.object({
  model: z.string().optional(),
  models: z.array(z.string()).optional(),
  namespace: z.string().optional(),
  tenantId: z.string().optional(),
  messages: z.array(
    z.object({
      role: z.enum(["system", "user", "assistant"]),
      content: z.string(),
    })
  ).min(1, "At least one message is required"),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  stream: z.boolean().optional(),
  response_format: z.object({ type: z.enum(["text", "json_object"]) }).optional(),
});

export async function chatCompletionsRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /v1/chat/completions -> Direct ultra-fast inference
  fastify.post("/v1/chat/completions", async (request: FastifyRequest, reply: FastifyReply) => {
    const parse = chatSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        error: {
          message: "Invalid chat completion request payload",
          type: "invalid_request_error",
          details: parse.error.format(),
        },
      });
    }

    const payload = parse.data as ChatCompletionRequest;
    const targetNamespace = payload.namespace || payload.tenantId || (request.headers["x-tenant-id"] as string) || (request.headers["x-namespace"] as string);

    // Dynamic Coach Persona & Long-term Memory Injection
    if (targetNamespace) {
      try {
        const lastUserMsg = [...payload.messages].reverse().find(m => m.role === "user")?.content || "";
        if (lastUserMsg) {
          const emb = await embeddingsDispatcher.getEmbeddings(lastUserMsg);
          const memories = await vectorMemory.search(targetNamespace, emb.embeddings[0], 3);
          const relevant = memories.filter(m => (m.score ?? 0) > 0.35);

          if (relevant.length > 0) {
            const memoryContext = relevant.map(m => `- ${m.content}`).join("\n");
            payload.messages.unshift({
              role: "system",
              content: `[COACH PERSONA & REINFORCED MEMORY]\nThe following rules, preferences, and corrections were learned from this coach:\n${memoryContext}\nStrictly adhere to this coach's personal philosophy, tone, and past corrections.`
            });
          }
        }
      } catch {
        // Non-blocking: continue if vector search is offline
      }
    }

    if (payload.stream) {
      reply.raw.setHeader("Content-Type", "text/event-stream");
      reply.raw.setHeader("Cache-Control", "no-cache");
      reply.raw.setHeader("Connection", "keep-alive");
      reply.raw.setHeader("Access-Control-Allow-Origin", "*");

      try {
        const fullRes = await FastInferenceDispatcher.dispatch(payload);
        const text = fullRes.choices[0]?.message.content || "";
        const id = fullRes.id;
        const model = fullRes.model;

        // Stream words rapidly to client
        const words = text.split(/(\s+)/);
        for (const word of words) {
          if (!word) continue;
          const chunk = {
            id,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{ index: 0, delta: { content: word }, finish_reason: null }],
          };
          reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        const finishChunk = {
          id,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        };
        reply.raw.write(`data: ${JSON.stringify(finishChunk)}\n\n`);
        reply.raw.write("data: [DONE]\n\n");
        reply.raw.end();
        return reply;
      } catch (err: any) {
        reply.raw.write(`data: {"error":{"message":${JSON.stringify(err.message || "Inference failed")}}}\n\n`);
        reply.raw.end();
        return reply;
      }
    }

    try {
      const response = await FastInferenceDispatcher.dispatch(payload);
      return reply.status(200).send(response);
    } catch (err: any) {
      return reply.status(502).send({
        error: {
          message: err.message || "Failed to process chat completion across all provider tiers",
          type: "provider_error",
        },
      });
    }
  });

  // GET /v1/models -> Standard OpenAI list of models
  fastify.get("/v1/models", async (_request: FastifyRequest, reply: FastifyReply) => {
    const models = [
      {
        id: "auto",
        object: "model",
        created: 1735689600,
        owned_by: "ai-execution-engine",
        permission: [],
        root: "auto",
        parent: null,
        description: "Master Cognitive Orchestrator: Smart semantic auto-routing across 17 keys and 5 providers",
        tier: "flagship",
        context_window: 1048576,
      },
      {
        id: "free/gemini-3.8-flash",
        object: "model",
        created: 1735689600,
        owned_by: "google",
        permission: [],
        root: "free/gemini-3.8-flash",
        parent: null,
        description: "Google 2026 Next-Gen Flagship: 1M Context Window, Deep Analytics, Long Documents & Multimodal",
        tier: "tier-1-heavy",
        context_window: 1048576,
      },
      {
        id: "free/qwen-3.8-max",
        object: "model",
        created: 1735689600,
        owned_by: "qwen",
        permission: [],
        root: "free/qwen-3.8-max",
        parent: null,
        description: "Premier Arabic & Mathematics Titan: Flawless Arabic grammar, Deep Logic, Complex Workout Formulations",
        tier: "tier-1-heavy",
        context_window: 1048576,
      },
      {
        id: "free/deepseek-v4.1-flash",
        object: "model",
        created: 1735689600,
        owned_by: "deepseek",
        permission: [],
        root: "free/deepseek-v4.1-flash",
        parent: null,
        description: "Ultra-Fast Diagnostic Reasoning: Root-cause analysis, adherence drop detection, plateaus & injuries",
        tier: "tier-1-heavy",
        context_window: 1048576,
      },
      {
        id: "free/glm-5.3-flash",
        object: "model",
        created: 1735689600,
        owned_by: "glm",
        permission: [],
        root: "free/glm-5.3-flash",
        parent: null,
        description: "Instant Conversational Speed: High-throughput client chat, WhatsApp/Messenger bots, sub-second Q&A",
        tier: "tier-2-fast",
        context_window: 1048576,
      },
      {
        id: "free/kimi-k3",
        object: "model",
        created: 1735689600,
        owned_by: "moonshot",
        permission: [],
        root: "free/kimi-k3",
        parent: null,
        description: "Long-Horizon Memory & Multi-Step Instruction Follower: Personalized Coach Personas",
        tier: "tier-2-fast",
        context_window: 1048576,
      },
      {
        id: "llama-3.3-70b",
        object: "model",
        created: 1735689600,
        owned_by: "groq",
        permission: [],
        root: "llama-3.3-70b",
        parent: null,
        description: "Groq Ultra-Fast LPU Hardware: Realtime Gym-Floor feedback (<400ms Sub-second Latency)",
        tier: "tier-2-fast",
        context_window: 131072,
      },
      {
        id: "llama-3.1-8b",
        object: "model",
        created: 1735689600,
        owned_by: "groq",
        permission: [],
        root: "llama-3.1-8b",
        parent: null,
        description: "Groq Instant Micro-tasks Engine: 72,000 req/day, 850 tok/s for badges, tagging, classification",
        tier: "tier-3-micro",
        context_window: 131072,
      },
      {
        id: "gemini-3.8-flash",
        object: "model",
        created: 1735689600,
        owned_by: "google",
        permission: [],
        root: "gemini-3.8-flash",
        parent: null,
        description: "Google DeepMind Direct Cloud Fleet: High-bandwidth multimodal, 1M+ context & planning tier",
        tier: "tier-2-fast",
        context_window: 1048576,
      },
      {
        id: "deepseek-r1",
        object: "model",
        created: 1735689600,
        owned_by: "openrouter",
        permission: [],
        root: "deepseek-r1",
        parent: null,
        description: "OpenRouter Deep Reasoning Tier: Multi-step reasoning failover",
        tier: "tier-1-heavy",
        context_window: 65536,
      },
      {
        id: "cloudflare-llama-3.1",
        object: "model",
        created: 1735689600,
        owned_by: "cloudflare",
        permission: [],
        root: "cloudflare-llama-3.1",
        parent: null,
        description: "Serverless Edge Redundancy Tier: Global Edge deployment with zero cold start",
        tier: "tier-3-micro",
        context_window: 8192,
      },
    ];
    return reply.send({ object: "list", data: models });
  });

  // GET /v1/fleet/stats -> Active/cooldown keys count across all 18 keys & swarm concurrency
  fastify.get("/v1/fleet/stats", async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      gateway: "Fast Multi-Tier Gateway",
      status: "operational",
      keyPools: keyPoolManager.getStats(),
      swarm: swarmSmoother.getStats(),
    });
  });
}

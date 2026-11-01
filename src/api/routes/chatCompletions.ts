import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { FastInferenceDispatcher } from "../../engine/fastGateway/fastDispatcher.js";
import { keyPoolManager } from "../../engine/fastGateway/keyPoolManager.js";
import { swarmSmoother } from "../../engine/fastGateway/swarmConcurrencySmoother.js";
import { ChatCompletionRequest } from "../../engine/fastGateway/types.js";

const chatSchema = z.object({
  model: z.string().optional(),
  models: z.array(z.string()).optional(),
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
      { id: "auto", object: "model", created: 1700000000, owned_by: "ai-execution-engine", description: "Smart Multi-Tier: Groq 70B -> OpenRouter -> Cloudflare -> Gemini" },
      { id: "llama-3.3-70b", object: "model", created: 1700000000, owned_by: "groq", description: "Ultra-Fast Groq LPU (Sub-500ms)" },
      { id: "deepseek-r1", object: "model", created: 1700000000, owned_by: "openrouter", description: "Deep Reasoning Model (OpenRouter Free Fleet)" },
      { id: "gemini-1.5-flash", object: "model", created: 1700000000, owned_by: "google", description: "Massive Context & Deep Analysis (1M+ Tokens)" },
      { id: "cloudflare-llama-3.1", object: "model", created: 1700000000, owned_by: "cloudflare", description: "Serverless Edge Model" },
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

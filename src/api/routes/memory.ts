import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { embeddingsDispatcher } from "../../engine/fastGateway/embeddingsDispatcher.js";
import { vectorMemory } from "../../memory/vectorMemory.js";

const storeSchema = z.object({
  namespace: z.string().min(1),
  content: z.string().min(1),
  metadata: z.record(z.any()).optional().default({}),
});

const searchSchema = z.object({
  namespace: z.string().min(1),
  query: z.string().min(1),
  topK: z.number().int().min(1).max(50).optional().default(5),
  minScore: z.number().min(-1).max(1).optional().default(-1.0),
});

export async function memoryRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /v1/memory/store -> Embeds content and stores in swarm memory
  fastify.post("/v1/memory/store", async (request: FastifyRequest, reply: FastifyReply) => {
    const parse = storeSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({ error: "Invalid store schema", details: parse.error.format() });
    }

    try {
      const { namespace, content, metadata } = parse.data;
      const embResult = await embeddingsDispatcher.getEmbeddings(content);
      const embedding = embResult.embeddings[0];

      const record = await vectorMemory.store(namespace, content, embedding, metadata);
      return reply.status(201).send({
        success: true,
        record: {
          id: record.id,
          namespace: record.namespace,
          content: record.content,
          metadata: record.metadata,
          createdAt: record.createdAt,
        },
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message || "Failed to store memory" });
    }
  });

  // POST /v1/memory/search -> Embeds query and returns cosine similar memories
  fastify.post("/v1/memory/search", async (request: FastifyRequest, reply: FastifyReply) => {
    const parse = searchSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({ error: "Invalid search schema", details: parse.error.format() });
    }

    try {
      const { namespace, query, topK, minScore } = parse.data;
      const embResult = await embeddingsDispatcher.getEmbeddings(query);
      const queryEmbedding = embResult.embeddings[0];

      const results = await vectorMemory.search(namespace, queryEmbedding, topK, minScore);
      return reply.send({
        success: true,
        matches: results.map((r) => ({
          id: r.id,
          content: r.content,
          metadata: r.metadata,
          score: r.score,
          createdAt: r.createdAt,
        })),
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message || "Failed to search memory" });
    }
  });
}

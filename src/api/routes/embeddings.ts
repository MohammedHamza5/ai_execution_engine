import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { embeddingsDispatcher } from "../../engine/fastGateway/embeddingsDispatcher.js";

const embeddingsSchema = z.object({
  input: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  model: z.string().optional().default("@cf/baai/bge-large-en-v1.5"),
  encoding_format: z.enum(["float", "base64"]).optional().default("float"),
  user: z.string().optional(),
});

export async function embeddingsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post("/v1/embeddings", async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = embeddingsSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          message: "Invalid embeddings request schema",
          type: "invalid_request_error",
          details: parseResult.error.format(),
        },
      });
    }

    try {
      const { input, model } = parseResult.data;
      const result = await embeddingsDispatcher.getEmbeddings(input, model);

      return reply.send({
        object: "list",
        data: result.embeddings.map((vec, idx) => ({
          object: "embedding",
          index: idx,
          embedding: vec,
        })),
        model: result.model,
        usage: result.usage,
      });
    } catch (error: any) {
      return reply.status(500).send({
        error: {
          message: error.message || "Failed to generate embeddings",
          type: "api_error",
        },
      });
    }
  });
}

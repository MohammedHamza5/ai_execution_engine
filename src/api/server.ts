import Fastify, { FastifyInstance } from "fastify";
import { applyPlatformNetworkPolicy } from "../config/networkPolicy.js";
import { taskRoutes } from "./routes/tasks.js";
import { dagTaskRoutes } from "./routes/dagTasks.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { healthRoutes } from "./routes/health.js";
import { streamRoutes } from "./routes/stream.js";
import { chatCompletionsRoutes } from "./routes/chatCompletions.js";
import { embeddingsRoutes } from "./routes/embeddings.js";
import { memoryRoutes } from "./routes/memory.js";
import { authPreHandler } from "./auth/authHook.js";

export function buildServer(): FastifyInstance {
  applyPlatformNetworkPolicy();
  const app = Fastify({
    logger: {
      level: "info",
      serializers: {
        req(req) {
          return {
            method: req.method,
            url: req.url,
            headers: {
              ...req.headers,
              authorization: undefined, // Sanitize sensitive headers
              "x-api-key": undefined,
            },
          };
        },
      },
    },
  });

  // CORS Hook for Web & Mobile Clients
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    reply.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, Idempotency-Key, X-Idempotency-Key, X-Api-Key, x-api-key, X-Tenant-Id, x-tenant-id, X-Namespace, x-namespace, X-App-Id, x-app-id"
    );
    if (request.method === "OPTIONS") {
      return reply.status(204).send();
    }
  });

  // Authentication & API Key Hook
  app.addHook("preHandler", authPreHandler);

  // Register health, domain & dashboard routes
  app.register(healthRoutes);
  app.register(taskRoutes);
  app.register(dagTaskRoutes);
  app.register(dashboardRoutes);
  app.register(streamRoutes);
  app.register(chatCompletionsRoutes);
  app.register(embeddingsRoutes);
  app.register(memoryRoutes);

  return app;
}

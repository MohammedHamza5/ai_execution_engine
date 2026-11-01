import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { db } from "../../db/client.js";

export interface LivenessResponse {
  status: "healthy" | "degraded";
  uptimeSeconds: number;
  timestamp: string;
  version: string;
  memory: {
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
  };
}

export interface ReadinessResponse {
  status: "ready" | "not_ready";
  timestamp: string;
  checks: {
    database: {
      connected: boolean;
      latencyMs?: number;
      error?: string;
    };
  };
}

export const healthRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // 0. Root Handler: Friendly dashboard redirect or operational metadata
  app.get("/", async (req, reply) => {
    if (req.headers.accept?.includes("text/html")) {
      return reply.redirect("http://localhost:5173/");
    }
    return reply.status(200).send({
      service: "AI-Execution-Engine",
      status: "operational",
      dashboardUrl: "http://localhost:5173",
      endpoints: {
        health: "/health",
        readiness: "/readiness",
        fleet: "/v1/fleet",
        tasks: "/v1/tasks",
        telemetry: "/v1/telemetry",
      },
    });
  });

  // 1. Liveness Probe: Fast, does not block on I/O, used to restart dead pods
  app.get("/health", async (_req, reply) => {
    const memory = process.memoryUsage();
    const response: LivenessResponse = {
      status: "healthy",
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      version: "0.1.0",
      memory: {
        rssMb: Math.round(memory.rss / (1024 * 1024)),
        heapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
        heapTotalMb: Math.round(memory.heapTotal / (1024 * 1024)),
      },
    };
    return reply.status(200).send(response);
  });

  // 2. Readiness Probe: Verifies dependencies (PostgreSQL) before routing traffic
  app.get("/readiness", async (_req, reply) => {
    const startTime = Date.now();
    try {
      await db.query("SELECT 1;");
      const latencyMs = Date.now() - startTime;

      const response: ReadinessResponse = {
        status: "ready",
        timestamp: new Date().toISOString(),
        checks: {
          database: {
            connected: true,
            latencyMs,
          },
        },
      };
      return reply.status(200).send(response);
    } catch (err: any) {
      const response: ReadinessResponse = {
        status: "not_ready",
        timestamp: new Date().toISOString(),
        checks: {
          database: {
            connected: false,
            error: err.message || "Database ping failed",
          },
        },
      };
      return reply.status(503).send(response);
    }
  });
};

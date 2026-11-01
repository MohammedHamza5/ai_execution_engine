import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { executionEngine } from "../../engine/executionEngine.js";
import { idempotencyService } from "../idempotency.js";
import { db } from "../../db/client.js";

const createTaskSchema = z.object({
  tenantId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  taskType: z.string().default("general_inference"),
  inputPayload: z.record(z.unknown()),
  requirements: z
    .object({
      qualityFloor: z.number().min(0).max(1).optional(),
      allowPaid: z.boolean().optional(),
      maxCostUsd: z.number().optional(),
    })
    .optional(),
  policy: z
    .object({
      validationLevel: z
        .enum(["strict", "standard", "deterministic_only", "none"])
        .optional(),
    })
    .optional(),
  priority: z.number().int().default(0),
});

export async function ensureDefaultTenant(): Promise<string> {
  const existing = await db.query(
    `SELECT id FROM identity.tenants WHERE slug = 'default';`
  );
  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }

  const defaultTenantId = "01924b00-0000-7000-8000-000000000000";
  const result = await db.query(
    `INSERT INTO identity.tenants (id, name, slug, plan, status)
     VALUES ($1, 'Default Organization', 'default', 'free', 'active')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id;`,
    [defaultTenantId]
  );
  return result.rows[0].id;
}

export async function taskRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /v1/tasks -> Returns 202 Accepted
  fastify.post("/v1/tasks", async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = createTaskSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "INVALID_REQUEST",
        message: "Invalid task request payload",
        details: parseResult.error.format(),
      });
    }

    const defaultTenantId = await ensureDefaultTenant();
    const data = parseResult.data;
    const tenantId = data.tenantId || defaultTenantId;

    // Check Idempotency Key header
    const idempotencyKey = (request.headers["idempotency-key"] as string) || (request.headers["x-idempotency-key"] as string);
    if (idempotencyKey) {
      const check = await idempotencyService.checkOrLock(
        tenantId,
        idempotencyKey,
        JSON.stringify(data)
      );
      if (check.isDuplicate && check.cachedResponse) {
        return reply.status(202).send(check.cachedResponse);
      }
    }

    // Persist Task, Plan, and Enqueue to Authoritative Work Queue
    const result = await executionEngine.createTaskAndPlan({
      tenantId,
      projectId: data.projectId,
      taskType: data.taskType,
      inputPayload: data.inputPayload,
      requirements: data.requirements,
      policy: data.policy,
      priority: data.priority,
    });

    const responsePayload = {
      taskId: result.taskId,
      status: "pending",
      planId: result.planId,
      stepExecutionId: result.stepExecutionId,
      createdAt: new Date().toISOString(),
    };

    if (idempotencyKey) {
      await idempotencyService.finalize(
        tenantId,
        idempotencyKey,
        result.taskId,
        responsePayload
      );
    }

    // Explicit 202 Accepted response (ADR-002: AI is decoupled and asynchronous)
    return reply.status(202).send(responsePayload);
  });

  // GET /v1/tasks/:id -> Retrieves durable task details
  fastify.get("/v1/tasks/:id", async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const taskId = request.params.id;
    const task = await executionEngine.getTask(taskId);
    if (!task) {
      return reply.status(404).send({
        error: "TASK_NOT_FOUND",
        message: `Task with id '${taskId}' was not found`,
      });
    }

    return reply.status(200).send(task);
  });

  // GET /v1/tasks/:id/artifact -> Retrieves output artifact if completed
  fastify.get("/v1/tasks/:id/artifact", async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const id = request.params.id;
    const task = await executionEngine.getTask(id);
    let artifactId = task?.outputArtifactId;

    if (!artifactId) {
      // Check if the parameter itself is a direct artifact ID
      const directArtifact = await db.query(
        `SELECT * FROM artifacts.artifacts WHERE id = $1;`,
        [id]
      );
      if (directArtifact.rows.length > 0) {
        return reply.status(200).send(directArtifact.rows[0]);
      }
      if (!task) {
        return reply.status(404).send({ error: "TASK_NOT_FOUND" });
      }
      return reply.status(400).send({
        error: "ARTIFACT_NOT_READY",
        message: "Task has not produced an output artifact yet",
        status: task.status,
      });
    }

    const result = await db.query(
      `SELECT * FROM artifacts.artifacts WHERE id = $1;`,
      [artifactId]
    );

    if (result.rows.length === 0) {
      return reply.status(404).send({ error: "ARTIFACT_NOT_FOUND" });
    }

    return reply.status(200).send(result.rows[0]);
  });
}

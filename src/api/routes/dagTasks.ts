import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { executionEngine } from "../../engine/executionEngine.js";
import { idempotencyService } from "../idempotency.js";
import { ensureDefaultTenant } from "./tasks.js";
import { DAGValidator } from "../../engine/dagValidator.js";
import { DAGNodeContract } from "../../domain/dag/types.js";
import { isValidUUID } from "../../domain/common/id.js";

const createDAGStepSchema = z.object({
  stepKey: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_-]+$/, "stepKey must contain alphanumeric characters, underscores, or hyphens"),
  name: z.string().min(1),
  description: z.string().optional(),
  stepType: z.string().default("model_inference"),
  dependencies: z.array(z.string()).default([]),
  requiredCapability: z.string().optional(),
  criticality: z.enum(["mandatory", "optional"]).default("mandatory"),
  inputPayload: z.record(z.unknown()).optional(),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  qualityTarget: z.number().min(0).max(1).optional(),
  timeoutMs: z.number().positive().optional(),
});

const createDAGTaskSchema = z.object({
  tenantId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  taskType: z.string().default("dag_workflow"),
  strategy: z.string().default("dag_workflow"),
  steps: z.array(createDAGStepSchema).min(1, "DAG must contain at least one step"),
  requirements: z
    .object({
      qualityFloor: z.number().min(0).max(1).optional(),
      allowPaid: z.boolean().default(false),
      maxCostUsd: z.number().optional(),
      requiredCapabilities: z.array(z.string()).optional(),
    })
    .optional(),
  policy: z
    .object({
      allowPaid: z.boolean().default(false),
      maxCost: z.number().optional(),
      maxAttemptsPerStep: z.number().int().positive().optional(),
      validationLevel: z.enum(["strict", "standard", "deterministic_only", "none"]).optional(),
    })
    .optional(),
  priority: z.number().int().default(0),
  initialPayload: z.record(z.unknown()).optional(),
});

export async function dagTaskRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /v1/tasks/dag -> Enqueues a validated DAG execution workflow
  fastify.post("/v1/tasks/dag", async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = createDAGTaskSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "INVALID_REQUEST",
        message: "Invalid DAG task request payload",
        details: parseResult.error.format(),
      });
    }

    const data = parseResult.data;
    const defaultTenantId = await ensureDefaultTenant();
    const tenantId = data.tenantId || defaultTenantId;

    // 1. Idempotency Key deduplication
    const idempotencyKey =
      (request.headers["idempotency-key"] as string) ||
      (request.headers["x-idempotency-key"] as string);

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

    // 2. Early DAG topological and acyclicity validation (Fail fast before DB transaction)
    const dagNodes: DAGNodeContract[] = data.steps.map((s) => ({
      stepKey: s.stepKey,
      name: s.name,
      description: s.description,
      stepType: s.stepType,
      dependencies: s.dependencies,
      criticality: s.criticality,
      parameters: s.inputPayload,
    }));

    const validation = DAGValidator.validate(dagNodes);
    if (!validation.valid) {
      return reply.status(400).send({
        error: "DAG_VALIDATION_FAILED",
        message: validation.errors.join("; "),
        details: validation.errors,
      });
    }

    // 3. Enforce Zero Silent Paid Spend policy
    const allowPaid = Boolean(data.policy?.allowPaid && data.requirements?.allowPaid);
    const sanitizedRequirements = { ...(data.requirements || {}), allowPaid };
    const sanitizedPolicy = { ...(data.policy || {}), allowPaid };

    // 4. Create and persist DAG task & execution plan in PostgreSQL
    const result = await executionEngine.createDAGTask({
      tenantId,
      projectId: data.projectId,
      taskType: data.taskType,
      strategy: data.strategy,
      priority: data.priority,
      requirements: sanitizedRequirements,
      policy: sanitizedPolicy,
      initialPayload: data.initialPayload,
      steps: data.steps,
    });

    const responsePayload = {
      taskId: result.taskId,
      status: "pending",
      planId: result.planId,
      executionId: result.executionId,
      stepCount: result.steps.length,
      rootStepKeys: result.rootStepKeys,
      terminalStepKeys: result.terminalStepKeys,
      steps: result.steps.map((s) => ({
        stepKey: s.stepKey,
        stepExecutionId: s.stepExecutionId,
        status: s.status,
        inDegree: s.inDegree,
      })),
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

    return reply.status(202).send(responsePayload);
  });

  // GET /v1/tasks/:id/dag -> Retrieves full DAG topology and execution progression
  fastify.get(
    "/v1/tasks/:id/dag",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const taskId = request.params.id;

      if (!isValidUUID(taskId)) {
        return reply.status(400).send({
          error: "INVALID_TASK_ID",
          message: `Task ID '${taskId}' must be a valid UUID.`,
        });
      }

      const details = await executionEngine.getDAGDetails(taskId);
      if (!details) {
        return reply.status(404).send({
          error: "TASK_NOT_FOUND",
          message: `DAG task with ID '${taskId}' was not found.`,
        });
      }

      return reply.status(200).send(details);
    }
  );
}

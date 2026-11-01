import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServer } from "../src/api/server.js";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrator.js";
import { ensureDefaultTenant } from "../src/api/routes/tasks.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";
import { FastifyInstance } from "fastify";

describe("DAG Unified API Routes (T-API-01 & T-API-02)", () => {
  let app: FastifyInstance;
  let tenantId: string;

  beforeAll(async () => {
    await runMigrations();
    tenantId = await ensureDefaultTenant();
    app = buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe("T-API-01: POST /v1/tasks/dag", () => {
    it("rejects invalid request payload with missing or empty steps", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/tasks/dag",
        payload: {
          tenantId,
          steps: [],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe("INVALID_REQUEST");
    });

    it("rejects cyclic graph before database persistence", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/tasks/dag",
        payload: {
          tenantId,
          taskType: "cyclic_test",
          steps: [
            { stepKey: "step_a", name: "Step A", dependencies: ["step_b"] },
            { stepKey: "step_b", name: "Step B", dependencies: ["step_a"] },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe("DAG_VALIDATION_FAILED");
      expect(body.message).toContain("Circular dependency cycle detected");
    });

    it("creates a multi-step DAG task returning 202 Accepted", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/tasks/dag",
        payload: {
          tenantId,
          taskType: "diamond_workflow",
          steps: [
            { stepKey: "root", name: "Ingest Data", dependencies: [] },
            { stepKey: "branch_a", name: "Process Branch A", dependencies: ["root"] },
            { stepKey: "branch_b", name: "Process Branch B", dependencies: ["root"] },
            { stepKey: "join", name: "Synthesize Results", dependencies: ["branch_a", "branch_b"] },
          ],
        },
      });

      expect(res.statusCode).toBe(202);
      const body = JSON.parse(res.body);
      expect(body.taskId).toBeDefined();
      expect(body.planId).toBeDefined();
      expect(body.executionId).toBeDefined();
      expect(body.status).toBe("pending");
      expect(body.stepCount).toBe(4);
      expect(body.rootStepKeys).toEqual(["root"]);
      expect(body.terminalStepKeys).toEqual(["join"]);

      // Verify roots are pending and dependents are blocked
      const rootStep = body.steps.find((s: any) => s.stepKey === "root");
      const branchStep = body.steps.find((s: any) => s.stepKey === "branch_a");
      expect(rootStep.status).toBe("pending");
      expect(branchStep.status).toBe("blocked");
    });

    it("enforces idempotency key on repeated DAG submissions", async () => {
      const idempotencyKey = `idem-dag-${generateUUIDv7()}`;
      const payload = {
        tenantId,
        taskType: "idempotent_dag",
        steps: [
          { stepKey: "s1", name: "S1", dependencies: [] },
          { stepKey: "s2", name: "S2", dependencies: ["s1"] },
        ],
      };

      const res1 = await app.inject({
        method: "POST",
        url: "/v1/tasks/dag",
        headers: { "idempotency-key": idempotencyKey },
        payload,
      });
      expect(res1.statusCode).toBe(202);
      const body1 = JSON.parse(res1.body);

      const res2 = await app.inject({
        method: "POST",
        url: "/v1/tasks/dag",
        headers: { "idempotency-key": idempotencyKey },
        payload,
      });
      expect(res2.statusCode).toBe(202);
      const body2 = JSON.parse(res2.body);

      expect(body2.taskId).toBe(body1.taskId);
      expect(body2.planId).toBe(body1.planId);
    });
  });

  describe("T-API-02: GET /v1/tasks/:id/dag", () => {
    it("returns 400 if taskId is not a valid UUID", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/tasks/invalid-uuid-format/dag",
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe("INVALID_TASK_ID");
    });

    it("returns 404 if DAG task is not found", async () => {
      const randomId = generateUUIDv7();
      const res = await app.inject({
        method: "GET",
        url: `/v1/tasks/${randomId}/dag`,
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error).toBe("TASK_NOT_FOUND");
    });

    it("returns full DAG topology, step details, and progression metrics", async () => {
      // 1. Create a DAG task
      const createRes = await app.inject({
        method: "POST",
        url: "/v1/tasks/dag",
        payload: {
          tenantId,
          taskType: "query_test_dag",
          steps: [
            { stepKey: "step_1", name: "Extract", dependencies: [] },
            { stepKey: "step_2", name: "Transform", dependencies: ["step_1"] },
          ],
        },
      });
      const created = JSON.parse(createRes.body);

      // 2. Query DAG execution details
      const getRes = await app.inject({
        method: "GET",
        url: `/v1/tasks/${created.taskId}/dag`,
      });

      expect(getRes.statusCode).toBe(200);
      const dag = JSON.parse(getRes.body);

      expect(dag.taskId).toBe(created.taskId);
      expect(dag.tenantId).toBe(tenantId);
      expect(dag.status).toBe("pending");
      expect(dag.plan.id).toBe(created.planId);
      expect(dag.plan.version).toBe(1);
      expect(dag.execution.id).toBe(created.executionId);

      // Metrics verification
      expect(dag.metrics.totalSteps).toBe(2);
      expect(dag.metrics.pendingSteps).toBe(1);
      expect(dag.metrics.blockedSteps).toBe(1);
      expect(dag.metrics.completedSteps).toBe(0);
      expect(dag.metrics.isComplete).toBe(false);

      // Steps verification
      expect(dag.steps).toHaveLength(2);
      const step1 = dag.steps.find((s: any) => s.stepKey === "step_1");
      const step2 = dag.steps.find((s: any) => s.stepKey === "step_2");

      expect(step1.status).toBe("pending");
      expect(step1.dependencies).toEqual([]);
      expect(step1.downstream).toEqual(["step_2"]);
      expect(step1.assignedResource).toBeDefined();
      expect(step1.assignedResource.provider).toBeDefined();

      expect(step2.status).toBe("blocked");
      expect(step2.dependencies).toEqual(["step_1"]);
      expect(step2.downstream).toEqual([]);
    });
  });
});

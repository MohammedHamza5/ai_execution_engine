import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServer } from "../src/api/server.js";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrator.js";
import { ensureDefaultTenant } from "../src/api/routes/tasks.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";
import { FastifyInstance } from "fastify";

describe("API & Idempotency Tests", () => {
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

  it("POST /v1/tasks returns 202 Accepted with durable taskId", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      payload: {
        tenantId,
        taskType: "summarization",
        inputPayload: { prompt: "Summarize this document" },
        priority: 1,
      },
    });

    expect(response.statusCode).toBe(202);
    const body = JSON.parse(response.body);
    expect(body.taskId).toBeDefined();
    expect(body.status).toBe("pending");
    expect(body.planId).toBeDefined();
  });

  it("GET /v1/tasks/:id returns task status", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      payload: {
        tenantId,
        taskType: "qa",
        inputPayload: { prompt: "What is 2+2?" },
      },
    });
    const created = JSON.parse(createRes.body);

    const getRes = await app.inject({
      method: "GET",
      url: `/v1/tasks/${created.taskId}`,
    });

    expect(getRes.statusCode).toBe(200);
    const task = JSON.parse(getRes.body);
    expect(task.id).toBe(created.taskId);
    expect(task.status).toBe("pending");
    expect(task.inputPayload.prompt).toBe("What is 2+2?");
  });

  it("Idempotency-Key prevents duplicate task creation on repeated requests", async () => {
    const idempotencyKey = `idem-${generateUUIDv7()}`;
    const payload = {
      tenantId,
      taskType: "invoice_ocr",
      inputPayload: { documentId: "doc-99" },
    };

    // First request
    const res1 = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: { "idempotency-key": idempotencyKey },
      payload,
    });
    expect(res1.statusCode).toBe(202);
    const body1 = JSON.parse(res1.body);

    // Second request with exact same idempotency key
    const res2 = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: { "idempotency-key": idempotencyKey },
      payload,
    });
    expect(res2.statusCode).toBe(202);
    const body2 = JSON.parse(res2.body);

    // Assert that the exact same task ID was returned, avoiding duplicate task creation
    expect(body2.taskId).toBe(body1.taskId);

    // Assert in database that only ONE task exists with this ID
    const countResult = await db.query(
      "SELECT count(*) FROM tasks.tasks WHERE id = $1;",
      [body1.taskId]
    );
    expect(parseInt(countResult.rows[0].count, 10)).toBe(1);
  });
});

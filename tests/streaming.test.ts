import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServer } from "../src/api/server.js";
import { taskEventBroadcaster } from "../src/streaming/taskEventBroadcaster.js";
import { db } from "../src/db/client.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";
import { FastifyInstance } from "fastify";

describe("Real-Time Event Broadcaster", () => {
  it("should broadcast typed events to active task subscribers", () => {
    const taskId = generateUUIDv7();
    const receivedEvents: any[] = [];

    const unsubscribe = taskEventBroadcaster.subscribe(taskId, (ev) => {
      receivedEvents.push(ev);
    });

    expect(taskEventBroadcaster.getSubscriberCount(taskId)).toBe(1);

    taskEventBroadcaster.broadcast({
      taskId,
      eventType: "step_started",
      payload: { stepKey: "step_1", model: "gemini-3.8-flash" },
    });

    taskEventBroadcaster.broadcast({
      taskId,
      eventType: "artifact_emitted",
      payload: { stepKey: "step_1", artifactHash: "sha256-test-hash" },
    });

    expect(receivedEvents).toHaveLength(2);
    expect(receivedEvents[0].eventType).toBe("step_started");
    expect(receivedEvents[0].payload.stepKey).toBe("step_1");
    expect(receivedEvents[1].eventType).toBe("artifact_emitted");

    // Unsubscribe cleanup
    unsubscribe();
    expect(taskEventBroadcaster.getSubscriberCount(taskId)).toBe(0);
  });

  it("should replay recent events to new late subscribers", () => {
    const taskId = generateUUIDv7();

    // Broadcast before subscription
    taskEventBroadcaster.broadcast({
      taskId,
      eventType: "task_started",
      payload: { strategy: "dag_workflow" },
    });

    const received: any[] = [];
    const unsubscribe = taskEventBroadcaster.subscribe(taskId, (ev) => {
      received.push(ev);
    });

    expect(received).toHaveLength(1);
    expect(received[0].eventType).toBe("task_started");

    unsubscribe();
  });
});

describe("SSE Stream Route GET /v1/tasks/:id/stream", () => {
  let app: FastifyInstance;
  let testTenantId: string;

  beforeAll(async () => {
    app = buildServer();
    await app.ready();

    testTenantId = generateUUIDv7();
    await db.query(
      `INSERT INTO identity.tenants (id, name, slug)
       VALUES ($1, 'Stream Test Tenant', $2)
       ON CONFLICT (id) DO NOTHING;`,
      [testTenantId, `stream-tenant-${testTenantId}`]
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it("should return 400 for invalid task UUID format", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/tasks/invalid-uuid/stream",
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe("INVALID_TASK_ID");
  });

  it("should return 404 for non-existent task", async () => {
    const nonExistentId = generateUUIDv7();
    const response = await app.inject({
      method: "GET",
      url: `/v1/tasks/${nonExistentId}/stream`,
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.error).toBe("TASK_NOT_FOUND");
  });

  it("should establish SSE stream and emit terminal status for completed task", async () => {
    const taskId = generateUUIDv7();
    await db.query(
      `INSERT INTO tasks.tasks (id, tenant_id, task_type, status, input_payload)
       VALUES ($1, $2, 'stream_test_task', 'completed', '{}');`,
      [taskId, testTenantId]
    );

    const response = await app.inject({
      method: "GET",
      url: `/v1/tasks/${taskId}/stream`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.body).toContain("event: connected");
    expect(response.body).toContain("event: task_completed");
    expect(response.body).toContain("event: done");
  });
});

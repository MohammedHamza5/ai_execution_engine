import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServer } from "../src/api/server.js";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrator.js";
import { ensureDefaultTenant } from "../src/api/routes/tasks.js";
import { ExecutionWorker } from "../src/engine/worker.js";
import { FastifyInstance } from "fastify";

describe("M0 End-to-End Execution Vertical Slice", () => {
  let app: FastifyInstance;
  let tenantId: string;
  let worker: ExecutionWorker;

  beforeAll(async () => {
    await runMigrations();
    tenantId = await ensureDefaultTenant();
    app = buildServer();
    await app.ready();
    worker = new ExecutionWorker();
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it("executes complete lifecycle: API 202 -> DB -> Plan -> Step -> Worker -> Adapter -> Artifact -> Validation -> Task COMPLETED", async () => {
    // 1. Submit task via API
    const postResponse = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      payload: {
        tenantId,
        taskType: "e2e_verification",
        inputPayload: { prompt: "Write an introduction to AI infrastructure" },
        priority: 15,
      },
    });

    expect(postResponse.statusCode).toBe(202);
    const postBody = JSON.parse(postResponse.body);
    const taskId = postBody.taskId;
    expect(taskId).toBeDefined();

    // Verify task is initially pending
    const initialGet = await app.inject({
      method: "GET",
      url: `/v1/tasks/${taskId}`,
    });
    expect(initialGet.statusCode).toBe(200);
    const initialTask = JSON.parse(initialGet.body);
    expect(initialTask.status).toBe("pending");
    expect(initialTask.outputArtifactId).toBeNull();

    // 2. Worker executes single step from queue (FOR UPDATE SKIP LOCKED)
    const claimedAndProcessed = await worker.claimAndExecuteNext(postBody.stepExecutionId);
    expect(claimedAndProcessed).toBe(true);

    // 3. Inspect task status via API - MUST now be 'completed' with output artifact
    const finalGet = await app.inject({
      method: "GET",
      url: `/v1/tasks/${taskId}`,
    });
    expect(finalGet.statusCode).toBe(200);
    const completedTask = JSON.parse(finalGet.body);

    expect(completedTask.status).toBe("completed");
    expect(completedTask.outputArtifactId).toBeDefined();
    expect(completedTask.qualityScore).toBe(1.0);
    expect(completedTask.completedAt).not.toBeNull();

    // 4. Retrieve verified artifact via API
    const artifactRes = await app.inject({
      method: "GET",
      url: `/v1/tasks/${taskId}/artifact`,
    });
    expect(artifactRes.statusCode).toBe(200);
    const artifact = JSON.parse(artifactRes.body);

    expect(artifact.id).toBe(completedTask.outputArtifactId);
    expect(artifact.content_hash).toBeDefined();
    expect(artifact.inline_content).toContain("Simulated Response");
    expect(artifact.status).toBe("active");

    // 5. Verify outbox domain events were recorded in PostgreSQL
    const outboxEvents = await db.query(
      "SELECT * FROM system.outbox_events WHERE aggregate_id = $1 ORDER BY created_at ASC;",
      [taskId]
    );

    expect(outboxEvents.rows.length).toBeGreaterThanOrEqual(2);
    expect(outboxEvents.rows[0].event_type).toBe("TASK_CREATED");
    expect(outboxEvents.rows[1].event_type).toBe("TASK_COMPLETED");
  });
});

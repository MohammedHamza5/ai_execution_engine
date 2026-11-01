import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { db } from "../../db/client.js";
import { taskEventBroadcaster, TaskStreamEvent } from "../../streaming/taskEventBroadcaster.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const streamRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get<{ Params: { id: string } }>("/v1/tasks/:id/stream", async (request, reply) => {
    const { id: taskId } = request.params;

    // 1. Validation
    if (!UUID_REGEX.test(taskId)) {
      reply.status(400).send({
        error: "INVALID_TASK_ID",
        message: `Task ID "${taskId}" is not a valid UUIDv7`,
      });
      return;
    }

    // 2. Verify Task Existence
    const taskRes = await db.query(
      `SELECT id, status, task_type, created_at FROM tasks.tasks WHERE id = $1;`,
      [taskId]
    );

    if (taskRes.rows.length === 0) {
      reply.status(404).send({
        error: "TASK_NOT_FOUND",
        message: `Task ${taskId} was not found`,
      });
      return;
    }

    const task = taskRes.rows[0];

    // 3. Establish Server-Sent Events (SSE) Stream
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*",
    });

    // Send initial connected handshake event
    reply.raw.write(
      `event: connected\ndata: ${JSON.stringify({
        taskId: task.id,
        status: task.status,
        taskType: task.task_type,
        timestamp: new Date().toISOString(),
      })}\n\n`
    );

    // If task is already finalized, send terminal state and close immediately
    if (task.status === "completed" || task.status === "failed") {
      reply.raw.write(
        `event: ${task.status === "completed" ? "task_completed" : "task_failed"}\ndata: ${JSON.stringify({
          taskId: task.id,
          finalStatus: task.status,
        })}\n\n`
      );
      reply.raw.write(`event: done\ndata: {}\n\n`);
      reply.raw.end();
      return;
    }

    // 4. Subscribe to Real-Time Event Stream
    const unsubscribe = taskEventBroadcaster.subscribe(taskId, (event: TaskStreamEvent) => {
      reply.raw.write(
        `event: ${event.eventType}\ndata: ${JSON.stringify({
          eventId: event.eventId,
          eventType: event.eventType,
          taskId: event.taskId,
          timestamp: event.timestamp,
          payload: event.payload,
        })}\n\n`
      );

      // Finalize and close stream on task completion or failure
      if (event.eventType === "task_completed" || event.eventType === "task_failed") {
        reply.raw.write(`event: done\ndata: {}\n\n`);
        clearInterval(heartbeat);
        unsubscribe();
        reply.raw.end();
      }
    });

    // 5. Keep-Alive Heartbeat (every 15s)
    const heartbeat = setInterval(() => {
      reply.raw.write(`: ping\n\n`);
    }, 15000);

    // 6. Clean Cleanup on Client Disconnect
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });

    return;
  });
};

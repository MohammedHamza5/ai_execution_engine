import { FastifyInstance, FastifyRequest } from "fastify";
import { db } from "../../db/client.js";
import { buildFleetConfigs } from "../../resources/fleetSeedConfig.js";

export async function dashboardRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /v1/fleet -> Live Fleet status, models, quotas, circuit breakers, and taxonomy
  fastify.get("/v1/fleet", async () => {
    const query = `
      SELECT r.id AS "resourceId", r.status, r.priority,
             p.slug AS "providerSlug", p.name AS "providerName", p.type AS "providerType",
             m.slug AS "modelSlug", m.name AS "modelName", m.metadata AS "modelMetadata",
             h.status AS "healthStatus", h.circuit_state AS "circuitState",
             h.latency_p95_ms AS "latencyP95Ms",
             q.quota_type AS "quotaType", q.limit_value AS "limitValue", q.remaining_value AS "remainingValue"
      FROM resources.resources r
      JOIN ai.providers p ON r.provider_id = p.id
      JOIN ai.models m ON r.model_id = m.id
      LEFT JOIN resources.resource_health h ON r.id = h.resource_id
      LEFT JOIN resources.resource_quotas q ON r.id = q.resource_id
      WHERE r.status = 'active'
      ORDER BY r.priority DESC, p.slug ASC;
    `;
    const result = await db.query(query);

    const fleetConfigs = buildFleetConfigs();
    const fleetMap = new Map(
      fleetConfigs.map((cfg) => [`${cfg.providerSlug}:${cfg.modelSlug}`, cfg])
    );

    const resources = result.rows.map((row) => {
      const cfg = fleetMap.get(`${row.providerSlug}:${row.modelSlug}`);
      const fallbackTaxonomy = {
        tier: row.priority >= 90 ? "FRONTIER_HEAVYWEIGHT" : row.priority >= 10 ? "BALANCED_WORKHORSE" : "EDGE_LIGHT",
        archetype: row.providerSlug === "groq" || row.providerSlug === "cerebras" ? "FAST_REFLEX" : "BALANCED_COMPLETION",
        specializedDomains: ["GENERAL_KNOWLEDGE", "CODE_GENERATION"],
      };
      return {
        ...row,
        taxonomy: cfg?.taxonomy || fallbackTaxonomy,
        capabilities: cfg?.capabilities || row.modelMetadata?.capabilities || ["text"],
        qualityEstimate: row.priority >= 95 ? 0.98 : row.priority >= 80 ? 0.94 : 0.88,
      };
    });

    return { resources };
  });

  // GET /v1/tasks -> Recent tasks list
  fastify.get("/v1/tasks", async (request: FastifyRequest<{ Querystring: { limit?: string; status?: string } }>) => {
    const limit = Math.min(parseInt(request.query.limit || "50", 10), 100);
    const statusFilter = request.query.status;

    let query = `
      SELECT t.id, t.tenant_id AS "tenantId", t.task_type AS "taskType", t.status, t.priority,
             t.quality_score AS "qualityScore", t.output_artifact_id AS "outputArtifactId",
             t.started_at AS "startedAt", t.completed_at AS "completedAt", t.created_at AS "createdAt",
             (SELECT COUNT(*) FROM execution.step_executions s WHERE s.task_id = t.id) AS "stepCount",
             (SELECT COUNT(*) FROM execution.step_executions s WHERE s.task_id = t.id AND s.status = 'completed') AS "completedStepCount"
      FROM tasks.tasks t
    `;
    const params: unknown[] = [];
    if (statusFilter) {
      params.push(statusFilter);
      query += ` WHERE t.status = $1`;
    }
    query += ` ORDER BY t.created_at DESC LIMIT ${limit};`;

    const result = await db.query(query, params);
    return { tasks: result.rows };
  });

  // GET /v1/telemetry -> System stats, queue status, outbox count
  fastify.get("/v1/telemetry", async () => {
    const queueStats = await db.query(`
      SELECT status, COUNT(*)::int AS count
      FROM execution.step_executions
      GROUP BY status;
    `);

    const outboxStats = await db.query(`
      SELECT COUNT(*)::int AS "pendingOutbox"
      FROM system.outbox_events
      WHERE published_at IS NULL;
    `);

    const taskStats = await db.query(`
      SELECT status, COUNT(*)::int AS count
      FROM tasks.tasks
      GROUP BY status;
    `);

    return {
      queue: queueStats.rows,
      outbox: outboxStats.rows[0],
      tasks: taskStats.rows,
      timestamp: new Date().toISOString(),
    };
  });
}

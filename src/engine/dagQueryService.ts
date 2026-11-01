import { db } from "../db/client.js";

export interface DAGStepQueryDetail {
  readonly stepKey: string;
  readonly planStepId: string;
  readonly stepExecutionId: string;
  readonly name: string;
  readonly description?: string;
  readonly stepType: string;
  readonly orderIndex: number;
  readonly status: string;
  readonly dependencies: ReadonlyArray<string>;
  readonly downstream: ReadonlyArray<string>;
  readonly assignedResource?: {
    readonly resourceId: string;
    readonly provider: string;
    readonly model: string;
  };
  readonly qualityScore?: number;
  readonly outputArtifactId?: string;
  readonly latencyMs?: number;
  readonly attemptsCount: number;
  readonly fencingToken: number;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export interface DAGTaskDetails {
  readonly taskId: string;
  readonly tenantId: string;
  readonly taskType: string;
  readonly status: string;
  readonly priority: number;
  readonly qualityScore?: number;
  readonly outputArtifactId?: string;
  readonly plan: {
    readonly id: string;
    readonly version: number;
    readonly status: string;
    readonly strategy: string;
  };
  readonly execution: {
    readonly id: string;
    readonly status: string;
    readonly totalCost: number;
    readonly retryCount: number;
  };
  readonly metrics: {
    readonly totalSteps: number;
    readonly completedSteps: number;
    readonly pendingSteps: number;
    readonly runningSteps: number;
    readonly blockedSteps: number;
    readonly failedSteps: number;
    readonly isComplete: boolean;
  };
  readonly steps: ReadonlyArray<DAGStepQueryDetail>;
  readonly rootStepKeys: ReadonlyArray<string>;
  readonly terminalStepKeys: ReadonlyArray<string>;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export class DAGQueryService {
  /**
   * Retrieves durable DAG execution details, topology, and step statuses.
   * Strips all internal secrets and credential references.
   */
  public static async getDAGDetails(taskId: string): Promise<DAGTaskDetails | null> {
    // 1. Fetch Task
    const taskRes = await db.query(
      `SELECT id, tenant_id, task_type, status, priority, quality_score,
              output_artifact_id, started_at, completed_at, created_at
       FROM tasks.tasks
       WHERE id = $1;`,
      [taskId]
    );

    if (taskRes.rows.length === 0) {
      return null;
    }
    const taskRow = taskRes.rows[0];

    // 2. Fetch Active Execution Plan
    const planRes = await db.query(
      `SELECT id, version, status, strategy
       FROM planning.execution_plans
       WHERE task_id = $1
       ORDER BY version DESC
       LIMIT 1;`,
      [taskId]
    );

    if (planRes.rows.length === 0) {
      return null;
    }
    const planRow = planRes.rows[0];

    // 3. Fetch Execution Instance
    const execRes = await db.query(
      `SELECT id, status, total_cost, retry_count
       FROM execution.executions
       WHERE task_id = $1 AND plan_id = $2
       ORDER BY created_at DESC
       LIMIT 1;`,
      [taskId, planRow.id]
    );

    const execRow = execRes.rows[0] || {
      id: "unknown",
      status: "pending",
      total_cost: "0",
      retry_count: 0,
    };

    // 4. Fetch Plan Steps & Joined Executions (Sanitized Resources)
    const stepsRes = await db.query(
      `SELECT ps.id AS plan_step_id,
              ps.step_key,
              ps.name,
              ps.description,
              ps.step_type,
              ps.order_index,
              se.id AS step_execution_id,
              COALESCE(se.status, 'pending') AS step_status,
              COALESCE(se.fencing_token, 0) AS fencing_token,
              se.latency_ms,
              se.quality_score AS step_quality_score,
              se.started_at AS step_started_at,
              se.completed_at AS step_completed_at,
              r.id AS resource_id,
              p.slug AS provider_slug,
              m.slug AS model_slug,
              a.id AS output_artifact_id,
              (SELECT COUNT(*) FROM execution.execution_attempts ea WHERE ea.step_execution_id = se.id) AS attempts_count
       FROM planning.plan_steps ps
       LEFT JOIN execution.step_executions se ON se.plan_step_id = ps.id AND se.execution_id = $1
       LEFT JOIN resources.resources r ON ps.assigned_resource_id = r.id
       LEFT JOIN ai.providers p ON r.provider_id = p.id
       LEFT JOIN ai.models m ON r.model_id = m.id
       LEFT JOIN artifacts.artifacts a ON a.producer_id = se.id
       WHERE ps.plan_id = $2
       ORDER BY ps.order_index ASC;`,
      [execRow.id, planRow.id]
    );

    // 5. Fetch Dependencies for Plan
    const depRes = await db.query(
      `SELECT ps_child.step_key AS child_step_key,
              ps_parent.step_key AS parent_step_key
       FROM planning.step_dependencies sd
       JOIN planning.plan_steps ps_child ON sd.plan_step_id = ps_child.id
       JOIN planning.plan_steps ps_parent ON sd.depends_on_step_id = ps_parent.id
       WHERE ps_child.plan_id = $1;`,
      [planRow.id]
    );

    const parentMap = new Map<string, string[]>();
    const downstreamMap = new Map<string, string[]>();

    for (const row of stepsRes.rows) {
      parentMap.set(row.step_key, []);
      downstreamMap.set(row.step_key, []);
    }

    for (const dep of depRes.rows) {
      if (parentMap.has(dep.child_step_key)) {
        parentMap.get(dep.child_step_key)!.push(dep.parent_step_key);
      }
      if (downstreamMap.has(dep.parent_step_key)) {
        downstreamMap.get(dep.parent_step_key)!.push(dep.child_step_key);
      }
    }

    // 6. Build Step Details and Compute Graph Metrics
    let completedSteps = 0;
    let pendingSteps = 0;
    let runningSteps = 0;
    let blockedSteps = 0;
    let failedSteps = 0;

    const rootStepKeys: string[] = [];
    const terminalStepKeys: string[] = [];

    const steps: DAGStepQueryDetail[] = stepsRes.rows.map((row) => {
      const deps = parentMap.get(row.step_key) || [];
      const downstream = downstreamMap.get(row.step_key) || [];

      if (deps.length === 0) rootStepKeys.push(row.step_key);
      if (downstream.length === 0) terminalStepKeys.push(row.step_key);

      const status = row.step_status;
      if (status === "completed") completedSteps++;
      else if (status === "running") runningSteps++;
      else if (status === "blocked") blockedSteps++;
      else if (status === "failed") failedSteps++;
      else pendingSteps++;

      return {
        stepKey: row.step_key,
        planStepId: row.plan_step_id,
        stepExecutionId: row.step_execution_id || "",
        name: row.name,
        description: row.description || undefined,
        stepType: row.step_type,
        orderIndex: row.order_index,
        status,
        dependencies: deps,
        downstream,
        assignedResource: row.resource_id
          ? {
              resourceId: row.resource_id,
              provider: row.provider_slug || "unknown",
              model: row.model_slug || "unknown",
            }
          : undefined,
        qualityScore: row.step_quality_score ? parseFloat(row.step_quality_score) : undefined,
        outputArtifactId: row.output_artifact_id || undefined,
        latencyMs: row.latency_ms ? parseInt(row.latency_ms, 10) : undefined,
        attemptsCount: parseInt(row.attempts_count || "0", 10),
        fencingToken: parseInt(row.fencing_token || "0", 10),
        startedAt: row.step_started_at ? new Date(row.step_started_at).toISOString() : undefined,
        completedAt: row.step_completed_at ? new Date(row.step_completed_at).toISOString() : undefined,
      };
    });

    const isComplete = taskRow.status === "completed" || taskRow.status === "failed";

    return {
      taskId: taskRow.id,
      tenantId: taskRow.tenant_id,
      taskType: taskRow.task_type,
      status: taskRow.status,
      priority: taskRow.priority,
      qualityScore: taskRow.quality_score ? parseFloat(taskRow.quality_score) : undefined,
      outputArtifactId: taskRow.output_artifact_id || undefined,
      plan: {
        id: planRow.id,
        version: planRow.version,
        status: planRow.status,
        strategy: planRow.strategy,
      },
      execution: {
        id: execRow.id,
        status: execRow.status,
        totalCost: parseFloat(execRow.total_cost || "0"),
        retryCount: execRow.retry_count || 0,
      },
      metrics: {
        totalSteps: steps.length,
        completedSteps,
        pendingSteps,
        runningSteps,
        blockedSteps,
        failedSteps,
        isComplete,
      },
      steps,
      rootStepKeys: rootStepKeys.sort(),
      terminalStepKeys: terminalStepKeys.sort(),
      createdAt: new Date(taskRow.created_at).toISOString(),
      startedAt: taskRow.started_at ? new Date(taskRow.started_at).toISOString() : undefined,
      completedAt: taskRow.completed_at ? new Date(taskRow.completed_at).toISOString() : undefined,
    };
  }
}

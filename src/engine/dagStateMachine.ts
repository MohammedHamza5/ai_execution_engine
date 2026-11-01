import { PoolClient } from "pg";
import { generateUUIDv7 } from "../domain/common/id.js";
import { DAGStepStatus } from "../domain/dag/types.js";

const VALID_TRANSITIONS: Record<DAGStepStatus, ReadonlySet<DAGStepStatus>> = {
  blocked: new Set(["pending", "failed", "cancelled"]),
  pending: new Set(["running", "failed", "cancelled"]),
  running: new Set(["completed", "pending", "diagnosing", "failed", "cancelled"]),
  diagnosing: new Set(["pending", "failed", "cancelled"]),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
};

const TERMINAL_STATUSES: ReadonlySet<DAGStepStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

export interface TransitionStepParams {
  readonly stepExecutionId: string;
  readonly targetStatus: DAGStepStatus;
  readonly expectedStatus?: DAGStepStatus;
  readonly fencingToken?: number;
  readonly failureReason?: string;
}

export class DAGStateMachine {
  public static isTerminal(status: DAGStepStatus): boolean {
    return TERMINAL_STATUSES.has(status);
  }

  public static canTransition(from: DAGStepStatus, to: DAGStepStatus): boolean {
    if (from === to) return true;
    const allowed = VALID_TRANSITIONS[from];
    return Boolean(allowed && allowed.has(to));
  }

  public static assertTransition(from: DAGStepStatus, to: DAGStepStatus): void {
    if (!this.canTransition(from, to)) {
      throw new Error(
        `INVALID_DAG_STATE_TRANSITION: Cannot transition step from '${from}' to '${to}'`
      );
    }
  }

  public static async transitionStep(
    client: PoolClient,
    params: TransitionStepParams
  ): Promise<boolean> {
    const currentRes = await client.query(
      `SELECT status, fencing_token, execution_id, task_id, plan_step_id 
       FROM execution.step_executions WHERE id = $1 FOR UPDATE;`,
      [params.stepExecutionId]
    );

    if (currentRes.rows.length === 0) {
      throw new Error(`STEP_EXECUTION_NOT_FOUND: Step execution '${params.stepExecutionId}' does not exist.`);
    }

    const row = currentRes.rows[0];
    const currentStatus = row.status as DAGStepStatus;

    if (params.expectedStatus && currentStatus !== params.expectedStatus) {
      throw new Error(
        `STATUS_MISMATCH: Step execution '${params.stepExecutionId}' is in status '${currentStatus}', expected '${params.expectedStatus}'.`
      );
    }

    if (params.fencingToken !== undefined && parseInt(row.fencing_token, 10) !== params.fencingToken) {
      throw new Error(
        `FENCING_TOKEN_MISMATCH: Step execution '${params.stepExecutionId}' fencing token mismatch.`
      );
    }

    this.assertTransition(currentStatus, params.targetStatus);

    await client.query(
      `UPDATE execution.step_executions
       SET status = $1, updated_at = now()
       WHERE id = $2;`,
      [params.targetStatus, params.stepExecutionId]
    );

    await client.query(
      `INSERT INTO system.outbox_events (
        id, event_id, event_type, aggregate_type, aggregate_id, payload
      ) VALUES (
        gen_random_uuid(), $1, 'STEP_STATUS_TRANSITIONED', 'step_execution', $2, $3
      );`,
      [
        generateUUIDv7(),
        params.stepExecutionId,
        JSON.stringify({
          stepExecutionId: params.stepExecutionId,
          executionId: row.execution_id,
          taskId: row.task_id,
          fromStatus: currentStatus,
          toStatus: params.targetStatus,
          reason: params.failureReason || null,
        }),
      ]
    );

    return true;
  }

  public static async failStepCascading(
    client: PoolClient,
    params: {
      readonly failedStepExecutionId: string;
      readonly executionId: string;
      readonly reason: string;
    }
  ): Promise<string[]> {
    const stepRes = await client.query(
      `SELECT plan_step_id FROM execution.step_executions WHERE id = $1;`,
      [params.failedStepExecutionId]
    );
    if (stepRes.rows.length === 0) return [];
    const rootPlanStepId = stepRes.rows[0].plan_step_id;

    const downstreamRes = await client.query(
      `WITH RECURSIVE downstream AS (
         SELECT depends_on_step_id, plan_step_id
         FROM planning.step_dependencies
         WHERE depends_on_step_id = $1
         UNION
         SELECT d.depends_on_step_id, d.plan_step_id
         FROM planning.step_dependencies d
         JOIN downstream dw ON d.depends_on_step_id = dw.plan_step_id
       )
       SELECT DISTINCT dw.plan_step_id, se.id AS step_execution_id, se.status, ps.step_key
       FROM downstream dw
       JOIN execution.step_executions se ON se.plan_step_id = dw.plan_step_id AND se.execution_id = $2
       JOIN planning.plan_steps ps ON ps.id = dw.plan_step_id
       WHERE se.status IN ('blocked', 'pending');`,
      [rootPlanStepId, params.executionId]
    );

    const affectedIds: string[] = [];
    for (const row of downstreamRes.rows) {
      await client.query(
        `UPDATE execution.step_executions
         SET status = 'failed', updated_at = now()
         WHERE id = $1;`,
        [row.step_execution_id]
      );
      affectedIds.push(row.step_execution_id);

      await client.query(
        `INSERT INTO system.outbox_events (
          id, event_id, event_type, aggregate_type, aggregate_id, payload
        ) VALUES (
          gen_random_uuid(), $1, 'STEP_CASCADED_FAILURE', 'step_execution', $2, $3
        );`,
        [
          generateUUIDv7(),
          row.step_execution_id,
          JSON.stringify({
            stepExecutionId: row.step_execution_id,
            stepKey: row.step_key,
            executionId: params.executionId,
            causedByStepExecutionId: params.failedStepExecutionId,
            reason: `UPSTREAM_FAILED: ${params.reason}`,
          }),
        ]
      );
    }

    return affectedIds;
  }
}

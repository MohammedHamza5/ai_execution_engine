import { PoolClient } from "pg";
import { generateUUIDv7 } from "../domain/common/id.js";
import { DAGDependencyResolver } from "./dagDependencyResolver.js";

export interface ReapedStepResult {
  readonly stepExecutionId: string;
  readonly executionId: string;
  readonly previousWorkerId: string | null;
  readonly newFencingToken: number;
}

export class DAGRecoveryManager {
  public static async reapExpiredLeases(
    client: PoolClient,
    params?: { readonly executionId?: string }
  ): Promise<ReapedStepResult[]> {
    const query = params?.executionId
      ? `SELECT id, execution_id, worker_id, fencing_token
         FROM execution.step_executions
         WHERE execution_id = $1
           AND status = 'running'
           AND lease_expires_at <= now()
         FOR UPDATE SKIP LOCKED;`
      : `SELECT id, execution_id, worker_id, fencing_token
         FROM execution.step_executions
         WHERE status = 'running'
           AND lease_expires_at <= now()
         FOR UPDATE SKIP LOCKED;`;

    const res = params?.executionId
      ? await client.query(query, [params.executionId])
      : await client.query(query);

    const reaped: ReapedStepResult[] = [];

    for (const row of res.rows) {
      const updateRes = await client.query(
        `UPDATE execution.step_executions
         SET status = 'pending',
             worker_id = NULL,
             lease_token = NULL,
             lease_expires_at = NULL,
             available_at = now(),
             fencing_token = fencing_token + 1,
             updated_at = now()
         WHERE id = $1
         RETURNING fencing_token;`,
        [row.id]
      );

      const newFencingToken = parseInt(updateRes.rows[0].fencing_token, 10);
      reaped.push({
        stepExecutionId: row.id,
        executionId: row.execution_id,
        previousWorkerId: row.worker_id,
        newFencingToken,
      });

      await client.query(
        `INSERT INTO system.outbox_events (
          id, event_id, event_type, aggregate_type, aggregate_id, payload
        ) VALUES (
          gen_random_uuid(), $1, 'WORKER_LEASE_REAPED', 'step_execution', $2, $3
        );`,
        [
          generateUUIDv7(),
          row.id,
          JSON.stringify({
            stepExecutionId: row.id,
            executionId: row.execution_id,
            previousWorkerId: row.worker_id,
            newFencingToken,
            reason: "LEASE_EXPIRED_ZOMBIE_REAPED",
          }),
        ]
      );
    }

    return reaped;
  }

  public static async resumeExecution(
    client: PoolClient,
    executionId: string
  ): Promise<{ reapedSteps: number; unblockedSteps: number }> {
    const reaped = await this.reapExpiredLeases(client, { executionId });
    const unblocked = await DAGDependencyResolver.unblockReadySteps(client, executionId);

    return {
      reapedSteps: reaped.length,
      unblockedSteps: unblocked.length,
    };
  }
}

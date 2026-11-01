import { PoolClient } from "pg";
import { generateUUIDv7 } from "../domain/common/id.js";
import { DAGDependencyResolver } from "./dagDependencyResolver.js";

export interface ParallelDispatchResult {
  readonly executionId: string;
  readonly dispatchedStepExecutionIds: ReadonlyArray<string>;
  readonly inFlightCount: number;
  readonly backpressureApplied: boolean;
  readonly availableSlots: number;
}

export class DAGParallelExecutor {
  public static readonly DEFAULT_MAX_PARALLEL_STEPS = 5;
  public static readonly DEFAULT_LEASE_DURATION_SECONDS = 60;

  public static async getInFlightCount(
    client: PoolClient,
    executionId: string
  ): Promise<number> {
    const res = await client.query(
      `SELECT COUNT(*) AS in_flight_count
       FROM execution.step_executions
       WHERE execution_id = $1 AND status = 'running';`,
      [executionId]
    );
    return parseInt(res.rows[0].in_flight_count, 10);
  }

  public static async dispatchReadySteps(
    client: PoolClient,
    params: {
      readonly executionId: string;
      readonly maxConcurrency?: number;
      readonly workerId?: string;
      readonly leaseDurationSeconds?: number;
    }
  ): Promise<ParallelDispatchResult> {
    const maxConcurrency = params.maxConcurrency || this.DEFAULT_MAX_PARALLEL_STEPS;
    const leaseSeconds = params.leaseDurationSeconds || this.DEFAULT_LEASE_DURATION_SECONDS;
    const workerId = params.workerId || generateUUIDv7();

    // 1. Reactive unblocking of ready steps
    await DAGDependencyResolver.unblockReadySteps(client, params.executionId);

    // 2. Measure in-flight running steps
    const currentInFlight = await this.getInFlightCount(client, params.executionId);
    const availableSlots = Math.max(0, maxConcurrency - currentInFlight);

    if (availableSlots === 0) {
      return {
        executionId: params.executionId,
        dispatchedStepExecutionIds: [],
        inFlightCount: currentInFlight,
        backpressureApplied: true,
        availableSlots: 0,
      };
    }

    // 3. Select up to availableSlots pending steps using SKIP LOCKED (ADR-094)
    const pendingRes = await client.query(
      `SELECT s.id, s.fencing_token, s.priority, s.plan_step_id, ps.step_key
       FROM execution.step_executions s
       JOIN planning.plan_steps ps ON s.plan_step_id = ps.id
       WHERE s.execution_id = $1
         AND s.status = 'pending'
         AND s.available_at <= now()
       ORDER BY s.priority DESC, ps.order_index ASC, s.available_at ASC
       FOR UPDATE OF s SKIP LOCKED
       LIMIT $2;`,
      [params.executionId, availableSlots]
    );

    const dispatchedIds: string[] = [];

    for (const row of pendingRes.rows) {
      const leaseToken = generateUUIDv7();

      await client.query(
        `UPDATE execution.step_executions
         SET status = 'running',
             worker_id = $1,
             lease_token = $2,
             lease_expires_at = now() + ($3 || ' seconds')::interval,
             fencing_token = fencing_token + 1,
             started_at = COALESCE(started_at, now()),
             updated_at = now()
         WHERE id = $4;`,
        [workerId, leaseToken, leaseSeconds, row.id]
      );

      dispatchedIds.push(row.id);

      await client.query(
        `INSERT INTO system.outbox_events (
          id, event_id, event_type, aggregate_type, aggregate_id, payload
        ) VALUES (
          gen_random_uuid(), $1, 'STEP_PARALLEL_DISPATCHED', 'step_execution', $2, $3
        );`,
        [
          generateUUIDv7(),
          row.id,
          JSON.stringify({
            stepExecutionId: row.id,
            stepKey: row.step_key,
            executionId: params.executionId,
            workerId,
            leaseToken,
          }),
        ]
      );
    }

    const finalInFlight = currentInFlight + dispatchedIds.length;
    const remainingSlots = Math.max(0, maxConcurrency - finalInFlight);

    return {
      executionId: params.executionId,
      dispatchedStepExecutionIds: dispatchedIds,
      inFlightCount: finalInFlight,
      backpressureApplied: remainingSlots === 0,
      availableSlots: remainingSlots,
    };
  }
}

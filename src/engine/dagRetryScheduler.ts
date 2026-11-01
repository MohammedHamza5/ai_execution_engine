import { PoolClient } from "pg";
import { generateUUIDv7 } from "../domain/common/id.js";
import { DAGRetryPolicy } from "../domain/dag/types.js";
import { DAGStateMachine } from "./dagStateMachine.js";

export interface DAGRetryDecision {
  readonly shouldRetry: boolean;
  readonly backoffMs: number;
  readonly attemptNumber: number;
  readonly maxAttempts: number;
  readonly action: "RETRY" | "FAIL_TERMINAL" | "MIGRATE_RESOURCE";
  readonly reason: string;
}

export class DAGRetryScheduler {
  public static readonly DEFAULT_MAX_ATTEMPTS = 3;
  public static readonly DEFAULT_BASE_BACKOFF_MS = 1000;
  public static readonly MAX_BACKOFF_MS = 30000;

  public static evaluateRetry(params: {
    readonly attemptNumber: number;
    readonly retryPolicy?: DAGRetryPolicy;
    readonly errorCode?: string;
    readonly isPermanent?: boolean;
  }): DAGRetryDecision {
    const maxAttempts = params.retryPolicy?.maxAttempts ?? this.DEFAULT_MAX_ATTEMPTS;
    const baseBackoff = params.retryPolicy?.backoffMs ?? this.DEFAULT_BASE_BACKOFF_MS;

    if (params.isPermanent) {
      return {
        shouldRetry: false,
        backoffMs: 0,
        attemptNumber: params.attemptNumber,
        maxAttempts,
        action: "FAIL_TERMINAL",
        reason: "NON_RETRYABLE_PERMANENT_ERROR",
      };
    }

    if (params.errorCode === "QUOTA_EXHAUSTED" || params.errorCode === "RATE_LIMIT_EXCEEDED") {
      if (params.attemptNumber < maxAttempts) {
        return {
          shouldRetry: true,
          backoffMs: Math.min(baseBackoff * Math.pow(2, params.attemptNumber - 1), this.MAX_BACKOFF_MS),
          attemptNumber: params.attemptNumber,
          maxAttempts,
          action: "MIGRATE_RESOURCE",
          reason: "QUOTA_EXHAUSTED_MIGRATION_ALLOWED",
        };
      }
    }

    if (params.attemptNumber >= maxAttempts) {
      return {
        shouldRetry: false,
        backoffMs: 0,
        attemptNumber: params.attemptNumber,
        maxAttempts,
        action: "FAIL_TERMINAL",
        reason: `MAX_ATTEMPTS_EXCEEDED (${params.attemptNumber}/${maxAttempts})`,
      };
    }

    const backoffMs = Math.min(
      baseBackoff * Math.pow(2, params.attemptNumber - 1),
      this.MAX_BACKOFF_MS
    );

    return {
      shouldRetry: true,
      backoffMs,
      attemptNumber: params.attemptNumber,
      maxAttempts,
      action: "RETRY",
      reason: "TRANSIENT_FAILURE_RETRY_SCHEDULED",
    };
  }

  public static async handleStepFailure(
    client: PoolClient,
    params: {
      readonly stepExecutionId: string;
      readonly executionId: string;
      readonly attemptNumber: number;
      readonly retryPolicy?: DAGRetryPolicy;
      readonly errorCode?: string;
      readonly failureReason: string;
      readonly isPermanent?: boolean;
      readonly fencingToken?: number;
    }
  ): Promise<DAGRetryDecision> {
    const decision = this.evaluateRetry({
      attemptNumber: params.attemptNumber,
      retryPolicy: params.retryPolicy,
      errorCode: params.errorCode,
      isPermanent: params.isPermanent,
    });

    if (decision.shouldRetry) {
      await client.query(
        `UPDATE execution.step_executions
         SET status = 'pending',
             available_at = now() + ($1 || ' milliseconds')::interval,
             worker_id = NULL,
             lease_token = NULL,
             lease_expires_at = NULL,
             updated_at = now()
         WHERE id = $2;`,
        [decision.backoffMs, params.stepExecutionId]
      );

      await client.query(
        `INSERT INTO system.outbox_events (
          id, event_id, event_type, aggregate_type, aggregate_id, payload
        ) VALUES (
          gen_random_uuid(), $1, 'STEP_RETRY_SCHEDULED', 'step_execution', $2, $3
        );`,
        [
          generateUUIDv7(),
          params.stepExecutionId,
          JSON.stringify({
            stepExecutionId: params.stepExecutionId,
            executionId: params.executionId,
            attemptNumber: params.attemptNumber,
            backoffMs: decision.backoffMs,
            action: decision.action,
            reason: params.failureReason,
          }),
        ]
      );
    } else {
      await DAGStateMachine.transitionStep(client, {
        stepExecutionId: params.stepExecutionId,
        targetStatus: "failed",
        failureReason: params.failureReason,
        fencingToken: params.fencingToken,
      });

      await DAGStateMachine.failStepCascading(client, {
        failedStepExecutionId: params.stepExecutionId,
        executionId: params.executionId,
        reason: params.failureReason,
      });
    }

    return decision;
  }
}

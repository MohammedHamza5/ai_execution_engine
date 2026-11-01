import { PoolClient } from "pg";
import { db } from "../db/client.js";
import { DAGParallelExecutor, ParallelDispatchResult } from "./dagParallelExecutor.js";
import { DAGRetryScheduler, DAGRetryDecision } from "./dagRetryScheduler.js";
import { DAGValidationBarrier, BarrierEvaluationResult } from "./dagValidationBarrier.js";
import { DAGRecoveryManager, ReapedStepResult } from "./dagRecoveryManager.js";
import { DAGRetryPolicy } from "../domain/dag/types.js";

export class DAGWorkerBridge {
  private static reaperTimer: NodeJS.Timeout | null = null;

  /**
   * Dispatches ready steps in parallel up to maxConcurrency.
   */
  public static async dispatchParallelDAG(
    executionId: string,
    maxConcurrency = 5
  ): Promise<ParallelDispatchResult> {
    return db.transaction(async (client) => {
      return DAGParallelExecutor.dispatchReadySteps(client, {
        executionId,
        maxConcurrency,
      });
    });
  }

  /**
   * Handles failure for a DAG step execution, delegating to DAGRetryScheduler
   * for exponential backoff rescheduling or cascading failure propagation.
   */
  public static async handleFailure(
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
    return DAGRetryScheduler.handleStepFailure(client, params);
  }

  /**
   * Enforces tri-state validation barrier for DAG step outputs.
   */
  public static async enforceBarrier(
    client: PoolClient,
    params: {
      readonly stepExecutionId: string;
      readonly executionId: string;
      readonly taskId: string;
      readonly artifactId: string;
      readonly confidence: number;
      readonly deterministicPassed: boolean;
      readonly disputeFlag?: boolean;
    }
  ): Promise<BarrierEvaluationResult> {
    const evaluation = DAGValidationBarrier.evaluate({
      confidence: params.confidence,
      deterministicPassed: params.deterministicPassed,
      disputeFlag: params.disputeFlag,
    });

    await DAGValidationBarrier.recordAndEnforceBarrier(client, {
      stepExecutionId: params.stepExecutionId,
      executionId: params.executionId,
      taskId: params.taskId,
      artifactId: params.artifactId,
      evaluation,
    });

    return evaluation;
  }

  private static reaperRefCount = 0;

  /**
   * Starts proactive background lease reaper daemon.
   */
  public static startLeaseReaper(intervalMs = 15000): void {
    this.reaperRefCount++;
    if (this.reaperTimer) return;
    this.reaperTimer = setInterval(async () => {
      try {
        await db.transaction(async (client) => {
          await DAGRecoveryManager.reapExpiredLeases(client);
        });
      } catch (err) {
        console.warn("[DAGWorkerBridge] Background lease reaper error:", err);
      }
    }, intervalMs);
  }

  /**
   * Stops background lease reaper daemon.
   */
  public static stopLeaseReaper(force = false): void {
    if (force) {
      this.reaperRefCount = 0;
    } else {
      this.reaperRefCount = Math.max(0, this.reaperRefCount - 1);
    }
    if (this.reaperRefCount === 0 && this.reaperTimer) {
      clearInterval(this.reaperTimer);
      this.reaperTimer = null;
    }
  }

  /**
   * Returns whether background lease reaper is active.
   */
  public static isReaperRunning(): boolean {
    return this.reaperTimer !== null;
  }

  /**
   * Executes a one-shot lease reap.
   */
  public static async reapNow(executionId?: string): Promise<ReapedStepResult[]> {
    return db.transaction(async (client) => {
      return DAGRecoveryManager.reapExpiredLeases(client, { executionId });
    });
  }
}

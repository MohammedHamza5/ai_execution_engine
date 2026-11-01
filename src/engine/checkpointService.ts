import { db } from "../db/client.js";
import { generateUUIDv7 } from "../domain/common/id.js";
import { NormalizedProviderError } from "../adapters/types.js";
import { RecoveryDecision } from "./recoveryPolicy.js";

export interface CheckpointSnapshotData {
  readonly taskId: string;
  readonly executionId: string;
  readonly stepExecutionId: string;
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly resourceId: string;
  readonly providerSlug?: string;
  readonly modelSlug?: string;
  readonly executionState: string;
  readonly failureInfo?: {
    readonly code: string;
    readonly message: string;
    readonly category?: string;
    readonly retryable: boolean;
    readonly migrationRecommended: boolean;
    readonly providerCode?: string;
  };
  readonly validationFailure?: {
    readonly validationId: string;
    readonly artifactId: string;
    readonly outcome: string;
    readonly failureClass: string;
    readonly reasons: ReadonlyArray<string>;
    readonly recoverable: boolean;
    readonly recommendedAction: string;
  };
  readonly recoveryDecision?: RecoveryDecision;
  readonly completedArtifactIds: ReadonlyArray<string>;
  readonly partialArtifactId?: string;
  readonly constraints?: Record<string, unknown>;
  readonly sequenceNumber: number;
  readonly createdAt: string;
}

export interface CreateCheckpointParams {
  readonly taskId: string;
  readonly executionId: string;
  readonly stepExecutionId: string;
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly resourceId: string;
  readonly fencingToken: number;
  readonly providerSlug?: string;
  readonly modelSlug?: string;
  readonly executionState: string;
  readonly error?: NormalizedProviderError;
  readonly validationFailure?: {
    readonly validationId: string;
    readonly artifactId: string;
    readonly outcome: string;
    readonly failureClass: string;
    readonly reasons: ReadonlyArray<string>;
    readonly recoverable: boolean;
    readonly recommendedAction: string;
  };
  readonly recoveryDecision?: RecoveryDecision;
  readonly completedArtifactIds?: ReadonlyArray<string>;
  readonly partialArtifactId?: string;
  readonly constraints?: Record<string, unknown>;
  readonly sequenceNumber?: number;
}

export interface CheckpointRecord {
  readonly id: string;
  readonly taskId: string;
  readonly executionId: string;
  readonly stepExecutionId?: string;
  readonly sequenceNumber: number;
  readonly snapshotData: CheckpointSnapshotData;
  readonly createdAt: Date;
}

export interface ReconstructedRecoveryState {
  readonly checkpointId: string;
  readonly taskId: string;
  readonly executionId: string;
  readonly stepExecutionId: string;
  readonly lastAttemptId: string;
  readonly lastAttemptNumber: number;
  readonly lastResourceId: string;
  readonly providerSlug?: string;
  readonly modelSlug?: string;
  readonly sequenceNumber: number;
  readonly executionState: string;
  readonly failureInfo?: CheckpointSnapshotData["failureInfo"];
  readonly validationFailure?: CheckpointSnapshotData["validationFailure"];
  readonly recoveryDecision?: RecoveryDecision;
  readonly completedArtifactIds: ReadonlyArray<string>;
  readonly partialArtifactId?: string;
  readonly canResume: boolean;
  readonly checkpointedAt: Date;
}

export class CheckpointService {
  /**
   * Persists an atomic, ordered, fenced checkpoint in PostgreSQL.
   *
   * Invariants:
   * 1. Monotonic fencing token validation: Stale workers are rejected with rollback.
   * 2. Idempotency: Duplicate calls for the same attempt return the existing checkpoint.
   * 3. Ordered: Sequence numbers are monotonic per execution instance.
   * 4. Decoupled Auditing: Emits a CHECKPOINT_CREATED event to system.outbox_events.
   */
  public async createCheckpoint(params: CreateCheckpointParams): Promise<CheckpointRecord> {
    return await db.transaction(async (client) => {
      // 1. Fencing validation: lock step_execution row to verify ownership
      const stepCheck = await client.query(
        `SELECT fencing_token, status 
         FROM execution.step_executions 
         WHERE id = $1 
         FOR UPDATE;`,
        [params.stepExecutionId]
      );

      if (stepCheck.rows.length === 0) {
        throw new Error(`STEP_EXECUTION_NOT_FOUND: Step execution ${params.stepExecutionId} does not exist`);
      }

      const activeFencingToken = parseInt(stepCheck.rows[0].fencing_token, 10);
      if (activeFencingToken !== params.fencingToken) {
        throw new Error(
          `STALE_WORKER_CHECKPOINT_REJECTED: fencing token mismatch for step ${params.stepExecutionId} (active: ${activeFencingToken}, provided: ${params.fencingToken})`
        );
      }

      // 2. Idempotency check: see if a checkpoint for this attempt already exists
      const existingRes = await client.query(
        `SELECT id, task_id, execution_id, step_execution_id, sequence_number, snapshot_data, created_at
         FROM execution.checkpoints
         WHERE execution_id = $1 AND snapshot_data->>'attemptId' = $2
         LIMIT 1;`,
        [params.executionId, params.attemptId]
      );

      if (existingRes.rows.length > 0) {
        const row = existingRes.rows[0];
        return {
          id: row.id,
          taskId: row.task_id,
          executionId: row.execution_id,
          stepExecutionId: row.step_execution_id,
          sequenceNumber: row.sequence_number,
          snapshotData: row.snapshot_data,
          createdAt: row.created_at,
        };
      }

      // 3. Monotonic sequence calculation
      let nextSeq: number;
      if (params.sequenceNumber !== undefined) {
        nextSeq = params.sequenceNumber;
      } else {
        const seqResult = await client.query(
          `SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_seq
           FROM execution.checkpoints
           WHERE execution_id = $1;`,
          [params.executionId]
        );
        nextSeq = parseInt(seqResult.rows[0].next_seq, 10);
      }

      const checkpointId = generateUUIDv7();
      const nowIso = new Date().toISOString();

      // 4. Build durable recovery snapshot
      const snapshotData: CheckpointSnapshotData = {
        taskId: params.taskId,
        executionId: params.executionId,
        stepExecutionId: params.stepExecutionId,
        attemptId: params.attemptId,
        attemptNumber: params.attemptNumber,
        resourceId: params.resourceId,
        providerSlug: params.providerSlug,
        modelSlug: params.modelSlug,
        executionState: params.executionState,
        failureInfo: params.error
          ? {
              code: params.error.code,
              message: params.error.message,
              category: params.error.providerCode || params.error.code,
              retryable: params.error.retryable,
              migrationRecommended: params.error.migrationRecommended,
              providerCode: params.error.providerCode,
            }
          : undefined,
        validationFailure: params.validationFailure,
        recoveryDecision: params.recoveryDecision,
        completedArtifactIds: params.completedArtifactIds || [],
        partialArtifactId: params.partialArtifactId,
        constraints: params.constraints,
        sequenceNumber: nextSeq,
        createdAt: nowIso,
      };

      // 5. Persist Checkpoint record
      await client.query(
        `INSERT INTO execution.checkpoints (
          id, task_id, execution_id, step_execution_id, sequence_number, snapshot_data, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, now());`,
        [
          checkpointId,
          params.taskId,
          params.executionId,
          params.stepExecutionId,
          nextSeq,
          JSON.stringify(snapshotData),
        ]
      );

      // 6. If provider failure error is present, record normalized execution error
      if (params.error) {
        const errorId = generateUUIDv7();
        await client.query(
          `INSERT INTO execution.execution_errors (
            id, execution_id, step_execution_id, attempt_id, category, code, 
            provider_code, message, retryable, migratable, occurred_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now());`,
          [
            errorId,
            params.executionId,
            params.stepExecutionId,
            params.attemptId,
            "PROVIDER_FAILURE",
            params.error.code,
            params.error.providerCode || null,
            params.error.message,
            params.error.retryable,
            params.error.migrationRecommended,
          ]
        );

        // Update attempt status to failed with error reference
        await client.query(
          `UPDATE execution.execution_attempts
           SET status = 'failed', error_id = $1, completed_at = now()
           WHERE id = $2;`,
          [errorId, params.attemptId]
        );
      }

      // 7. If validation failure is present, record validation execution error
      if (params.validationFailure) {
        const errorId = generateUUIDv7();
        await client.query(
          `INSERT INTO execution.execution_errors (
            id, execution_id, step_execution_id, attempt_id, category, code, 
            provider_code, message, retryable, migratable, occurred_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now());`,
          [
            errorId,
            params.executionId,
            params.stepExecutionId,
            params.attemptId,
            "VALIDATION_FAILURE",
            params.validationFailure.failureClass,
            params.validationFailure.outcome,
            params.validationFailure.reasons.join("; ") || "Validation rejected output",
            params.validationFailure.recoverable,
            params.validationFailure.recommendedAction === "MIGRATE_RESOURCE",
          ]
        );

        // Update attempt status to failed with error reference
        await client.query(
          `UPDATE execution.execution_attempts
           SET status = 'failed', error_id = $1, completed_at = now()
           WHERE id = $2;`,
          [errorId, params.attemptId]
        );
      }

      // 8. Update step_executions status to checkpointing if needed
      await client.query(
        `UPDATE execution.step_executions
         SET status = 'checkpointing', updated_at = now()
         WHERE id = $1;`,
        [params.stepExecutionId]
      );

      // 8. Transactional Outbox Event for durable auditing
      await client.query(
        `INSERT INTO system.outbox_events (
          id, event_id, event_type, aggregate_type, aggregate_id, payload
        ) VALUES (
          gen_random_uuid(), $1, 'CHECKPOINT_CREATED', 'execution', $2, $3
        );`,
        [
          generateUUIDv7(),
          params.executionId,
          JSON.stringify({
            checkpointId,
            sequenceNumber: nextSeq,
            stepExecutionId: params.stepExecutionId,
            attemptId: params.attemptId,
            recoveryAction: params.recoveryDecision?.action || "NONE",
          }),
        ]
      );

      return {
        id: checkpointId,
        taskId: params.taskId,
        executionId: params.executionId,
        stepExecutionId: params.stepExecutionId,
        sequenceNumber: nextSeq,
        snapshotData,
        createdAt: new Date(),
      };
    });
  }

  /**
   * Reconstructs recovery state from the most recent durable checkpoint.
   * Enables seamless recovery after worker failure or process restart.
   */
  public async reconstructRecoveryState(executionId: string): Promise<ReconstructedRecoveryState | null> {
    const result = await db.query(
      `SELECT id, task_id, execution_id, step_execution_id, sequence_number, snapshot_data, created_at
       FROM execution.checkpoints
       WHERE execution_id = $1
       ORDER BY sequence_number DESC
       LIMIT 1;`,
      [executionId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const snapshot = row.snapshot_data as CheckpointSnapshotData;

    return {
      checkpointId: row.id,
      taskId: row.task_id,
      executionId: row.execution_id,
      stepExecutionId: row.step_execution_id,
      lastAttemptId: snapshot.attemptId,
      lastAttemptNumber: snapshot.attemptNumber,
      lastResourceId: snapshot.resourceId,
      providerSlug: snapshot.providerSlug,
      modelSlug: snapshot.modelSlug,
      sequenceNumber: row.sequence_number,
      executionState: snapshot.executionState,
      failureInfo: snapshot.failureInfo,
      validationFailure: snapshot.validationFailure,
      recoveryDecision: snapshot.recoveryDecision,
      completedArtifactIds: snapshot.completedArtifactIds || [],
      partialArtifactId: snapshot.partialArtifactId,
      canResume:
        snapshot.recoveryDecision?.action === "MIGRATE_RESOURCE" ||
        snapshot.recoveryDecision?.action === "RETRY_SAME" ||
        Boolean(snapshot.validationFailure?.recoverable),
      checkpointedAt: row.created_at,
    };
  }

  /**
   * Lists all ordered checkpoints for an execution instance.
   */
  public async listCheckpoints(executionId: string): Promise<ReadonlyArray<CheckpointRecord>> {
    const result = await db.query(
      `SELECT id, task_id, execution_id, step_execution_id, sequence_number, snapshot_data, created_at
       FROM execution.checkpoints
       WHERE execution_id = $1
       ORDER BY sequence_number ASC;`,
      [executionId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      executionId: row.execution_id,
      stepExecutionId: row.step_execution_id,
      sequenceNumber: row.sequence_number,
      snapshotData: row.snapshot_data as CheckpointSnapshotData,
      createdAt: row.created_at,
    }));
  }
}

export const checkpointService = new CheckpointService();

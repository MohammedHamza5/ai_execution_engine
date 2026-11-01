import { PoolClient } from "pg";
import { generateUUIDv7 } from "../domain/common/id.js";
import { DAGInputReference } from "../domain/dag/types.js";

export interface StepDependencyEvaluation {
  readonly planStepId: string;
  readonly stepKey: string;
  readonly stepExecutionId: string;
  readonly isReady: boolean;
  readonly hasFailedDependency: boolean;
  readonly missingDependencies: ReadonlyArray<string>;
  readonly failedDependencies: ReadonlyArray<string>;
}

export interface ReadyStepResolutionResult {
  readonly executionId: string;
  readonly readyStepExecutionIds: ReadonlyArray<string>;
  readonly blockedStepExecutionIds: ReadonlyArray<string>;
  readonly failedDependencyStepExecutionIds: ReadonlyArray<string>;
  readonly evaluations: ReadonlyArray<StepDependencyEvaluation>;
}

export interface ResolvedStepInputs {
  readonly stepExecutionId: string;
  readonly resolvedPayload: Record<string, unknown>;
  readonly missingRequiredArtifacts: ReadonlyArray<string>;
}

export class DAGDependencyResolver {
  public static async evaluateDependencies(
    client: PoolClient,
    executionId: string
  ): Promise<ReadyStepResolutionResult> {
    const blockedStepsRes = await client.query(
      `SELECT se.id AS step_execution_id, se.plan_step_id, ps.step_key, ps.order_index
       FROM execution.step_executions se
       JOIN planning.plan_steps ps ON se.plan_step_id = ps.id
       WHERE se.execution_id = $1 AND se.status = 'blocked'
       ORDER BY ps.order_index ASC, ps.step_key ASC;`,
      [executionId]
    );

    const evaluations: StepDependencyEvaluation[] = [];
    const readyIds: string[] = [];
    const blockedIds: string[] = [];
    const failedDepIds: string[] = [];

    for (const row of blockedStepsRes.rows) {
      const parentDepsRes = await client.query(
        `SELECT dep.depends_on_step_id,
                parent_ps.step_key AS parent_step_key,
                parent_se.id AS parent_step_execution_id,
                parent_se.status AS parent_status
         FROM planning.step_dependencies dep
         JOIN planning.plan_steps parent_ps ON dep.depends_on_step_id = parent_ps.id
         JOIN execution.step_executions parent_se 
           ON parent_se.plan_step_id = dep.depends_on_step_id AND parent_se.execution_id = $1
         WHERE dep.plan_step_id = $2;`,
        [executionId, row.plan_step_id]
      );

      const missing: string[] = [];
      const failed: string[] = [];

      for (const parent of parentDepsRes.rows) {
        if (parent.parent_status === "failed" || parent.parent_status === "cancelled") {
          failed.push(parent.parent_step_key);
        } else if (parent.parent_status !== "completed") {
          missing.push(parent.parent_step_key);
        }
      }

      const hasFailedDependency = failed.length > 0;
      const isReady = !hasFailedDependency && missing.length === 0;

      evaluations.push({
        planStepId: row.plan_step_id,
        stepKey: row.step_key,
        stepExecutionId: row.step_execution_id,
        isReady,
        hasFailedDependency,
        missingDependencies: missing,
        failedDependencies: failed,
      });

      if (isReady) readyIds.push(row.step_execution_id);
      else if (hasFailedDependency) failedDepIds.push(row.step_execution_id);
      else blockedIds.push(row.step_execution_id);
    }

    return {
      executionId,
      readyStepExecutionIds: readyIds,
      blockedStepExecutionIds: blockedIds,
      failedDependencyStepExecutionIds: failedDepIds,
      evaluations,
    };
  }

  public static async unblockReadySteps(
    client: PoolClient,
    executionId: string
  ): Promise<string[]> {
    const resolution = await this.evaluateDependencies(client, executionId);
    if (resolution.readyStepExecutionIds.length === 0) return [];

    await client.query(
      `UPDATE execution.step_executions
       SET status = 'pending', available_at = now(), updated_at = now()
       WHERE id = ANY($1) AND status = 'blocked';`,
      [resolution.readyStepExecutionIds]
    );

    for (const evalItem of resolution.evaluations.filter((e) => e.isReady)) {
      await client.query(
        `INSERT INTO system.outbox_events (
          id, event_id, event_type, aggregate_type, aggregate_id, payload
        ) VALUES (
          gen_random_uuid(), $1, 'STEP_UNBLOCKED', 'step_execution', $2, $3
        );`,
        [
          generateUUIDv7(),
          evalItem.stepExecutionId,
          JSON.stringify({
            stepExecutionId: evalItem.stepExecutionId,
            stepKey: evalItem.stepKey,
            executionId,
          }),
        ]
      );
    }

    return [...resolution.readyStepExecutionIds];
  }

  public static async resolveStepArtifactInputs(
    client: PoolClient,
    params: {
      readonly stepExecutionId: string;
      readonly executionId: string;
      readonly inputReferences?: ReadonlyArray<DAGInputReference>;
      readonly basePayload?: Record<string, unknown>;
    }
  ): Promise<ResolvedStepInputs> {
    const resolvedPayload: Record<string, unknown> = { ...(params.basePayload || {}) };
    const missing: string[] = [];

    if (!params.inputReferences || params.inputReferences.length === 0) {
      return { stepExecutionId: params.stepExecutionId, resolvedPayload, missingRequiredArtifacts: [] };
    }

    for (const ref of params.inputReferences) {
      const artRes = await client.query(
        `SELECT a.id, a.type, a.inline_content, a.storage_uri, a.content_hash, a.schema
         FROM execution.step_executions se
         JOIN planning.plan_steps ps ON se.plan_step_id = ps.id
         JOIN validation.validations v ON v.step_execution_id = se.id AND v.status = 'passed'
         JOIN artifacts.artifacts a ON a.id = v.target_id
         WHERE ps.step_key = $1 AND se.execution_id = $2
         ORDER BY v.completed_at DESC
         LIMIT 1;`,
        [ref.sourceStepKey, params.executionId]
      );

      if (artRes.rows.length === 0) {
        if (ref.required !== false) missing.push(ref.sourceStepKey);
      } else {
        const art = artRes.rows[0];
        resolvedPayload[ref.sourceStepKey] = {
          artifactId: art.id,
          artifactType: art.type,
          content: art.inline_content || art.storage_uri,
          hash: art.content_hash,
        };
      }
    }

    return {
      stepExecutionId: params.stepExecutionId,
      resolvedPayload,
      missingRequiredArtifacts: missing,
    };
  }
}

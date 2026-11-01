import { PoolClient } from "pg";
import { generateUUIDv7 } from "../domain/common/id.js";

export interface ProgressionEvaluationResult {
  readonly unblockedStepExecutionIds: ReadonlyArray<string>;
  readonly isDAGComplete: boolean;
}

export class DAGProgressionEngine {
  /**
   * Evaluates downstream dependencies and advances DAG execution upon step completion.
   * Runs inside the commit transaction to ensure ACID atomic progression.
   */
  public async evaluateStepProgression(
    client: PoolClient,
    params: {
      readonly stepExecutionId: string;
      readonly executionId: string;
      readonly taskId: string;
      readonly outputArtifactId: string;
      readonly qualityScore: number;
    }
  ): Promise<ProgressionEvaluationResult> {
    // 1. Retrieve the completed plan_step_id and plan_id
    const stepInfoRes = await client.query(
      `SELECT s.plan_step_id, p.plan_id, p.step_key
       FROM execution.step_executions s
       JOIN planning.plan_steps p ON s.plan_step_id = p.id
       WHERE s.id = $1;`,
      [params.stepExecutionId]
    );

    if (stepInfoRes.rows.length === 0) {
      return { unblockedStepExecutionIds: [], isDAGComplete: false };
    }

    const { plan_step_id: completedPlanStepId } = stepInfoRes.rows[0];

    // 2. Query all downstream steps that depend directly on this completed step
    const downstreamRes = await client.query(
      `SELECT d.plan_step_id AS downstream_plan_step_id,
              ps.step_key AS downstream_step_key,
              se.id AS downstream_step_execution_id,
              se.status AS downstream_status
       FROM planning.step_dependencies d
       JOIN planning.plan_steps ps ON d.plan_step_id = ps.id
       JOIN execution.step_executions se ON se.plan_step_id = ps.id AND se.execution_id = $1
       WHERE d.depends_on_step_id = $2 AND se.status = 'blocked';`,
      [params.executionId, completedPlanStepId]
    );

    const unblockedStepExecutionIds: string[] = [];

    // 3. For each blocked downstream step, verify if ALL prerequisites are now completed
    for (const downstream of downstreamRes.rows) {
      const depCheckRes = await client.query(
        `SELECT COUNT(*) AS unsatisfied_count
         FROM planning.step_dependencies dep
         JOIN execution.step_executions parent_se 
           ON parent_se.plan_step_id = dep.depends_on_step_id 
          AND parent_se.execution_id = $1
         WHERE dep.plan_step_id = $2
           AND parent_se.status != 'completed';`,
        [params.executionId, downstream.downstream_plan_step_id]
      );

      const unsatisfiedCount = parseInt(depCheckRes.rows[0].unsatisfied_count, 10);

      // If all upstream dependencies are satisfied, unblock this step!
      if (unsatisfiedCount === 0) {
        await client.query(
          `UPDATE execution.step_executions
           SET status = 'pending',
               available_at = now(),
               updated_at = now()
           WHERE id = $1 AND status = 'blocked';`,
          [downstream.downstream_step_execution_id]
        );

        unblockedStepExecutionIds.push(downstream.downstream_step_execution_id);

        // Transactional Outbox Event (ADR-095)
        await client.query(
          `INSERT INTO system.outbox_events (
            id, event_id, event_type, aggregate_type, aggregate_id, payload
          ) VALUES (
            gen_random_uuid(), $1, 'STEP_UNBLOCKED', 'step_execution', $2, $3
          );`,
          [
            generateUUIDv7(),
            downstream.downstream_step_execution_id,
            JSON.stringify({
              stepExecutionId: downstream.downstream_step_execution_id,
              stepKey: downstream.downstream_step_key,
              executionId: params.executionId,
              taskId: params.taskId,
              unblockedByStepExecutionId: params.stepExecutionId,
            }),
          ]
        );
      }
    }

    // 4. Check if all steps in this execution are complete
    const remainingRes = await client.query(
      `SELECT COUNT(*) AS active_step_count
       FROM execution.step_executions
       WHERE execution_id = $1 AND status IN ('pending', 'running', 'blocked', 'diagnosing');`,
      [params.executionId]
    );

    const activeStepCount = parseInt(remainingRes.rows[0].active_step_count, 10);
    const isDAGComplete = activeStepCount === 0;

    if (isDAGComplete) {
      // Mark execution completed
      await client.query(
        `UPDATE execution.executions
         SET status = 'completed',
             completed_at = now(),
             updated_at = now()
         WHERE id = $1;`,
        [params.executionId]
      );

      // Mark task completed with the final output artifact
      await client.query(
        `UPDATE tasks.tasks
         SET status = 'completed',
             output_artifact_id = $1,
             quality_score = $2,
             completed_at = now(),
             updated_at = now()
         WHERE id = $3;`,
        [params.outputArtifactId, params.qualityScore, params.taskId]
      );

      // Transactional Outbox Event
      await client.query(
        `INSERT INTO system.outbox_events (
          id, event_id, event_type, aggregate_type, aggregate_id, payload
        ) VALUES (
          gen_random_uuid(), $1, 'TASK_COMPLETED', 'task', $2, $3
        );`,
        [
          generateUUIDv7(),
          params.taskId,
          JSON.stringify({
            executionId: params.executionId,
            outputArtifactId: params.outputArtifactId,
            qualityScore: params.qualityScore,
          }),
        ]
      );
    }

    return {
      unblockedStepExecutionIds,
      isDAGComplete,
    };
  }
}

export const dagProgressionEngine = new DAGProgressionEngine();

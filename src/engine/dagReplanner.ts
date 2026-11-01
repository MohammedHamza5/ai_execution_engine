import { PoolClient } from "pg";
import { generateUUIDv7 } from "../domain/common/id.js";
import { DAGNodeContract } from "../domain/dag/types.js";
import { DAGValidator } from "./dagValidator.js";

export interface ReplanningResult {
  readonly executionId: string;
  readonly newPlanVersion: number;
  readonly replacedStepKeys: ReadonlyArray<string>;
  readonly newStepExecutionIds: ReadonlyArray<string>;
  readonly replanningCycle: number;
}

export class DAGReplanner {
  public static readonly MAX_REPLANNING_CYCLES = 3;

  public static async identifyAffectedSubgraph(
    client: PoolClient,
    executionId: string,
    failedStepKey: string
  ): Promise<string[]> {
    const res = await client.query(
      `WITH RECURSIVE downstream AS (
         SELECT ps.id AS plan_step_id, ps.step_key
         FROM planning.plan_steps ps
         JOIN execution.step_executions se ON se.plan_step_id = ps.id
         WHERE se.execution_id = $1 AND ps.step_key = $2
         UNION
         SELECT child_ps.id, child_ps.step_key
         FROM planning.step_dependencies dep
         JOIN downstream dw ON dep.depends_on_step_id = dw.plan_step_id
         JOIN planning.plan_steps child_ps ON dep.plan_step_id = child_ps.id
       )
       SELECT DISTINCT step_key FROM downstream;`,
      [executionId, failedStepKey]
    );

    return res.rows.map((r) => r.step_key);
  }

  public static async replanSubgraph(
    client: PoolClient,
    params: {
      readonly executionId: string;
      readonly taskId: string;
      readonly tenantId: string;
      readonly failedStepKey: string;
      readonly replacementNodes: ReadonlyArray<DAGNodeContract>;
      readonly reason: string;
    }
  ): Promise<ReplanningResult> {
    // 1. Check replanning cycle limit (Anti-Infinite Loop Invariant)
    const cycleRes = await client.query(
      `SELECT COUNT(*) AS cycle_count
       FROM system.outbox_events
       WHERE aggregate_id = $1 AND event_type = 'SUBGRAPH_REPLANNED';`,
      [params.executionId]
    );
    const currentCycles = parseInt(cycleRes.rows[0].cycle_count, 10);
    if (currentCycles >= this.MAX_REPLANNING_CYCLES) {
      throw new Error(`REPLANNING_LIMIT_EXCEEDED: Maximum replanning cycles (${this.MAX_REPLANNING_CYCLES}) reached.`);
    }

    // 2. Validate replacement nodes
    const validation = DAGValidator.validate(params.replacementNodes);
    if (!validation.valid) {
      throw new Error(`REPLANNING_VALIDATION_FAILED: ${validation.errors.join("; ")}`);
    }

    // 3. Identify affected subgraph
    const affectedStepKeys = await this.identifyAffectedSubgraph(
      client,
      params.executionId,
      params.failedStepKey
    );

    // 4. Retrieve current plan and increment version
    const planRes = await client.query(
      `SELECT p.id, p.version, p.strategy
       FROM execution.executions e
       JOIN planning.execution_plans p ON e.plan_id = p.id
       WHERE e.id = $1;`,
      [params.executionId]
    );
    const currentPlan = planRes.rows[0];
    const newPlanId = generateUUIDv7();
    const newPlanVersion = parseInt(currentPlan.version, 10) + 1;

    await client.query(
      `INSERT INTO planning.execution_plans (
        id, task_id, version, status, strategy, cost_estimate, created_at, activated_at
      ) VALUES ($1, $2, $3, 'active', $4, 0.0, now(), now());`,
      [newPlanId, params.taskId, newPlanVersion, currentPlan.strategy]
    );

    // Update execution pointer to new plan
    await client.query(
      `UPDATE execution.executions SET plan_id = $1, updated_at = now() WHERE id = $2;`,
      [newPlanId, params.executionId]
    );

    // 5. Persist replacement plan steps and step executions
    const newStepExecutionIds: string[] = [];
    const stepPlanIdMap = new Map<string, string>();

    let orderIdx = 100; // Offset order index for replacement steps
    for (const node of params.replacementNodes) {
      const planStepId = generateUUIDv7();
      const stepExecutionId = generateUUIDv7();
      stepPlanIdMap.set(node.stepKey, planStepId);

      await client.query(
        `INSERT INTO planning.plan_steps (
          id, plan_id, step_key, name, description, step_type,
          order_index, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, now());`,
        [
          planStepId,
          newPlanId,
          node.stepKey,
          node.name,
          node.description || null,
          node.stepType,
          orderIdx++,
        ]
      );

      // Status: if no dependencies, immediately pending; otherwise blocked
      const isReady = !node.dependencies || node.dependencies.length === 0;
      await client.query(
        `INSERT INTO execution.step_executions (
          id, execution_id, plan_step_id, task_id, status,
          fencing_token, priority, available_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, 0, 0, now(), now(), now());`,
        [stepExecutionId, params.executionId, planStepId, params.taskId, isReady ? "pending" : "blocked"]
      );

      newStepExecutionIds.push(stepExecutionId);
    }

    // 6. Persist dependencies between replacement steps
    for (const node of params.replacementNodes) {
      if (node.dependencies) {
        const planStepId = stepPlanIdMap.get(node.stepKey)!;
        for (const depKey of node.dependencies) {
          const parentPlanStepId = stepPlanIdMap.get(depKey);
          if (parentPlanStepId) {
            await client.query(
              `INSERT INTO planning.step_dependencies (
                id, plan_step_id, depends_on_step_id, dependency_type, created_at
              ) VALUES ($1, $2, $3, 'completion', now());`,
              [generateUUIDv7(), planStepId, parentPlanStepId]
            );
          }
        }
      }
    }

    // 7. Transactional Outbox Event
    await client.query(
      `INSERT INTO system.outbox_events (
        id, event_id, event_type, aggregate_type, aggregate_id, payload
      ) VALUES (
        gen_random_uuid(), $1, 'SUBGRAPH_REPLANNED', 'execution', $2, $3
      );`,
      [
        generateUUIDv7(),
        params.executionId,
        JSON.stringify({
          executionId: params.executionId,
          taskId: params.taskId,
          failedStepKey: params.failedStepKey,
          affectedStepKeys,
          newPlanVersion,
          replanningCycle: currentCycles + 1,
          reason: params.reason,
        }),
      ]
    );

    return {
      executionId: params.executionId,
      newPlanVersion,
      replacedStepKeys: affectedStepKeys,
      newStepExecutionIds,
      replanningCycle: currentCycles + 1,
    };
  }
}

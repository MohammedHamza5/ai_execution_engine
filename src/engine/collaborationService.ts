import { db } from "../db/client.js";
import { generateUUIDv7 } from "../domain/common/id.js";
import {
  CollaborationRun,
  CollaborationBranch,
  CreateCollaborationInput,
  CollaborationState,
  BranchStatus,
  CollaborationContextPackage,
} from "../domain/collaboration/types.js";
import {
  CollaborationStateMachine,
  PolicyEvaluationResult,
} from "./collaborationStateMachine.js";
import { ContextPackageBuilder } from "./contextPackageBuilder.js";

export class CollaborationService {
  /**
   * Initializes a new Collaboration Run and its initial participant branches.
   */
  public async createCollaborationRun(input: CreateCollaborationInput): Promise<CollaborationRun> {
    const runId = generateUUIDv7();

    return await db.transaction(async (client) => {
      // 1. Insert Collaboration Run
      await client.query(
        `INSERT INTO execution.collaboration_runs (
          id, task_id, execution_id, plan_id, strategy, state, 
          completion_policy, objective, branch_count, metadata, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, 'CREATED', $6, $7, $8, $9, now(), now());`,
        [
          runId,
          input.taskId,
          input.executionId,
          input.planId,
          input.strategy,
          JSON.stringify(input.completionPolicy),
          input.objective,
          input.branches.length,
          JSON.stringify(input.metadata || {}),
        ]
      );

      // 2. Insert Collaboration Branches
      for (const branch of input.branches) {
        const branchId = generateUUIDv7();
        await client.query(
          `INSERT INTO execution.collaboration_branches (
            id, collaboration_run_id, branch_key, role, step_execution_id,
            resource_id, model_id, status, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', now(), now());`,
          [
            branchId,
            runId,
            branch.branchKey,
            branch.role,
            branch.stepExecutionId,
            branch.resourceId,
            branch.modelId,
          ]
        );
      }

      // 3. Emit Transactional Outbox Event
      await client.query(
        `INSERT INTO system.outbox_events (
          id, event_id, event_type, aggregate_type, aggregate_id, payload
        ) VALUES (
          gen_random_uuid(), $1, 'COLLABORATION_CREATED', 'collaboration_run', $2, $3
        );`,
        [
          generateUUIDv7(),
          runId,
          JSON.stringify({
            taskId: input.taskId,
            executionId: input.executionId,
            strategy: input.strategy,
            branchCount: input.branches.length,
          }),
        ]
      );

      return {
        id: runId,
        taskId: input.taskId,
        executionId: input.executionId,
        planId: input.planId,
        strategy: input.strategy,
        state: "CREATED",
        completionPolicy: input.completionPolicy,
        objective: input.objective,
        branchCount: input.branches.length,
        metadata: input.metadata,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    });
  }

  /**
   * Retrieves a collaboration run by ID.
   */
  public async getCollaborationRun(id: string): Promise<CollaborationRun | null> {
    const result = await db.query(
      `SELECT * FROM execution.collaboration_runs WHERE id = $1;`,
      [id]
    );
    if (result.rows.length === 0) return null;
    const r = result.rows[0];
    return {
      id: r.id,
      taskId: r.task_id,
      executionId: r.execution_id,
      planId: r.plan_id,
      strategy: r.strategy,
      state: r.state,
      completionPolicy: r.completion_policy,
      objective: r.objective,
      branchCount: r.branch_count,
      synthesisArtifactId: r.synthesis_artifact_id || undefined,
      resultArtifactId: r.result_artifact_id || undefined,
      metadata: r.metadata,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  /**
   * Retrieves all branches associated with a collaboration run.
   */
  public async getCollaborationBranches(runId: string): Promise<ReadonlyArray<CollaborationBranch>> {
    const result = await db.query(
      `SELECT * FROM execution.collaboration_branches WHERE collaboration_run_id = $1 ORDER BY created_at ASC;`,
      [runId]
    );
    return result.rows.map((b) => ({
      id: b.id,
      collaborationRunId: b.collaboration_run_id,
      branchKey: b.branch_key,
      role: b.role,
      stepExecutionId: b.step_execution_id,
      resourceId: b.resource_id,
      modelId: b.model_id,
      status: b.status,
      outputArtifactId: b.output_artifact_id || undefined,
      errorMessage: b.error_message || undefined,
      createdAt: b.created_at,
      updatedAt: b.updated_at,
    }));
  }

  /**
   * Transitions a collaboration run to a new state with strict FSM validation and outbox event emission.
   */
  public async transitionState(
    runId: string,
    targetState: CollaborationState,
    extra?: { synthesisArtifactId?: string; resultArtifactId?: string }
  ): Promise<CollaborationRun> {
    return await db.transaction(async (client) => {
      const current = await client.query(
        `SELECT state, task_id, execution_id FROM execution.collaboration_runs WHERE id = $1 FOR UPDATE;`,
        [runId]
      );
      if (current.rows.length === 0) {
        throw new Error(`COLLABORATION_RUN_NOT_FOUND: Run ${runId} does not exist`);
      }

      const currentState = current.rows[0].state as CollaborationState;
      CollaborationStateMachine.assertTransition(currentState, targetState);

      await client.query(
        `UPDATE execution.collaboration_runs
         SET state = $1,
             synthesis_artifact_id = COALESCE($2, synthesis_artifact_id),
             result_artifact_id = COALESCE($3, result_artifact_id),
             updated_at = now()
         WHERE id = $4;`,
        [targetState, extra?.synthesisArtifactId || null, extra?.resultArtifactId || null, runId]
      );

      // Emit Outbox event
      await client.query(
        `INSERT INTO system.outbox_events (
          id, event_id, event_type, aggregate_type, aggregate_id, payload
        ) VALUES (
          gen_random_uuid(), $1, $2, 'collaboration_run', $3, $4
        );`,
        [
          generateUUIDv7(),
          `COLLABORATION_${targetState}`,
          runId,
          JSON.stringify({
            fromState: currentState,
            toState: targetState,
            taskId: current.rows[0].task_id,
          }),
        ]
      );

      const updated = await client.query(
        `SELECT * FROM execution.collaboration_runs WHERE id = $1;`,
        [runId]
      );
      const r = updated.rows[0];
      return {
        id: r.id,
        taskId: r.task_id,
        executionId: r.execution_id,
        planId: r.plan_id,
        strategy: r.strategy,
        state: r.state,
        completionPolicy: r.completion_policy,
        objective: r.objective,
        branchCount: r.branch_count,
        synthesisArtifactId: r.synthesis_artifact_id || undefined,
        resultArtifactId: r.result_artifact_id || undefined,
        metadata: r.metadata,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });
  }

  /**
   * Updates a branch status and records its output artifact upon completion.
   */
  public async recordBranchResult(params: {
    readonly branchId: string;
    readonly status: BranchStatus;
    readonly outputArtifactId?: string;
    readonly errorMessage?: string;
  }): Promise<CollaborationBranch> {
    return await db.transaction(async (client) => {
      const updateResult = await client.query(
        `UPDATE execution.collaboration_branches
         SET status = $1,
             output_artifact_id = $2,
             error_message = $3,
             updated_at = now()
         WHERE id = $4
         RETURNING *;`,
        [params.status, params.outputArtifactId || null, params.errorMessage || null, params.branchId]
      );

      if (updateResult.rows.length === 0) {
        throw new Error(`COLLABORATION_BRANCH_NOT_FOUND: Branch ${params.branchId} does not exist`);
      }

      const b = updateResult.rows[0];

      // Emit Outbox event
      const eventType = params.status === "completed" ? "BRANCH_COMPLETED" : "BRANCH_FAILED";
      await client.query(
        `INSERT INTO system.outbox_events (
          id, event_id, event_type, aggregate_type, aggregate_id, payload
        ) VALUES (
          gen_random_uuid(), $1, $2, 'collaboration_branch', $3, $4
        );`,
        [
          generateUUIDv7(),
          eventType,
          params.branchId,
          JSON.stringify({
            collaborationRunId: b.collaboration_run_id,
            branchKey: b.branch_key,
            role: b.role,
            outputArtifactId: params.outputArtifactId,
          }),
        ]
      );

      return {
        id: b.id,
        collaborationRunId: b.collaboration_run_id,
        branchKey: b.branch_key,
        role: b.role,
        stepExecutionId: b.step_execution_id,
        resourceId: b.resource_id,
        modelId: b.model_id,
        status: b.status,
        outputArtifactId: b.output_artifact_id || undefined,
        errorMessage: b.error_message || undefined,
        createdAt: b.created_at,
        updatedAt: b.updated_at,
      };
    });
  }

  /**
   * Evaluates completion policy progress for a collaboration run.
   */
  public async evaluateRunProgress(runId: string): Promise<PolicyEvaluationResult> {
    const run = await this.getCollaborationRun(runId);
    if (!run) {
      throw new Error(`COLLABORATION_RUN_NOT_FOUND: Run ${runId} does not exist`);
    }
    const branches = await this.getCollaborationBranches(runId);
    return CollaborationStateMachine.evaluatePolicy(
      run.completionPolicy,
      branches.map((b) => b.status)
    );
  }

  /**
   * Retrieves a collaboration run by task ID.
   */
  public async getCollaborationRunByTaskId(taskId: string): Promise<CollaborationRun | null> {
    const result = await db.query(
      `SELECT * FROM execution.collaboration_runs WHERE task_id = $1;`,
      [taskId]
    );
    if (result.rows.length === 0) return null;
    const r = result.rows[0];
    return {
      id: r.id,
      taskId: r.task_id,
      executionId: r.execution_id,
      planId: r.plan_id,
      strategy: r.strategy,
      state: r.state,
      completionPolicy: r.completion_policy,
      objective: r.objective,
      branchCount: r.branch_count,
      synthesisArtifactId: r.synthesis_artifact_id || undefined,
      resultArtifactId: r.result_artifact_id || undefined,
      metadata: r.metadata,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  /**
   * Retrieves a branch associated with a specific step execution ID.
   */
  public async getBranchByStepExecutionId(stepExecutionId: string): Promise<CollaborationBranch | null> {
    const result = await db.query(
      `SELECT * FROM execution.collaboration_branches WHERE step_execution_id = $1;`,
      [stepExecutionId]
    );
    if (result.rows.length === 0) return null;
    const b = result.rows[0];
    return {
      id: b.id,
      collaborationRunId: b.collaboration_run_id,
      branchKey: b.branch_key,
      role: b.role,
      stepExecutionId: b.step_execution_id,
      resourceId: b.resource_id,
      modelId: b.model_id,
      status: b.status,
      outputArtifactId: b.output_artifact_id || undefined,
      errorMessage: b.error_message || undefined,
      createdAt: b.created_at,
      updatedAt: b.updated_at,
    };
  }

  /**
   * Completes a collaboration run upon successful synthesis and validation,
   * atomically advancing the parent task and execution to completed.
   */
  public async completeCollaboration(
    runId: string,
    resultArtifactId: string,
    qualityScore: number = 1.0
  ): Promise<CollaborationRun> {
    return await db.transaction(async (client) => {
      const runRes = await client.query(
        `SELECT task_id, execution_id, state FROM execution.collaboration_runs WHERE id = $1 FOR UPDATE;`,
        [runId]
      );
      if (runRes.rows.length === 0) {
        throw new Error(`COLLABORATION_RUN_NOT_FOUND: Run ${runId} does not exist`);
      }
      const r = runRes.rows[0];
      CollaborationStateMachine.assertTransition(r.state, "COMPLETED");

      await client.query(
        `UPDATE execution.collaboration_runs
         SET state = 'COMPLETED',
             result_artifact_id = $1,
             updated_at = now()
         WHERE id = $2;`,
        [resultArtifactId, runId]
      );

      await client.query(
        `UPDATE tasks.tasks
         SET status = 'completed',
             output_artifact_id = $1,
             quality_score = $2,
             completed_at = now(),
             updated_at = now()
         WHERE id = $3;`,
        [resultArtifactId, qualityScore, r.task_id]
      );

      await client.query(
        `UPDATE execution.executions
         SET status = 'completed',
             completed_at = now(),
             updated_at = now()
         WHERE id = $1;`,
        [r.execution_id]
      );

      await client.query(
        `INSERT INTO system.outbox_events (
          id, event_id, event_type, aggregate_type, aggregate_id, payload
        ) VALUES (
          gen_random_uuid(), $1, 'COLLABORATION_COMPLETED', 'collaboration_run', $2, $3
        );`,
        [
          generateUUIDv7(),
          runId,
          JSON.stringify({
            taskId: r.task_id,
            resultArtifactId,
            qualityScore,
          }),
        ]
      );

      const updated = await client.query(
        `SELECT * FROM execution.collaboration_runs WHERE id = $1;`,
        [runId]
      );
      const row = updated.rows[0];
      return {
        id: row.id,
        taskId: row.task_id,
        executionId: row.execution_id,
        planId: row.plan_id,
        strategy: row.strategy,
        state: row.state,
        completionPolicy: row.completion_policy,
        objective: row.objective,
        branchCount: row.branch_count,
        synthesisArtifactId: row.synthesis_artifact_id || undefined,
        resultArtifactId: row.result_artifact_id || undefined,
        metadata: row.metadata,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  /**
   * Assembles a structured, immutable Context Package containing verified artifacts
   * from completed source branches for structured collaboration handoff.
   */
  public async buildContextPackage(params: {
    readonly runId: string;
    readonly targetBranchKey: string;
    readonly targetRole: string;
    readonly objective: string;
    readonly sourceBranchKeys?: ReadonlyArray<string>;
  }): Promise<CollaborationContextPackage> {
    return ContextPackageBuilder.buildPackage(params);
  }
}

export const collaborationService = new CollaborationService();

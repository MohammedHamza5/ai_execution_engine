import { db } from "../db/client.js";
import { generateUUIDv7 } from "../domain/common/id.js";
import { CreateTaskInput, Task, TaskRequirements, TaskPolicy } from "../domain/task/types.js";
import { resourceIntelligence, SelectedResource } from "../resources/resourceIntelligence.js";
import { validationEngine } from "../validation/validationEngine.js";
import { computeContentHash } from "../domain/artifact/types.js";
import { UnifiedResponse } from "../adapters/types.js";
import { ValidationDecision } from "../domain/validation/types.js";
import {
  CollaborationStrategy,
  CompletionPolicy,
  BranchRole,
} from "../domain/collaboration/types.js";
import { dagProgressionEngine } from "./dagProgressionEngine.js";
import { dagService, CreateDAGTaskInput, DAGTaskCreationResult } from "./dagService.js";
import { DAGQueryService, DAGTaskDetails } from "./dagQueryService.js";
import { DAGValidationBarrier } from "./dagValidationBarrier.js";

export interface TaskCreationResult {
  readonly taskId: string;
  readonly planId: string;
  readonly executionId: string;
  readonly stepExecutionId: string;
}

export interface BranchInput {
  readonly branchKey: string;
  readonly role: BranchRole;
  readonly name?: string;
  readonly description?: string;
  readonly resourceId?: string;
  readonly requirements?: TaskRequirements;
}

export interface CreateCollaborationTaskInput {
  readonly tenantId: string;
  readonly taskType: string;
  readonly objective: string;
  readonly strategy: CollaborationStrategy;
  readonly completionPolicy: CompletionPolicy;
  readonly branches: ReadonlyArray<BranchInput>;
  readonly inputPayload?: Record<string, unknown>;
  readonly requirements?: TaskRequirements;
  readonly policy?: TaskPolicy;
  readonly priority?: number;
  readonly projectId?: string;
  readonly createdByUserId?: string;
}

export interface CollaborationTaskBranchResult {
  readonly branchKey: string;
  readonly role: BranchRole;
  readonly planStepId: string;
  readonly stepExecutionId: string;
  readonly resourceId: string;
  readonly modelId: string;
}

export interface CollaborationTaskResult {
  readonly taskId: string;
  readonly planId: string;
  readonly executionId: string;
  readonly collaborationRunId: string;
  readonly branches: ReadonlyArray<CollaborationTaskBranchResult>;
}

export class ExecutionEngine {
  /**
   * Initializes a new Task, minimal Plan, and pending StepExecution.
   */
  public async createTaskAndPlan(input: CreateTaskInput): Promise<TaskCreationResult> {
    const taskId = generateUUIDv7();
    const planId = generateUUIDv7();
    const planStepId = generateUUIDv7();
    const executionId = generateUUIDv7();
    const stepExecutionId = generateUUIDv7();

    // Select the optimal resource through Resource Intelligence boundary
    const selectedResource = await resourceIntelligence.selectResource(input.requirements);

    await db.transaction(async (client) => {
      // 1. Persist Task
      await client.query(
        `INSERT INTO tasks.tasks (
          id, tenant_id, project_id, created_by_user_id, task_type, 
          status, priority, input_payload, requirements, policy
        ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9);`,
        [
          taskId,
          input.tenantId,
          input.projectId || null,
          input.createdByUserId || null,
          input.taskType,
          input.priority || 0,
          JSON.stringify(input.inputPayload),
          JSON.stringify(input.requirements || {}),
          JSON.stringify(input.policy || {}),
        ]
      );

      // 2. Persist Minimal Plan (Task -> Step 1)
      await client.query(
        `INSERT INTO planning.execution_plans (
          id, task_id, version, status, strategy, cost_estimate
        ) VALUES ($1, $2, 1, 'active', 'single_model', 0.0);`,
        [planId, taskId]
      );

      // 3. Persist Plan Step
      await client.query(
        `INSERT INTO planning.plan_steps (
          id, plan_id, step_key, name, description, step_type, 
          order_index, assigned_resource_id, assigned_model_id
        ) VALUES ($1, $2, 'generate_step', 'Generate Response', 'Primary M0 Inference Step', 
          'model_inference', 1, $3, $4);`,
        [
          planStepId,
          planId,
          selectedResource.resource.id,
          selectedResource.resource.modelId,
        ]
      );

      // 4. Persist Execution Instance
      await client.query(
        `INSERT INTO execution.executions (
          id, task_id, plan_id, status, current_step_id
        ) VALUES ($1, $2, $3, 'running', $4);`,
        [executionId, taskId, planId, planStepId]
      );

      // 5. Persist Step Execution into Authoritative Work Queue (ADR-094)
      await client.query(
        `INSERT INTO execution.step_executions (
          id, execution_id, plan_step_id, task_id, status, 
          resource_id, model_id, fencing_token, priority, available_at
        ) VALUES ($1, $2, $3, $4, 'pending', $5, $6, 0, $7, now());`,
        [
          stepExecutionId,
          executionId,
          planStepId,
          taskId,
          selectedResource.resource.id,
          selectedResource.resource.modelId,
          input.priority || 0,
        ]
      );

      // 6. Transactional Outbox Domain Event (ADR-095)
      await client.query(
        `INSERT INTO system.outbox_events (
          id, event_id, event_type, aggregate_type, aggregate_id, payload
        ) VALUES (
          gen_random_uuid(), $1, 'TASK_CREATED', 'task', $2, $3
        );`,
        [
          generateUUIDv7(),
          taskId,
          JSON.stringify({
            tenantId: input.tenantId,
            taskType: input.taskType,
            priority: input.priority || 0,
          }),
        ]
      );
    });

    return { taskId, planId, executionId, stepExecutionId };
  }

  /**
   * Initializes a multi-model collaboration Task, Plan, Run, and parallel branch StepExecutions.
   */
  public async createCollaborationTask(
    input: CreateCollaborationTaskInput
  ): Promise<CollaborationTaskResult> {
    const taskId = generateUUIDv7();
    const planId = generateUUIDv7();
    const executionId = generateUUIDv7();
    const collaborationRunId = generateUUIDv7();

    // 1. Resolve resources for all branches ahead of the database transaction
    const resolvedBranches: Array<{
      branchKey: string;
      role: BranchRole;
      name: string;
      description: string;
      resource: SelectedResource;
      planStepId: string;
      stepExecutionId: string;
      branchId: string;
    }> = [];

    for (const b of input.branches) {
      let res: SelectedResource | null = null;
      if (b.resourceId) {
        res = await resourceIntelligence.getResourceById(b.resourceId);
      }
      if (!res) {
        res = await resourceIntelligence.selectResource(b.requirements || input.requirements);
      }

      resolvedBranches.push({
        branchKey: b.branchKey,
        role: b.role,
        name: b.name || b.branchKey,
        description: b.description || `Branch ${b.branchKey} (${b.role})`,
        resource: res,
        planStepId: generateUUIDv7(),
        stepExecutionId: generateUUIDv7(),
        branchId: generateUUIDv7(),
      });
    }

    // 2. Atomic Database Transaction
    await db.transaction(async (client) => {
      // 2a. Persist Task
      await client.query(
        `INSERT INTO tasks.tasks (
          id, tenant_id, project_id, created_by_user_id, task_type, 
          status, priority, input_payload, requirements, policy
        ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9);`,
        [
          taskId,
          input.tenantId,
          input.projectId || null,
          input.createdByUserId || null,
          input.taskType,
          input.priority || 0,
          JSON.stringify(input.inputPayload || {}),
          JSON.stringify(input.requirements || {}),
          JSON.stringify(input.policy || {}),
        ]
      );

      // 2b. Persist Plan
      await client.query(
        `INSERT INTO planning.execution_plans (
          id, task_id, version, status, strategy, cost_estimate
        ) VALUES ($1, $2, 1, 'active', $3, 0.0);`,
        [planId, taskId, input.strategy]
      );

      // 2c. Persist Execution Instance
      await client.query(
        `INSERT INTO execution.executions (
          id, task_id, plan_id, status, current_step_id
        ) VALUES ($1, $2, $3, 'running', $4);`,
        [executionId, taskId, planId, resolvedBranches[0]?.planStepId || null]
      );

      // 2d. Persist Plan Steps & Step Executions for each branch
      let orderIndex = 1;
      for (const rb of resolvedBranches) {
        await client.query(
          `INSERT INTO planning.plan_steps (
            id, plan_id, step_key, name, description, step_type, 
            order_index, assigned_resource_id, assigned_model_id
          ) VALUES ($1, $2, $3, $4, $5, 'model_inference', $6, $7, $8);`,
          [
            rb.planStepId,
            planId,
            rb.branchKey,
            rb.name,
            rb.description,
            orderIndex++,
            rb.resource.resource.id,
            rb.resource.resource.modelId,
          ]
        );

        await client.query(
          `INSERT INTO execution.step_executions (
            id, execution_id, plan_step_id, task_id, status, 
            resource_id, model_id, fencing_token, priority, available_at
          ) VALUES ($1, $2, $3, $4, 'pending', $5, $6, 0, $7, now());`,
          [
            rb.stepExecutionId,
            executionId,
            rb.planStepId,
            taskId,
            rb.resource.resource.id,
            rb.resource.resource.modelId,
            input.priority || 0,
          ]
        );
      }

      // 2e. Persist Collaboration Run
      await client.query(
        `INSERT INTO execution.collaboration_runs (
          id, task_id, execution_id, plan_id, strategy, state, 
          completion_policy, objective, branch_count, metadata, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, 'CREATED', $6, $7, $8, $9, now(), now());`,
        [
          collaborationRunId,
          taskId,
          executionId,
          planId,
          input.strategy,
          JSON.stringify(input.completionPolicy),
          input.objective,
          resolvedBranches.length,
          JSON.stringify(input.policy || {}),
        ]
      );

      // 2f. Persist Collaboration Branches
      for (const rb of resolvedBranches) {
        await client.query(
          `INSERT INTO execution.collaboration_branches (
            id, collaboration_run_id, branch_key, role, step_execution_id,
            resource_id, model_id, status, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', now(), now());`,
          [
            rb.branchId,
            collaborationRunId,
            rb.branchKey,
            rb.role,
            rb.stepExecutionId,
            rb.resource.resource.id,
            rb.resource.resource.modelId,
          ]
        );
      }

      // 2g. Transactional Outbox Events (ADR-095)
      await client.query(
        `INSERT INTO system.outbox_events (
          id, event_id, event_type, aggregate_type, aggregate_id, payload
        ) VALUES (
          gen_random_uuid(), $1, 'TASK_CREATED', 'task', $2, $3
        );`,
        [
          generateUUIDv7(),
          taskId,
          JSON.stringify({
            tenantId: input.tenantId,
            taskType: input.taskType,
            strategy: input.strategy,
            branchCount: resolvedBranches.length,
          }),
        ]
      );

      await client.query(
        `INSERT INTO system.outbox_events (
          id, event_id, event_type, aggregate_type, aggregate_id, payload
        ) VALUES (
          gen_random_uuid(), $1, 'COLLABORATION_CREATED', 'collaboration_run', $2, $3
        );`,
        [
          generateUUIDv7(),
          collaborationRunId,
          JSON.stringify({
            taskId,
            executionId,
            strategy: input.strategy,
            branchCount: resolvedBranches.length,
          }),
        ]
      );
    });

    return {
      taskId,
      planId,
      executionId,
      collaborationRunId,
      branches: resolvedBranches.map((rb) => ({
        branchKey: rb.branchKey,
        role: rb.role,
        planStepId: rb.planStepId,
        stepExecutionId: rb.stepExecutionId,
        resourceId: rb.resource.resource.id,
        modelId: rb.resource.resource.modelId,
      })),
    };
  }

  /**
   * Initializes a multi-step DAG task and its execution plan.
   */
  public async createDAGTask(input: CreateDAGTaskInput): Promise<DAGTaskCreationResult> {
    return dagService.createDAGTask(input);
  }

  /**
   * Completes an execution attempt, runs the validation barrier, and commits with fencing validation.
   */
  public async commitAttemptSuccess(params: {
    readonly stepExecutionId: string;
    readonly executionId: string;
    readonly taskId: string;
    readonly tenantId: string;
    readonly attemptId: string;
    readonly fencingToken: number;
    readonly response: UnifiedResponse;
    readonly expectedOutputJson?: boolean;
  }): Promise<{
    readonly validationPassed: boolean;
    readonly artifactId: string;
    readonly validationId: string;
    readonly decision: ValidationDecision;
  }> {
    const artifactId = generateUUIDv7();
    const validationId = generateUUIDv7();
    const content = params.response.outputText;
    const contentHash = computeContentHash(content);

    // Run independent validation barrier OUTSIDE the database transaction
    const decision = await validationEngine.validate(validationId, {
      artifactId,
      content,
      requiresJson: params.expectedOutputJson,
    });

    const isAccepted = decision.outcome === "ACCEPT";

    // Commit state with monotonic fencing check in a clean, short transaction
    await db.transaction(async (client) => {
      // Monotonic Fencing Assertion (ADR-039 / ADR-082)
      const updateResult = await client.query(
        `UPDATE execution.step_executions
         SET status = $1,
             quality_score = $2,
             output_tokens = $3,
             latency_ms = $4,
             completed_at = CASE WHEN $1 = 'completed' THEN now() ELSE NULL END,
             updated_at = now()
         WHERE id = $5 AND fencing_token = $6;`,
        [
          isAccepted ? "completed" : "diagnosing",
          decision.confidence,
          params.response.usage.outputTokens,
          params.response.latencyMs,
          params.stepExecutionId,
          params.fencingToken,
        ]
      );

      // If rows affected == 0, worker lease was lost and newer worker took over!
      if (updateResult.rowCount === 0) {
        throw new Error(
          `STALE_WORKER_COMMIT_REJECTED: fencing token mismatch for step ${params.stepExecutionId}`
        );
      }

      // Persist Immutable Content-Addressed Artifact (ADR-084)
      await client.query(
        `INSERT INTO artifacts.artifacts (
          id, tenant_id, task_id, type, storage_uri, inline_content, 
          content_hash, size_bytes, status
        ) VALUES ($1, $2, $3, 'text_output', $4, $5, $6, $7, 'active');`,
        [
          artifactId,
          params.tenantId,
          params.taskId,
          `artifact://${params.taskId}/output.txt`,
          content,
          contentHash,
          Buffer.byteLength(content, "utf8"),
        ]
      );

      // Persist Validation Record (ADR-103)
      await client.query(
        `INSERT INTO validation.validations (
          id, task_id, execution_id, step_execution_id, target_type, 
          target_id, validator_type, status, confidence, started_at, completed_at
        ) VALUES ($1, $2, $3, $4, 'artifact', $5, 'deterministic', $6, $7, now(), now());`,
        [
          validationId,
          params.taskId,
          params.executionId,
          params.stepExecutionId,
          artifactId,
          isAccepted ? "passed" : "failed",
          decision.confidence,
        ]
      );

      // Persist individual validation results
      for (const res of decision.results) {
        await client.query(
          `INSERT INTO validation.validation_results (
            id, validation_id, rule_id, status, score, confidence, details
          ) VALUES ($1, $2, $3, $4, $5, $6, $7);`,
          [
            res.id,
            validationId,
            res.ruleId,
            res.status,
            res.score,
            res.confidence,
            JSON.stringify(res.details),
          ]
        );
      }

      // Mark Attempt Status based on validation barrier outcome
      await client.query(
        `UPDATE execution.execution_attempts
         SET status = $1,
             output_tokens = $2,
             latency_ms = $3,
             completed_at = now()
         WHERE id = $4;`,
        [isAccepted ? "success" : "failed", params.response.usage.outputTokens, params.response.latencyMs, params.attemptId]
      );

      // Advance Task or Branch depending on collaboration topology (Rule E-007)
      if (isAccepted) {
        // Check if this step execution belongs to a collaboration branch
        const branchQuery = await client.query(
          `SELECT id, collaboration_run_id FROM execution.collaboration_branches WHERE step_execution_id = $1;`,
          [params.stepExecutionId]
        );

        if (branchQuery.rows.length > 0) {
          const branch = branchQuery.rows[0];
          await client.query(
            `UPDATE execution.collaboration_branches
             SET status = 'completed',
                 output_artifact_id = $1,
                 updated_at = now()
             WHERE id = $2;`,
            [artifactId, branch.id]
          );

          await client.query(
            `INSERT INTO system.outbox_events (
              id, event_id, event_type, aggregate_type, aggregate_id, payload
            ) VALUES (
              gen_random_uuid(), $1, 'BRANCH_COMPLETED', 'collaboration_branch', $2, $3
            );`,
            [
              generateUUIDv7(),
              branch.id,
              JSON.stringify({
                collaborationRunId: branch.collaboration_run_id,
                outputArtifactId: artifactId,
              }),
            ]
          );
        } else {
          const taskCheck = await client.query(
            `SELECT task_type FROM tasks.tasks WHERE id = $1;`,
            [params.taskId]
          );
          const isDAG = Boolean(taskCheck.rows[0]?.task_type?.includes("dag"));

          if (isDAG) {
            // Record tri-state DAG validation barrier decision (M6.7 / M6.12)
            await DAGValidationBarrier.recordAndEnforceBarrier(client, {
              stepExecutionId: params.stepExecutionId,
              executionId: params.executionId,
              taskId: params.taskId,
              artifactId,
              evaluation: {
                decision: isAccepted ? "ACCEPT" : "REJECT",
                confidence: decision.confidence,
                isQuarantined: !isAccepted,
                recommendation: isAccepted ? "COMMIT_AND_UNBLOCK" : "RETRY_OR_FAIL",
                reasons: decision.reasons,
              },
            });
          }

          // Evaluate DAG downstream dependencies and task completion
          await dagProgressionEngine.evaluateStepProgression(client, {
            stepExecutionId: params.stepExecutionId,
            executionId: params.executionId,
            taskId: params.taskId,
            outputArtifactId: artifactId,
            qualityScore: decision.confidence,
          });
        }
      } else {
        const taskCheck = await client.query(
          `SELECT task_type FROM tasks.tasks WHERE id = $1;`,
          [params.taskId]
        );
        const isDAG = Boolean(taskCheck.rows[0]?.task_type?.includes("dag"));
        if (isDAG) {
          await DAGValidationBarrier.recordAndEnforceBarrier(client, {
            stepExecutionId: params.stepExecutionId,
            executionId: params.executionId,
            taskId: params.taskId,
            artifactId,
            evaluation: {
              decision: "REJECT",
              confidence: decision.confidence,
              isQuarantined: true,
              recommendation: "RETRY_OR_FAIL",
              reasons: decision.reasons,
            },
          });
        }

        // Validation failed: Mark step diagnosing
        await client.query(
          `UPDATE tasks.tasks
           SET status = 'validating',
               updated_at = now()
           WHERE id = $1;`,
          [params.taskId]
        );
      }
    });

    return { validationPassed: isAccepted, artifactId, validationId, decision };
  }

  /**
   * Retrieves durable task details by ID.
   */
  public async getTask(taskId: string): Promise<Task | null> {
    const result = await db.query(
      `SELECT * FROM tasks.tasks WHERE id = $1 AND deleted_at IS NULL;`,
      [taskId]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      tenantId: row.tenant_id,
      projectId: row.project_id,
      createdByUserId: row.created_by_user_id,
      taskType: row.task_type,
      status: row.status,
      priority: row.priority,
      inputPayload: row.input_payload,
      requirements: row.requirements,
      policy: row.policy,
      qualityScore: row.quality_score ? parseFloat(row.quality_score) : undefined,
      outputArtifactId: row.output_artifact_id,
      errorId: row.error_id,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    };
  }

  /**
   * Retrieves durable DAG execution details, topology, and step statuses.
   */
  public async getDAGDetails(taskId: string): Promise<DAGTaskDetails | null> {
    return DAGQueryService.getDAGDetails(taskId);
  }
}

export const executionEngine = new ExecutionEngine();

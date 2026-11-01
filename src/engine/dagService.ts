import { db } from "../db/client.js";
import { generateUUIDv7 } from "../domain/common/id.js";
import { TaskRequirements, TaskPolicy } from "../domain/task/types.js";
import { resourceIntelligence } from "../resources/resourceIntelligence.js";
import { DAGValidator, DAGNode } from "./dagValidator.js";

export interface DAGStepInput {
  readonly stepKey: string;
  readonly name: string;
  readonly description?: string;
  readonly stepType?: string;
  readonly dependencies?: ReadonlyArray<string>;
  readonly requiredCapability?: string;
  readonly criticality?: "mandatory" | "optional";
  readonly resourceId?: string;
  readonly inputPayload?: Record<string, unknown>;
  readonly inputSchema?: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
  readonly qualityTarget?: number;
  readonly timeoutMs?: number;
}

export interface CreateDAGTaskInput {
  readonly tenantId: string;
  readonly taskType: string;
  readonly strategy?: string;
  readonly steps: ReadonlyArray<DAGStepInput>;
  readonly requirements?: TaskRequirements;
  readonly policy?: TaskPolicy;
  readonly priority?: number;
  readonly projectId?: string;
  readonly createdByUserId?: string;
  readonly initialPayload?: Record<string, unknown>;
}

export interface DAGStepResult {
  readonly stepKey: string;
  readonly planStepId: string;
  readonly stepExecutionId: string;
  readonly resourceId: string;
  readonly modelId: string;
  readonly status: "pending" | "blocked";
  readonly inDegree: number;
}

export interface DAGTaskCreationResult {
  readonly taskId: string;
  readonly planId: string;
  readonly executionId: string;
  readonly steps: ReadonlyArray<DAGStepResult>;
  readonly rootStepKeys: ReadonlyArray<string>;
  readonly terminalStepKeys: ReadonlyArray<string>;
}

export class DAGService {
  /**
   * Validates and durably persists a multi-step DAG task, plan, steps, dependencies,
   * and initial step_executions (roots as 'pending', dependents as 'blocked').
   */
  public async createDAGTask(input: CreateDAGTaskInput): Promise<DAGTaskCreationResult> {
    // 1. Build DAG nodes for validation
    const dagNodes: DAGNode[] = input.steps.map((s) => ({
      stepKey: s.stepKey,
      name: s.name,
      description: s.description,
      stepType: s.stepType || "model_inference",
      dependencies: s.dependencies || [],
      requiredCapability: s.requiredCapability,
      criticality: s.criticality || "mandatory",
      inputSchema: s.inputSchema,
      outputSchema: s.outputSchema,
      parameters: s.inputPayload,
    }));

    // 2. Validate topological consistency and acyclicity (INV-M4-001)
    const validation = DAGValidator.validate(dagNodes);
    if (!validation.valid) {
      throw new Error(`DAG_VALIDATION_FAILED: ${validation.errors.join("; ")}`);
    }

    const taskId = generateUUIDv7();
    const planId = generateUUIDv7();
    const executionId = generateUUIDv7();

    // 3. Resolve resource assignments for each step
    const stepResolutionMap = new Map<
      string,
      {
        planStepId: string;
        stepExecutionId: string;
        resourceId: string;
        modelId: string;
        inDegree: number;
        stepInput: DAGStepInput;
      }
    >();

    for (const stepInput of input.steps) {
      const planStepId = generateUUIDv7();
      const stepExecutionId = generateUUIDv7();

      const stepReqs: TaskRequirements = {
        ...(input.requirements || {}),
        requiredCapabilities: stepInput.requiredCapability
          ? [stepInput.requiredCapability]
          : input.requirements?.requiredCapabilities || [],
      };

      const selected = await resourceIntelligence.selectResource(stepReqs);

      stepResolutionMap.set(stepInput.stepKey, {
        planStepId,
        stepExecutionId,
        resourceId: selected.resource.id,
        modelId: selected.resource.modelId,
        inDegree: validation.inDegreeMap[stepInput.stepKey] || 0,
        stepInput,
      });
    }

    // 4. Atomic Transaction Persistence
    const initialPrompt =
      typeof input.initialPayload?.prompt === "string"
        ? input.initialPayload.prompt
        : input.steps.find((s) => typeof s.inputPayload?.prompt === "string")?.inputPayload?.prompt;

    const aggregatedPayload: Record<string, unknown> = {
      ...(input.initialPayload || {}),
      ...(initialPrompt ? { prompt: initialPrompt } : {}),
      steps: Object.fromEntries(input.steps.map((s) => [s.stepKey, s.inputPayload || {}])),
      branches: Object.fromEntries(input.steps.map((s) => [s.stepKey, s.inputPayload || {}])),
    };

    await db.transaction(async (client) => {
      // 4a. Persist Task
      await client.query(
        `INSERT INTO tasks.tasks (
          id, tenant_id, project_id, created_by_user_id, task_type,
          status, priority, input_payload, requirements, policy, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, now(), now());`,
        [
          taskId,
          input.tenantId,
          input.projectId || null,
          input.createdByUserId || null,
          input.taskType,
          input.priority || 0,
          JSON.stringify(aggregatedPayload),
          JSON.stringify(input.requirements || {}),
          JSON.stringify(input.policy || {}),
        ]
      );

      // 4b. Persist Execution Plan
      await client.query(
        `INSERT INTO planning.execution_plans (
          id, task_id, version, status, strategy, cost_estimate, created_at, activated_at
        ) VALUES ($1, $2, 1, 'active', $3, 0.0, now(), now());`,
        [planId, taskId, input.strategy || "dag_workflow"]
      );

      // 4c. Persist Execution Instance
      await client.query(
        `INSERT INTO execution.executions (
          id, task_id, plan_id, status, created_at, updated_at
        ) VALUES ($1, $2, $3, 'running', now(), now());`,
        [executionId, taskId, planId]
      );

      // 4d. Persist Plan Steps
      let orderIndex = 1;
      for (const stepKey of validation.sortedStepKeys) {
        const resolved = stepResolutionMap.get(stepKey)!;
        const s = resolved.stepInput;

        await client.query(
          `INSERT INTO planning.plan_steps (
            id, plan_id, step_key, name, description, step_type,
            order_index, required_capability, input_schema, output_schema,
            assigned_resource_id, assigned_model_id, quality_target, timeout_ms, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now());`,
          [
            resolved.planStepId,
            planId,
            s.stepKey,
            s.name,
            s.description || null,
            s.stepType || "model_inference",
            orderIndex++,
            s.requiredCapability || null,
            s.inputSchema ? JSON.stringify(s.inputSchema) : null,
            s.outputSchema ? JSON.stringify(s.outputSchema) : null,
            resolved.resourceId,
            resolved.modelId,
            s.qualityTarget || null,
            s.timeoutMs || null,
          ]
        );
      }

      // 4e. Persist Step Dependencies (Edges)
      for (const stepKey of validation.sortedStepKeys) {
        const resolved = stepResolutionMap.get(stepKey)!;
        const deps = resolved.stepInput.dependencies || [];

        for (const depKey of deps) {
          const parentResolved = stepResolutionMap.get(depKey)!;
          const depId = generateUUIDv7();

          await client.query(
            `INSERT INTO planning.step_dependencies (
              id, plan_step_id, depends_on_step_id, dependency_type, created_at
            ) VALUES ($1, $2, $3, 'completion', now());`,
            [depId, resolved.planStepId, parentResolved.planStepId]
          );
        }
      }

      // 4f. Persist Step Executions
      // Roots (inDegree = 0) -> 'pending' (available now)
      // Dependents (inDegree > 0) -> 'blocked' (waiting for upstream completion)
      for (const stepKey of validation.sortedStepKeys) {
        const resolved = stepResolutionMap.get(stepKey)!;
        const isRoot = resolved.inDegree === 0;
        const initialStatus = isRoot ? "pending" : "blocked";

        await client.query(
          `INSERT INTO execution.step_executions (
            id, execution_id, plan_step_id, task_id, status,
            resource_id, model_id, fencing_token, priority, available_at, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, now(), now(), now());`,
          [
            resolved.stepExecutionId,
            executionId,
            resolved.planStepId,
            taskId,
            initialStatus,
            resolved.resourceId,
            resolved.modelId,
            input.priority || 0,
          ]
        );
      }

      // 4g. Outbox Events
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
            strategy: input.strategy || "dag_workflow",
            stepCount: input.steps.length,
          }),
        ]
      );

      await client.query(
        `INSERT INTO system.outbox_events (
          id, event_id, event_type, aggregate_type, aggregate_id, payload
        ) VALUES (
          gen_random_uuid(), $1, 'DAG_INITIALIZED', 'execution_plan', $2, $3
        );`,
        [
          generateUUIDv7(),
          planId,
          JSON.stringify({
            taskId,
            executionId,
            rootStepKeys: validation.rootStepKeys,
            terminalStepKeys: validation.terminalStepKeys,
            totalSteps: input.steps.length,
          }),
        ]
      );
    });

    const stepResults: DAGStepResult[] = validation.sortedStepKeys.map((stepKey) => {
      const resolved = stepResolutionMap.get(stepKey)!;
      return {
        stepKey,
        planStepId: resolved.planStepId,
        stepExecutionId: resolved.stepExecutionId,
        resourceId: resolved.resourceId,
        modelId: resolved.modelId,
        status: resolved.inDegree === 0 ? "pending" : "blocked",
        inDegree: resolved.inDegree,
      };
    });

    return {
      taskId,
      planId,
      executionId,
      steps: stepResults,
      rootStepKeys: validation.rootStepKeys,
      terminalStepKeys: validation.terminalStepKeys,
    };
  }
}

export const dagService = new DAGService();

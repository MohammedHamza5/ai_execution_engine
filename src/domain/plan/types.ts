import { PlanStatus, PlanStepType } from "../common/types.js";

export interface ExecutionPlan {
  readonly id: string;
  readonly taskId: string;
  readonly version: number;
  readonly status: PlanStatus;
  readonly strategy: string;
  readonly qualityEstimate?: number;
  readonly latencyEstimateMs?: number;
  readonly costEstimate?: number;
  readonly createdAt: Date;
  readonly validatedAt?: Date;
  readonly activatedAt?: Date;
}

export interface PlanStep {
  readonly id: string;
  readonly planId: string;
  readonly stepKey: string;
  readonly name: string;
  readonly description?: string;
  readonly stepType: PlanStepType;
  readonly orderIndex: number;
  readonly requiredCapability?: string;
  readonly inputSchema?: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
  readonly assignedResourceId?: string;
  readonly assignedModelId?: string;
  readonly qualityTarget?: number;
  readonly timeoutMs?: number;
  readonly createdAt: Date;
}

export interface StepDependency {
  readonly id: string;
  readonly planStepId: string;
  readonly dependsOnStepId: string;
  readonly dependencyType: "completion" | "data_artifact" | "conditional";
  readonly condition?: Record<string, unknown>;
  readonly createdAt: Date;
}

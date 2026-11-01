import { StepExecutionStatus, AttemptStatus } from "../common/types.js";

export interface Execution {
  readonly id: string;
  readonly taskId: string;
  readonly planId: string;
  readonly status: string;
  readonly currentStepId?: string;
  readonly totalCost: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly failureCount: number;
  readonly retryCount: number;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface StepExecution {
  readonly id: string;
  readonly executionId: string;
  readonly planStepId: string;
  readonly taskId: string;
  readonly status: StepExecutionStatus;
  readonly resourceId?: string;
  readonly modelId?: string;
  readonly workerId?: string;
  readonly leaseToken?: string;
  readonly leaseExpiresAt?: Date;
  readonly fencingToken: number;
  readonly priority: number;
  readonly availableAt: Date;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly latencyMs?: number;
  readonly qualityScore?: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ExecutionAttempt {
  readonly id: string;
  readonly stepExecutionId: string;
  readonly attemptNumber: number;
  readonly resourceId?: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly status: AttemptStatus;
  readonly requestRef?: string;
  readonly responseRef?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly latencyMs?: number;
  readonly errorId?: string;
  readonly startedAt: Date;
  readonly completedAt?: Date;
}

export interface ExecutionContext {
  readonly tenantId: string;
  readonly projectId?: string;
  readonly taskId: string;
  readonly planId: string;
  readonly planStepId: string;
  readonly stepExecutionId: string;
  readonly executionId: string;
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly workerId: string;
  readonly resourceId: string;
  readonly leaseToken: string;
  readonly fencingToken: number;
  readonly traceId: string;
  readonly deadlineAt: Date;
}

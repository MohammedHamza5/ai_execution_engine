import { TaskStatus } from "../common/types.js";

export interface TaskRequirements {
  readonly requiredCapabilities?: string[];
  readonly qualityFloor?: number;
  readonly maxCostUsd?: number;
  readonly allowPaid?: boolean;
  readonly timeoutMs?: number;
}

export interface TaskPolicy {
  readonly allowPaid?: boolean;
  readonly maxCost?: number;
  readonly maxAttemptsPerStep?: number;
  readonly maxMigrationsPerStep?: number;
  readonly validationLevel?: "strict" | "standard" | "deterministic_only" | "none";
}

export interface Task {
  readonly id: string;
  readonly tenantId: string;
  readonly projectId?: string;
  readonly createdByUserId?: string;
  readonly taskType: string;
  readonly status: TaskStatus;
  readonly priority: number;
  readonly inputPayload: Record<string, unknown>;
  readonly requirements: TaskRequirements;
  readonly policy: TaskPolicy;
  readonly qualityScore?: number;
  readonly outputArtifactId?: string;
  readonly errorId?: string;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt?: Date;
}

export interface CreateTaskInput {
  readonly tenantId: string;
  readonly projectId?: string;
  readonly createdByUserId?: string;
  readonly taskType: string;
  readonly inputPayload: Record<string, unknown>;
  readonly requirements?: TaskRequirements;
  readonly policy?: TaskPolicy;
  readonly priority?: number;
}

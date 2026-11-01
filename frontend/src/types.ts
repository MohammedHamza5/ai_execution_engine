export type TabType = "dag" | "fleet" | "workbench" | "history" | "telemetry";

export interface FleetResource {
  readonly resourceId: string;
  readonly status: string;
  readonly priority: number;
  readonly providerSlug: string;
  readonly providerName: string;
  readonly providerType: string;
  readonly modelSlug: string;
  readonly modelName: string;
  readonly modelMetadata?: {
    readonly is_paid?: boolean;
    readonly capabilities?: string[];
  };
  readonly healthStatus?: "healthy" | "degraded" | "unhealthy";
  readonly circuitState?: "CLOSED" | "HALF_OPEN" | "OPEN";
  readonly concurrencyLimit?: number;
  readonly latencyP95Ms?: number;
  readonly quotaType?: string;
  readonly limitValue?: number;
  readonly remainingValue?: number;
  readonly capabilities?: string[];
  readonly qualityEstimate?: number;
  readonly taxonomy?: {
    readonly archetype?: string;
    readonly tier?: string;
    readonly specializedDomains?: string[];
    readonly modalities?: {
      readonly inputs?: string[];
      readonly outputs?: string[];
    };
  };
}

export interface DAGNode {
  readonly stepKey: string;
  readonly planStepId: string;
  readonly stepExecutionId: string;
  readonly name: string;
  readonly description?: string;
  readonly stepType: string;
  readonly orderIndex: number;
  readonly status: "pending" | "running" | "completed" | "failed" | "blocked" | "diagnosing";
  readonly dependencies: ReadonlyArray<string>;
  readonly downstream: ReadonlyArray<string>;
  readonly assignedResource?: {
    readonly resourceId: string;
    readonly provider: string;
    readonly model: string;
  };
  readonly qualityScore?: number;
  readonly outputArtifactId?: string;
  readonly latencyMs?: number;
  readonly attemptsCount: number;
  readonly fencingToken: number;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export interface DAGDetails {
  readonly taskId: string;
  readonly tenantId: string;
  readonly taskType: string;
  readonly status: string;
  readonly priority: number;
  readonly qualityScore?: number;
  readonly outputArtifactId?: string;
  readonly plan: {
    readonly id: string;
    readonly version: number;
    readonly status: string;
    readonly strategy: string;
  };
  readonly execution: {
    readonly id: string;
    readonly status: string;
    readonly totalCost: number;
    readonly retryCount: number;
  };
  readonly metrics: {
    readonly totalSteps: number;
    readonly completedSteps: number;
    readonly pendingSteps: number;
    readonly runningSteps: number;
    readonly blockedSteps: number;
    readonly failedSteps: number;
    readonly isComplete: boolean;
  };
  readonly steps: ReadonlyArray<DAGNode>;
  readonly rootStepKeys: ReadonlyArray<string>;
  readonly terminalStepKeys: ReadonlyArray<string>;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export interface TaskSummary {
  readonly id: string;
  readonly taskType: string;
  readonly status: string;
  readonly priority: number;
  readonly qualityScore?: number;
  readonly outputArtifactId?: string;
  readonly stepCount?: number;
  readonly completedStepCount?: number;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export interface TelemetryData {
  readonly queue: Array<{ status: string; count: number }>;
  readonly outbox: { pendingOutbox: number };
  readonly tasks: Array<{ status: string; count: number }>;
  readonly timestamp: string;
}

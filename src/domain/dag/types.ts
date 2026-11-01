/**
 * Milestone M6.1 — Authoritative DAG Data Contract
 * 
 * Defines strictly typed structures for dependency-aware multi-model execution graphs.
 * Preserves ADR-001 through ADR-104 and maintains strict immutability.
 */

export type DAGStepType =
  | "model_inference"
  | "transformation"
  | "validation"
  | "synthesis"
  | "aggregation"
  | "tool_call"
  | (string & {});

export type DAGStepStatus =
  | "blocked"
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "diagnosing";


export interface DAGInputReference {
  readonly sourceStepKey: string;
  readonly artifactType?: string;
  readonly required?: boolean;
}

export interface DAGExpectedOutput {
  readonly artifactType: string;
  readonly schema?: Record<string, unknown>;
  readonly isTerminalOutput?: boolean;
}

export interface DAGRetryPolicy {
  readonly maxAttempts: number;
  readonly backoffMs?: number;
  readonly jitter?: boolean;
  readonly allowedFailureCodes?: ReadonlyArray<string>;
}

export interface DAGValidationPolicy {
  readonly requiredConfidence?: number;
  readonly deterministicOnly?: boolean;
  readonly stopOnReject?: boolean;
}

export interface DAGExecutionConstraints {
  readonly requiredCapability?: string;
  readonly maxCost?: number;
  readonly preferredFamily?: string;
  readonly timeoutMs?: number;
}

export interface DAGNodeContract {
  readonly stepKey: string;
  readonly name: string;
  readonly description?: string;
  readonly stepType: DAGStepType;
  readonly dependencies: ReadonlyArray<string>;
  readonly inputReferences?: ReadonlyArray<DAGInputReference>;
  readonly expectedOutputs?: ReadonlyArray<DAGExpectedOutput>;
  readonly retryPolicy?: DAGRetryPolicy;
  readonly validationPolicy?: DAGValidationPolicy;
  readonly constraints?: DAGExecutionConstraints;
  readonly criticality?: "mandatory" | "optional";
  readonly parameters?: Record<string, unknown>;
  readonly traceMetadata?: Record<string, unknown>;
}

export interface DAGPlanContract {
  readonly planId: string;
  readonly planVersion: number;
  readonly nodes: ReadonlyArray<DAGNodeContract>;
  readonly metadata?: Record<string, unknown>;
  readonly maxStepLimit?: number;
  readonly maxDepthLimit?: number;
}

export interface DAGValidationResult {
  readonly valid: boolean;
  readonly errors: ReadonlyArray<string>;
  readonly sortedStepKeys: ReadonlyArray<string>;
  readonly rootStepKeys: ReadonlyArray<string>;
  readonly terminalStepKeys: ReadonlyArray<string>;
  readonly inDegreeMap: Readonly<Record<string, number>>;
  readonly downstreamMap: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly maxDepth: number;
  readonly cycleNodes?: ReadonlyArray<string>;
}

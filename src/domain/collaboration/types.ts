export type CollaborationStrategy =
  | "parallel_generation"
  | "generator_critic"
  | "parallel_specialist"
  | "solver_arbiter";

export type CompletionPolicyType =
  | "ALL_REQUIRED"
  | "MINIMUM_SUCCESS"
  | "QUORUM"
  | "PRIMARY_PLUS_VALIDATION"
  | "BEST_EFFORT";

export interface CompletionPolicy {
  readonly type: CompletionPolicyType;
  readonly minSuccessCount?: number;
  readonly quorumCount?: number;
  readonly allowPartial?: boolean;
}

export type CollaborationState =
  | "CREATED"
  | "PLANNED"
  | "DISPATCHING"
  | "RUNNING"
  | "PARTIAL_FAILURE"
  | "RECOVERING"
  | "COLLECTING"
  | "SYNTHESIZING"
  | "VALIDATING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "DEAD_LETTERED";

export type BranchStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export type BranchRole =
  | "generator"
  | "critic"
  | "solver"
  | "specialist"
  | "arbiter"
  | "synthesizer";

export interface CollaborationRun {
  readonly id: string;
  readonly taskId: string;
  readonly executionId: string;
  readonly planId: string;
  readonly strategy: CollaborationStrategy;
  readonly state: CollaborationState;
  readonly completionPolicy: CompletionPolicy;
  readonly objective: string;
  readonly branchCount: number;
  readonly synthesisArtifactId?: string;
  readonly resultArtifactId?: string;
  readonly metadata?: Record<string, unknown>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CollaborationBranch {
  readonly id: string;
  readonly collaborationRunId: string;
  readonly branchKey: string;
  readonly role: BranchRole;
  readonly stepExecutionId: string;
  readonly resourceId: string;
  readonly modelId: string;
  readonly status: BranchStatus;
  readonly outputArtifactId?: string;
  readonly errorMessage?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateCollaborationInput {
  readonly taskId: string;
  readonly executionId: string;
  readonly planId: string;
  readonly strategy: CollaborationStrategy;
  readonly completionPolicy: CompletionPolicy;
  readonly objective: string;
  readonly branches: ReadonlyArray<{
    readonly branchKey: string;
    readonly role: BranchRole;
    readonly stepExecutionId: string;
    readonly resourceId: string;
    readonly modelId: string;
  }>;
  readonly metadata?: Record<string, unknown>;
}

export interface ContextArtifactReference {
  readonly artifactId: string;
  readonly role: string;
  readonly branchKey: string;
  readonly contentHash: string;
}

export interface CollaborationContextPackage {
  readonly collaborationRunId: string;
  readonly targetBranchKey: string;
  readonly targetRole: string;
  readonly objective: string;
  readonly sourceArtifacts: ReadonlyArray<ContextArtifactReference>;
  readonly contextPayload: string;
  readonly timestamp: Date;
}

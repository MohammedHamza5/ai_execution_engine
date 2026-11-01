import {
  CollaborationState,
  CompletionPolicy,
  BranchStatus,
} from "../domain/collaboration/types.js";

const VALID_TRANSITIONS: Record<CollaborationState, ReadonlySet<CollaborationState>> = {
  CREATED: new Set(["PLANNED", "CANCELLED", "FAILED"]),
  PLANNED: new Set(["DISPATCHING", "CANCELLED", "FAILED"]),
  DISPATCHING: new Set(["RUNNING", "CANCELLED", "FAILED"]),
  RUNNING: new Set([
    "COLLECTING",
    "PARTIAL_FAILURE",
    "SYNTHESIZING",
    "FAILED",
    "CANCELLED",
  ]),
  PARTIAL_FAILURE: new Set(["RECOVERING", "COLLECTING", "FAILED", "CANCELLED"]),
  RECOVERING: new Set(["RUNNING", "FAILED", "CANCELLED"]),
  COLLECTING: new Set(["SYNTHESIZING", "VALIDATING", "FAILED", "CANCELLED"]),
  SYNTHESIZING: new Set(["VALIDATING", "PARTIAL_FAILURE", "FAILED", "CANCELLED"]),
  VALIDATING: new Set(["COMPLETED", "RECOVERING", "FAILED", "CANCELLED", "DEAD_LETTERED"]),
  COMPLETED: new Set(),
  FAILED: new Set(),
  CANCELLED: new Set(),
  DEAD_LETTERED: new Set(),
};

const TERMINAL_STATES: ReadonlySet<CollaborationState> = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "DEAD_LETTERED",
]);

export interface PolicyEvaluationResult {
  readonly isSatisfied: boolean;
  readonly canProceedToSynthesis: boolean;
  readonly reason: string;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly pendingCount: number;
  readonly totalBranches: number;
}

export class CollaborationStateMachine {
  /**
   * Checks whether a state is terminal.
   */
  public static isTerminal(state: CollaborationState): boolean {
    return TERMINAL_STATES.has(state);
  }

  /**
   * Validates if a state transition is legal according to the finite state machine.
   */
  public static canTransition(from: CollaborationState, to: CollaborationState): boolean {
    if (from === to) return true; // Idempotent same-state check
    const allowed = VALID_TRANSITIONS[from];
    return Boolean(allowed && allowed.has(to));
  }

  /**
   * Asserts a state transition, throwing an error if invalid.
   */
  public static assertTransition(from: CollaborationState, to: CollaborationState): void {
    if (!this.canTransition(from, to)) {
      throw new Error(
        `INVALID_COLLABORATION_TRANSITION: Cannot transition collaboration run from '${from}' to '${to}'`
      );
    }
  }

  /**
   * Evaluates branch statuses against the collaboration run's completion policy.
   */
  public static evaluatePolicy(
    policy: CompletionPolicy,
    branchStatuses: ReadonlyArray<BranchStatus>
  ): PolicyEvaluationResult {
    const totalBranches = branchStatuses.length;
    let completedCount = 0;
    let failedCount = 0;
    let pendingCount = 0;

    for (const status of branchStatuses) {
      if (status === "completed") {
        completedCount++;
      } else if (status === "failed") {
        failedCount++;
      } else if (status === "pending" || status === "running") {
        pendingCount++;
      }
    }

    switch (policy.type) {
      case "ALL_REQUIRED": {
        const isSatisfied = completedCount === totalBranches;
        const hasUnrecoverableFailure = failedCount > 0 && pendingCount === 0;
        return {
          isSatisfied,
          canProceedToSynthesis: isSatisfied,
          reason: isSatisfied
            ? `All ${totalBranches} required branches completed successfully.`
            : hasUnrecoverableFailure
            ? `${failedCount} required branch(es) failed.`
            : `Waiting for ${pendingCount} remaining branches.`,
          completedCount,
          failedCount,
          pendingCount,
          totalBranches,
        };
      }

      case "MINIMUM_SUCCESS": {
        const min = policy.minSuccessCount ?? 1;
        const isSatisfied = completedCount >= min;
        const canNeverSatisfy = completedCount + pendingCount < min;
        return {
          isSatisfied,
          canProceedToSynthesis: isSatisfied && pendingCount === 0,
          reason: isSatisfied
            ? `Minimum success threshold met (${completedCount}/${min}).`
            : canNeverSatisfy
            ? `Insufficient branches remaining to satisfy threshold (${completedCount} + ${pendingCount} < ${min}).`
            : `Waiting for branches to reach threshold (${completedCount}/${min}).`,
          completedCount,
          failedCount,
          pendingCount,
          totalBranches,
        };
      }

      case "QUORUM": {
        const quorum = policy.quorumCount ?? Math.floor(totalBranches / 2) + 1;
        const isSatisfied = completedCount >= quorum;
        const canNeverSatisfy = completedCount + pendingCount < quorum;
        return {
          isSatisfied,
          canProceedToSynthesis: isSatisfied && pendingCount === 0,
          reason: isSatisfied
            ? `Quorum achieved (${completedCount}/${quorum}).`
            : canNeverSatisfy
            ? `Quorum impossible to achieve.`
            : `Waiting for quorum (${completedCount}/${quorum}).`,
          completedCount,
          failedCount,
          pendingCount,
          totalBranches,
        };
      }

      case "PRIMARY_PLUS_VALIDATION": {
        // By convention, at least 2 branches: primary (index 0) and validator (index 1)
        const isSatisfied = completedCount >= 2;
        return {
          isSatisfied,
          canProceedToSynthesis: isSatisfied,
          reason: isSatisfied
            ? `Primary generation and independent validation branches completed.`
            : `Waiting for primary and validation branches to complete.`,
          completedCount,
          failedCount,
          pendingCount,
          totalBranches,
        };
      }

      case "BEST_EFFORT": {
        const isSatisfied = completedCount > 0 && pendingCount === 0;
        return {
          isSatisfied,
          canProceedToSynthesis: isSatisfied,
          reason: isSatisfied
            ? `Best effort completed with ${completedCount} successful branch(es).`
            : pendingCount > 0
            ? `Waiting for remaining best-effort branches.`
            : `No branches succeeded in best-effort run.`,
          completedCount,
          failedCount,
          pendingCount,
          totalBranches,
        };
      }

      default:
        return {
          isSatisfied: false,
          canProceedToSynthesis: false,
          reason: `Unknown completion policy type: ${(policy as any).type}`,
          completedCount,
          failedCount,
          pendingCount,
          totalBranches,
        };
    }
  }
}

export const collaborationStateMachine = CollaborationStateMachine;

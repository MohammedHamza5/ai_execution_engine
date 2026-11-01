import { NormalizedResourceCandidate } from "../domain/resource/stateTypes.js";
import { TaskPolicy, TaskRequirements } from "../domain/task/types.js";
import { EligibilityEngine, EligibilityResult } from "./eligibilityEngine.js";
import { ResourceScoringEngine, ScoredResourceCandidate } from "./resourceScoringEngine.js";

export type StrategicDecisionType =
  | "SELECT_RESOURCE"
  | "WAIT"
  | "MIGRATE"
  | "FAIL"
  | "REQUEST_APPROVAL";

export interface StrategicResourceDecision {
  readonly decisionType: StrategicDecisionType;
  readonly selectedCandidate?: ScoredResourceCandidate;
  readonly waitMs?: number;
  readonly requestApprovalCandidate?: NormalizedResourceCandidate;
  readonly rankedCandidates: ReadonlyArray<ScoredResourceCandidate>;
  readonly eligibility: EligibilityResult;
  readonly reasons: ReadonlyArray<string>;
  readonly policyContext: {
    readonly allowPaid: boolean;
    readonly maxCost?: number;
    readonly requiredCapabilities?: ReadonlyArray<string>;
    readonly maxTolerableWaitMs: number;
  };
  readonly timestamp: Date;
}

export interface ResourceDecisionOptions {
  readonly currentResourceId?: string;
  readonly excludedResourceIds?: ReadonlyArray<string>;
  readonly requirements?: TaskRequirements;
  readonly policy?: TaskPolicy;
  readonly maxTolerableWaitMs?: number; // Default: 30,000ms (30s)
  readonly taskDeadlineAt?: Date;
  readonly failureReason?: string;
}

export class ResourceDecisionEngine {
  /**
   * Deterministically evaluates candidates across Hard Constraints and Soft Scoring
   * to produce an explainable strategic execution decision.
   * 
   * Enforces Section 20 & 21 of M4 MASTER EXECUTION PLAN.
   */
  public static evaluate(
    allCandidates: ReadonlyArray<NormalizedResourceCandidate>,
    options: ResourceDecisionOptions = {}
  ): StrategicResourceDecision {
    const now = new Date();
    const maxTolerableWaitMs = options.maxTolerableWaitMs ?? 30_000;
    const allowPaid = Boolean(
      options.policy?.allowPaid ?? (options.requirements as any)?.allowPaid ?? false
    );
    const requiredCaps = options.requirements?.requiredCapabilities || [];

    const policyContext = {
      allowPaid,
      maxCost: options.policy?.maxCost,
      requiredCapabilities: requiredCaps,
      maxTolerableWaitMs,
    };

    const excludedIds = [
      ...(options.currentResourceId ? [options.currentResourceId] : []),
      ...(options.excludedResourceIds || []),
    ];

    // Stage 1: Hard Constraint Eligibility Filtering
    const eligibility = EligibilityEngine.filter(allCandidates, {
      requirements: options.requirements,
      policy: options.policy,
      excludedResourceIds: excludedIds,
    });

    const reasons: string[] = [];

    // Case 1: At least one resource is eligible and ready to execute
    if (eligibility.eligible.length > 0) {
      const ranked = ResourceScoringEngine.rank(eligibility.eligible, {
        requirements: options.requirements,
      });

      const winner = ranked[0];

      if (options.currentResourceId) {
        // MIGRATE Decision
        reasons.push(
          `MIGRATE: Migrating away from resource ${options.currentResourceId} (Reason: ${options.failureReason || "RESOURCE_FAILURE"}).`
        );
        reasons.push(
          `Selected alternative resource ${winner.candidate.modelSlug} (${winner.candidate.resourceId}) with highest score ${winner.totalScore.toFixed(4)}.`
        );
        reasons.push(
          `Candidate advantages: ${winner.candidate.billingClass} tier, Health: ${winner.candidate.health}, Priority: ${winner.candidate.priority}.`
        );

        return {
          decisionType: "MIGRATE",
          selectedCandidate: winner,
          rankedCandidates: ranked,
          eligibility,
          reasons,
          policyContext,
          timestamp: now,
        };
      } else {
        // Initial SELECT_RESOURCE Decision
        reasons.push(
          `SELECT_RESOURCE: Selected ${winner.candidate.modelSlug} (${winner.candidate.resourceId}) with highest expected completion score ${winner.totalScore.toFixed(4)}.`
        );
        reasons.push(
          `Free-first compliance: ${winner.candidate.billingClass} resource selected out of ${eligibility.eligible.length} eligible candidates.`
        );

        return {
          decisionType: "SELECT_RESOURCE",
          selectedCandidate: winner,
          rankedCandidates: ranked,
          eligibility,
          reasons,
          policyContext,
          timestamp: now,
        };
      }
    }

    // Case 2: Zero resources currently eligible -> Check if WAIT is justified
    let waitCandidate: NormalizedResourceCandidate | null = null;
    let shortestWaitMs = Infinity;

    // Check if any candidate (including current resource or compliant resources) has a temporary reset / cooldown window
    for (const cand of allCandidates) {
      // Must not be an unauthorized paid resource
      if (cand.isPaid && !allowPaid) continue;
      // Must not be disabled or retired
      if (cand.status === "disabled" || cand.status === "retired") continue;
      // Must satisfy required capabilities
      if (requiredCaps.length > 0) {
        const supportedSet = new Set(cand.capabilities);
        if (!requiredCaps.every((c) => supportedSet.has(c as any))) continue;
      }

      if (cand.rateLimit?.isRateLimited && cand.rateLimit.cooldownUntil) {
        const diff = cand.rateLimit.cooldownUntil.getTime() - now.getTime();
        if (diff > 0 && diff < shortestWaitMs) {
          shortestWaitMs = diff;
          waitCandidate = cand;
        }
      }
      for (const q of cand.quotas || []) {
        if (q.resetAt) {
          const diff = q.resetAt.getTime() - now.getTime();
          if (diff > 0 && diff < shortestWaitMs) {
            shortestWaitMs = diff;
            waitCandidate = cand;
          }
        }
      }
    }

    // If wait is within threshold and doesn't violate deadline:
    if (waitCandidate && shortestWaitMs <= maxTolerableWaitMs) {
      const deadlineAllows = !options.taskDeadlineAt || now.getTime() + shortestWaitMs <= options.taskDeadlineAt.getTime();
      if (deadlineAllows) {
        reasons.push(
          `WAIT: Resource ${waitCandidate.modelSlug} is temporarily rate-limited; reset occurs in ${Math.round(shortestWaitMs / 1000)}s (under ${maxTolerableWaitMs / 1000}s threshold).`
        );
        reasons.push(
          `Waiting preserves execution on preferred primary free resource without unnecessary failover.`
        );

        return {
          decisionType: "WAIT",
          waitMs: shortestWaitMs,
          rankedCandidates: [],
          eligibility,
          reasons,
          policyContext,
          timestamp: now,
        };
      }
    }

    // Case 3: Check if a capable paid resource exists, but paid execution is unauthorized
    const paidExcluded = eligibility.excluded.find((e) => e.rejectionReason === "PAID_UNAUTHORIZED");
    if (paidExcluded) {
      reasons.push(
        `REQUEST_APPROVAL: Capable paid resource ${paidExcluded.candidate.modelSlug} (${paidExcluded.candidate.resourceId}) exists, but paid execution is unauthorized (allowPaid: false).`
      );
      reasons.push(
        `Zero silent paid spend invariant enforced (ADR-072). Explicit authorization required before dispatch.`
      );

      return {
        decisionType: "REQUEST_APPROVAL",
        requestApprovalCandidate: paidExcluded.candidate,
        rankedCandidates: [],
        eligibility,
        reasons,
        policyContext,
        timestamp: now,
      };
    }

    // Case 4: No eligible resources, no viable wait, no paid fallback -> Deterministic FAIL
    reasons.push(
      `FAIL: No active resources satisfy non-negotiable hard constraints.`
    );
    reasons.push(
      `Rejection summary: ${Array.from(new Set(eligibility.excluded.map((e) => e.rejectionReason))).join(", ")}.`
    );

    return {
      decisionType: "FAIL",
      rankedCandidates: [],
      eligibility,
      reasons,
      policyContext,
      timestamp: now,
    };
  }
}

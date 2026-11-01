import { TaskPolicy, TaskRequirements } from "../domain/task/types.js";
import {
  NormalizedResourceCandidate,
  ResourceCapability,
  normalizeCapabilities,
} from "../domain/resource/stateTypes.js";

export type HardConstraintRejectionCode =
  | "EXCLUDED_RESOURCE"
  | "CREDENTIAL_INVALID"
  | "RESOURCE_INACTIVE"
  | "CAPABILITY_UNSUPPORTED"
  | "PAID_UNAUTHORIZED"
  | "COST_CEILING_EXCEEDED"
  | "HEALTH_UNAVAILABLE"
  | "QUOTA_EXHAUSTED"
  | "RATE_LIMITED"
  | "CONTEXT_WINDOW_EXCEEDED";

export interface ExcludedResourceCandidate {
  readonly candidate: NormalizedResourceCandidate;
  readonly rejectionReason: HardConstraintRejectionCode;
  readonly message: string;
}

export interface EligibilityResult {
  readonly eligible: ReadonlyArray<NormalizedResourceCandidate>;
  readonly excluded: ReadonlyArray<ExcludedResourceCandidate>;
  readonly totalCandidates: number;
}

export interface EligibilityFilterOptions {
  readonly requirements?: TaskRequirements;
  readonly policy?: TaskPolicy;
  readonly excludedResourceIds?: ReadonlyArray<string>;
  readonly estimatedTokens?: number;
}

export class EligibilityEngine {
  /**
   * Deterministically evaluates candidate resources against non-negotiable hard constraints.
   * Enforces Section 10 & 11 of M4 MASTER EXECUTION PLAN.
   * 
   * A resource failing ANY hard constraint is excluded and cannot win via soft scoring.
   */
  public static filter(
    candidates: ReadonlyArray<NormalizedResourceCandidate>,
    options: EligibilityFilterOptions = {}
  ): EligibilityResult {
    const eligible: NormalizedResourceCandidate[] = [];
    const excluded: ExcludedResourceCandidate[] = [];

    const excludedIds = new Set<string>(options.excludedResourceIds || []);
    const allowPaid = Boolean(
      options.policy?.allowPaid ?? (options.requirements as any)?.allowPaid ?? false
    );
    const requiredCaps: ResourceCapability[] = options.requirements?.requiredCapabilities
      ? normalizeCapabilities(options.requirements.requiredCapabilities)
      : [];

    const now = new Date();

    for (const candidate of candidates) {
      // 1. Exclusion List (e.g. current or previously failed resources)
      if (excludedIds.has(candidate.resourceId)) {
        excluded.push({
          candidate,
          rejectionReason: "EXCLUDED_RESOURCE",
          message: `Resource ${candidate.resourceId} (${candidate.modelSlug}) is explicitly excluded for this step/attempt.`,
        });
        continue;
      }

      // 2. Resource Active State
      if (candidate.status === "disabled" || candidate.status === "retired") {
        excluded.push({
          candidate,
          rejectionReason: "RESOURCE_INACTIVE",
          message: `Resource status is '${candidate.status}'. Only active or degraded resources can be leased.`,
        });
        continue;
      }

      // 3. Credential Validity
      if (candidate.credentialId && candidate.secretReference === "revoked") {
        excluded.push({
          candidate,
          rejectionReason: "CREDENTIAL_INVALID",
          message: `Credential for resource is revoked or invalid.`,
        });
        continue;
      }

      // 4. Capability Matching (Non-negotiable functional requirement)
      if (requiredCaps.length > 0) {
        const supportedSet = new Set(candidate.capabilities);
        const missing = requiredCaps.filter((cap) => !supportedSet.has(cap));
        if (missing.length > 0) {
          excluded.push({
            candidate,
            rejectionReason: "CAPABILITY_UNSUPPORTED",
            message: `Resource lacks required capabilities: [${missing.join(", ")}].`,
          });
          continue;
        }
      }

      // 5. Economic Guardrail: Zero Silent Paid Spend (ADR-072)
      if (candidate.isPaid && !allowPaid) {
        excluded.push({
          candidate,
          rejectionReason: "PAID_UNAUTHORIZED",
          message: `Resource is paid (${candidate.billingClass}) but allowPaid is false. Zero silent spend enforced.`,
        });
        continue;
      }

      // 6. Availability & Health (Reject completely unavailable/dead backends)
      if (candidate.health === "UNAVAILABLE") {
        excluded.push({
          candidate,
          rejectionReason: "HEALTH_UNAVAILABLE",
          message: `Resource health is UNAVAILABLE due to sustained outages or tripped circuit breaker.`,
        });
        continue;
      }

      // 7. Quota Sufficiency
      if (candidate.primaryQuotaRemaining !== undefined && candidate.primaryQuotaRemaining <= 0) {
        excluded.push({
          candidate,
          rejectionReason: "QUOTA_EXHAUSTED",
          message: `Primary quota for resource is exhausted (remaining: ${candidate.primaryQuotaRemaining}).`,
        });
        continue;
      }

      // 8. Temporary Rate Limits
      if (
        candidate.rateLimit.isRateLimited &&
        candidate.rateLimit.cooldownUntil &&
        candidate.rateLimit.cooldownUntil.getTime() > now.getTime()
      ) {
        excluded.push({
          candidate,
          rejectionReason: "RATE_LIMITED",
          message: `Resource is temporarily rate-limited until ${candidate.rateLimit.cooldownUntil.toISOString()}.`,
        });
        continue;
      }

      // 9. Context Window Constraint
      if (
        options.estimatedTokens &&
        (candidate as any).maxContextTokens &&
        options.estimatedTokens > (candidate as any).maxContextTokens
      ) {
        excluded.push({
          candidate,
          rejectionReason: "CONTEXT_WINDOW_EXCEEDED",
          message: `Estimated prompt tokens (${options.estimatedTokens}) exceed model context window limit.`,
        });
        continue;
      }

      // Passed all hard constraints!
      eligible.push(candidate);
    }

    return {
      eligible,
      excluded,
      totalCandidates: candidates.length,
    };
  }
}

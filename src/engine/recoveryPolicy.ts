import { NormalizedProviderError, ProviderErrorCode } from "../adapters/types.js";
import { ValidationDiagnosis } from "./validationDiagnosis.js";

export type RecoveryAction =
  | "RETRY_SAME"
  | "MIGRATE_RESOURCE"
  | "WAIT"
  | "FAIL";

export interface RecoveryDecision {
  readonly action: RecoveryAction;
  readonly reason: string;
  readonly retryable: boolean;
  readonly migrationRecommended: boolean;
  readonly waitRequired: boolean;
  readonly retryAfterMs?: number;
  readonly allowPaid?: boolean;
}

/**
 * Fundamental provider error categories that indicate non-recoverable client,
 * security, parameter, or prompt-level defects where neither retry nor resource
 * migration is permitted.
 */
const NON_RECOVERABLE_CODES = new Set<ProviderErrorCode>([
  ProviderErrorCode.INVALID_REQUEST,
  ProviderErrorCode.AUTHENTICATION,
  ProviderErrorCode.AUTHORIZATION,
  ProviderErrorCode.CONTEXT_TOO_LARGE,
  ProviderErrorCode.UNSUPPORTED_CAPABILITY,
  ProviderErrorCode.CONTENT_FILTER,
]);

export class RecoveryPolicy {
  /**
   * Deterministically evaluates a normalized provider error into an explicit recovery action.
   *
   * Precedence:
   * 1. Fundamental non-recoverable failures (Auth, Invalid Request, Context Overflow) -> FAIL
   * 2. Migration-recommended failures (Quota, Rate Limit, Server Outage) -> MIGRATE_RESOURCE
   * 3. Retryable on same resource without migration recommendation -> RETRY_SAME
   * 4. Unrecoverable / non-retryable defaults -> FAIL
   */
  public static evaluate(error: NormalizedProviderError): RecoveryDecision {
    const code = error.code;

    // 1. Non-Recoverable Failures: Security, syntax, prompt limits, model mismatch
    if (NON_RECOVERABLE_CODES.has(code)) {
      return {
        action: "FAIL",
        reason: `${code}: Non-recoverable error. Task cannot be completed by retrying or migrating.`,
        retryable: false,
        migrationRecommended: false,
        waitRequired: false,
      };
    }

    // 2. Migration Recommended Failures
    if (error.migrationRecommended) {
      return {
        action: "MIGRATE_RESOURCE",
        reason: `${code}: Resource failure is transient or capacity-related and migration is recommended.`,
        retryable: error.retryable,
        migrationRecommended: true,
        waitRequired: Boolean(error.retryAfterMs && error.retryAfterMs > 0),
        retryAfterMs: error.retryAfterMs,
      };
    }

    // 3. Retryable on Same Resource
    if (error.retryable) {
      return {
        action: "RETRY_SAME",
        reason: `${code}: Transient failure detected and retry on the same resource is eligible.`,
        retryable: true,
        migrationRecommended: false,
        waitRequired: Boolean(error.retryAfterMs && error.retryAfterMs > 0),
        retryAfterMs: error.retryAfterMs,
      };
    }

    // 4. Non-retryable and Non-migratable default
    return {
      action: "FAIL",
      reason: `${code}: Failure is neither retryable nor migratable.`,
      retryable: false,
      migrationRecommended: false,
      waitRequired: false,
    };
  }

  /**
   * Deterministically evaluates a validation failure diagnosis into an explicit recovery action (M2.4).
   * 
   * Precedence & Rules:
   * 1. UNCERTAIN outcome -> WAIT (Never auto-retry blindly; requires human review or secondary verification)
   * 2. Non-recoverable or attempts exhausted -> FAIL
   * 3. Migration recommended (capability failure, persistent format defect, evidence missing) -> MIGRATE_RESOURCE
   * 4. Retryable on same resource (first attempt schema or transient output defect) -> RETRY_SAME
   * 5. Zero Silent Paid Spend: strictly enforces allowPaid flag on decisions.
   */
  public static evaluateValidation(
    diagnosis: ValidationDiagnosis,
    options?: { allowPaid?: boolean }
  ): RecoveryDecision {
    const allowPaid = options?.allowPaid ?? false;

    // 1. Inconclusive / Uncertain validation -> WAIT (Never auto-retry blindly)
    if (diagnosis.outcome === "UNCERTAIN" || diagnosis.failureClass === "UNCERTAIN") {
      return {
        action: "WAIT",
        reason: `UNCERTAIN: Validation checks inconclusive (${diagnosis.reasons.join("; ")}). Secondary verification or human review required.`,
        retryable: false,
        migrationRecommended: false,
        waitRequired: true,
        allowPaid,
      };
    }

    // 2. Non-recoverable failure (exceeded attempts, fatal assertion) -> FAIL
    if (!diagnosis.recoverable || diagnosis.recommendedAction === "FAIL") {
      return {
        action: "FAIL",
        reason: `${diagnosis.failureClass}: Validation failure is non-recoverable (${diagnosis.reasons.join("; ")}).`,
        retryable: false,
        migrationRecommended: false,
        waitRequired: false,
        allowPaid,
      };
    }

    // 3. Migration recommended (capability failure, persistent schema error, evidence missing)
    if (diagnosis.recommendedAction === "MIGRATE_RESOURCE") {
      return {
        action: "MIGRATE_RESOURCE",
        reason: `${diagnosis.failureClass}: Capability or repeated validation defect; migrating resource (${diagnosis.reasons.join("; ")}).`,
        retryable: true,
        migrationRecommended: true,
        waitRequired: false,
        allowPaid,
      };
    }

    // 4. Retry on same resource (first attempt schema or transient output defect)
    if (diagnosis.recommendedAction === "RETRY_SAME") {
      return {
        action: "RETRY_SAME",
        reason: `${diagnosis.failureClass}: Output defect eligible for retry with schema guidance (${diagnosis.reasons.join("; ")}).`,
        retryable: true,
        migrationRecommended: false,
        waitRequired: false,
        allowPaid,
      };
    }

    return {
      action: "FAIL",
      reason: `${diagnosis.failureClass}: Unhandled validation failure state.`,
      retryable: false,
      migrationRecommended: false,
      waitRequired: false,
      allowPaid,
    };
  }
}

export const recoveryPolicy = RecoveryPolicy;

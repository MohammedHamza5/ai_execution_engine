import { ValidationDecision, ValidationResult } from "../domain/validation/types.js";
import { ValidationOutcome } from "../domain/common/types.js";

export interface NormalizedValidationOutcome {
  readonly outcome: ValidationOutcome;
  readonly isAccepted: boolean;
  readonly isRejected: boolean;
  readonly isUncertain: boolean;
  readonly canComplete: boolean;
  readonly requiresRecovery: boolean;
  readonly requiresSecondaryVerification: boolean;
  readonly confidence: number;
  readonly reasons: ReadonlyArray<string>;
  readonly failedResults: ReadonlyArray<ValidationResult>;
  readonly passedResults: ReadonlyArray<ValidationResult>;
  readonly inconclusiveResults: ReadonlyArray<ValidationResult>;
  readonly evidenceSummary: {
    readonly totalChecks: number;
    readonly passedCount: number;
    readonly failedCount: number;
    readonly inconclusiveCount: number;
  };
}

/**
 * Deterministic Normalization Layer for Validation Engine Decisions (ADR-103).
 * 
 * Rules:
 * 1. Absolute Truth Invariance: NEVER convert 'REJECT' or 'UNCERTAIN' into 'ACCEPT'.
 * 2. Tri-state outcome preserved: 'ACCEPT', 'REJECT', 'UNCERTAIN'.
 * 3. Evidence, rule details, and failure reasons are preserved without mutation.
 * 4. Zero external I/O or provider dependencies.
 */
export class ValidationOutcomeNormalizer {
  public static normalize(decision: ValidationDecision): NormalizedValidationOutcome {
    const rawOutcome = decision.outcome;
    const outcome: ValidationOutcome =
      rawOutcome === "ACCEPT" ? "ACCEPT" : rawOutcome === "REJECT" ? "REJECT" : "UNCERTAIN";

    const isAccepted = outcome === "ACCEPT";
    const isRejected = outcome === "REJECT";
    const isUncertain = outcome === "UNCERTAIN";

    const results = decision.results || [];
    const failedResults: ValidationResult[] = [];
    const passedResults: ValidationResult[] = [];
    const inconclusiveResults: ValidationResult[] = [];

    for (const r of results) {
      if (r.status === "fail") {
        failedResults.push(r);
      } else if (r.status === "pass") {
        passedResults.push(r);
      } else {
        inconclusiveResults.push(r);
      }
    }

    const clampedConfidence = Math.max(0, Math.min(1, decision.confidence ?? (isAccepted ? 1 : 0)));

    return {
      outcome,
      isAccepted,
      isRejected,
      isUncertain,
      canComplete: isAccepted,
      requiresRecovery: isRejected,
      requiresSecondaryVerification: isUncertain,
      confidence: clampedConfidence,
      reasons: Object.freeze([...(decision.reasons || [])]),
      failedResults: Object.freeze(failedResults),
      passedResults: Object.freeze(passedResults),
      inconclusiveResults: Object.freeze(inconclusiveResults),
      evidenceSummary: {
        totalChecks: results.length,
        passedCount: passedResults.length,
        failedCount: failedResults.length,
        inconclusiveCount: inconclusiveResults.length,
      },
    };
  }
}

export const validationOutcomeNormalizer = ValidationOutcomeNormalizer;

import { NormalizedValidationOutcome } from "./validationOutcome.js";
import { ValidationOutcome } from "../domain/common/types.js";

export type ValidationFailureClass =
  | "SCHEMA_FAILURE"
  | "DETERMINISTIC_FAILURE"
  | "EXECUTION_FAILURE"
  | "EVIDENCE_FAILURE"
  | "UNCERTAIN"
  | "NONE";

export type ValidationRecoveryAction =
  | "RETRY_SAME"
  | "MIGRATE_RESOURCE"
  | "WAIT"
  | "FAIL";

export interface DiagnoseParams {
  readonly validationId: string;
  readonly artifactId: string;
  readonly normalizedOutcome: NormalizedValidationOutcome;
  readonly attemptNumber?: number;
  readonly maxAttempts?: number;
}

export interface ValidationDiagnosis {
  readonly validationId: string;
  readonly artifactId: string;
  readonly outcome: ValidationOutcome;
  readonly failureClass: ValidationFailureClass;
  readonly failedTiers: ReadonlyArray<string>;
  readonly reasons: ReadonlyArray<string>;
  readonly recoverable: boolean;
  readonly recommendedAction: ValidationRecoveryAction;
  readonly details: Record<string, unknown>;
  readonly evidenceSummary: {
    readonly totalChecks: number;
    readonly passedCount: number;
    readonly failedCount: number;
    readonly inconclusiveCount: number;
  };
}

/**
 * Known deterministic rule IDs for classification.
 */
const KNOWN_RULES: Record<string, { tier: string; failureClass: ValidationFailureClass }> = {
  "01924b00-0000-7000-8000-000000000010": {
    tier: "handshake",
    failureClass: "DETERMINISTIC_FAILURE",
  },
  "01924b00-0000-7000-8000-000000000020": {
    tier: "schema",
    failureClass: "SCHEMA_FAILURE",
  },
  "01924b00-0000-7000-8000-000000000030": {
    tier: "deterministic",
    failureClass: "DETERMINISTIC_FAILURE",
  },
};

/**
 * Diagnostic Engine for Validation Failures (ADR-103).
 * 
 * Invariants:
 * 1. Answers "Why did this output fail?", NEVER selects resources or providers.
 * 2. Deterministic: identical inputs produce identical diagnosis.
 * 3. Preserves all failure evidence, tiers, and details.
 * 4. UNCERTAIN outcomes are routed to WAIT / secondary validation, never blindly retried.
 */
export class ValidationDiagnosisEngine {
  public static diagnose(params: DiagnoseParams): ValidationDiagnosis {
    const { validationId, artifactId, normalizedOutcome, attemptNumber = 1, maxAttempts = 3 } = params;

    // 1. Success case: No failure
    if (normalizedOutcome.isAccepted) {
      return {
        validationId,
        artifactId,
        outcome: "ACCEPT",
        failureClass: "NONE",
        failedTiers: Object.freeze([]),
        reasons: normalizedOutcome.reasons,
        recoverable: false,
        recommendedAction: "FAIL", // Not used for success
        details: {},
        evidenceSummary: normalizedOutcome.evidenceSummary,
      };
    }

    // 2. Uncertain case: Inconclusive validation
    if (normalizedOutcome.isUncertain) {
      return {
        validationId,
        artifactId,
        outcome: "UNCERTAIN",
        failureClass: "UNCERTAIN",
        failedTiers: Object.freeze(["uncertainty_barrier"]),
        reasons: normalizedOutcome.reasons.length > 0
          ? normalizedOutcome.reasons
          : Object.freeze(["Validation confidence below deterministic threshold"]),
        recoverable: false,
        recommendedAction: "WAIT",
        details: {
          inconclusiveResults: normalizedOutcome.inconclusiveResults,
        },
        evidenceSummary: normalizedOutcome.evidenceSummary,
      };
    }

    // 3. Rejected case: Categorize failure classes and tiers
    const failedResults = normalizedOutcome.failedResults;
    const failedTiers = new Set<string>();
    let primaryFailureClass: ValidationFailureClass = "DETERMINISTIC_FAILURE";

    const aggregatedDetails: Record<string, unknown> = {};

    for (const res of failedResults) {
      aggregatedDetails[res.ruleId] = res.details;

      const known = KNOWN_RULES[res.ruleId];
      if (known) {
        failedTiers.add(known.tier);
        if (known.failureClass === "SCHEMA_FAILURE") {
          primaryFailureClass = "SCHEMA_FAILURE";
        }
      } else {
        // Inspect details for classification hints
        const detailsStr = JSON.stringify(res.details || {}).toLowerCase();
        if (detailsStr.includes("schema") || detailsStr.includes("json") || detailsStr.includes("parse")) {
          failedTiers.add("schema");
          primaryFailureClass = "SCHEMA_FAILURE";
        } else if (detailsStr.includes("compiler") || detailsStr.includes("syntax") || detailsStr.includes("execution")) {
          failedTiers.add("compiler");
          primaryFailureClass = "EXECUTION_FAILURE";
        } else if (detailsStr.includes("evidence") || detailsStr.includes("grounding") || detailsStr.includes("citation")) {
          failedTiers.add("evidence");
          primaryFailureClass = "EVIDENCE_FAILURE";
        } else {
          failedTiers.add("deterministic");
        }
      }
    }

    // 4. Recoverability & Action Recommendation
    const hasExceededAttempts = attemptNumber >= maxAttempts;
    let recoverable = !hasExceededAttempts;
    let recommendedAction: ValidationRecoveryAction = "RETRY_SAME";

    if (hasExceededAttempts) {
      recoverable = false;
      recommendedAction = "FAIL";
    } else if (primaryFailureClass === "SCHEMA_FAILURE") {
      // First attempt failure can retry same; repeated failure recommends migrating to higher capability model
      recommendedAction = attemptNumber > 1 ? "MIGRATE_RESOURCE" : "RETRY_SAME";
    } else if (primaryFailureClass === "DETERMINISTIC_FAILURE") {
      // For bounds violation (e.g. repeated error substrings), migration or retry
      recommendedAction = attemptNumber > 1 ? "MIGRATE_RESOURCE" : "RETRY_SAME";
    } else if (primaryFailureClass === "EXECUTION_FAILURE") {
      recommendedAction = "RETRY_SAME";
    } else if (primaryFailureClass === "EVIDENCE_FAILURE") {
      recommendedAction = "MIGRATE_RESOURCE";
    }

    return {
      validationId,
      artifactId,
      outcome: "REJECT",
      failureClass: primaryFailureClass,
      failedTiers: Object.freeze(Array.from(failedTiers)),
      reasons: normalizedOutcome.reasons,
      recoverable,
      recommendedAction,
      details: aggregatedDetails,
      evidenceSummary: normalizedOutcome.evidenceSummary,
    };
  }
}

export const validationDiagnosisEngine = ValidationDiagnosisEngine;

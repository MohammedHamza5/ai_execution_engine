import { ValidationOutcome, ValidationStatus } from "../common/types.js";

export interface Validation {
  readonly id: string;
  readonly taskId: string;
  readonly executionId: string;
  readonly stepExecutionId: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly validatorType: string;
  readonly status: ValidationStatus;
  readonly confidence?: number;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly createdAt: Date;
}

export interface ValidationRule {
  readonly id: string;
  readonly name: string;
  readonly type: "schema" | "deterministic" | "compiler" | "evidence";
  readonly definition: Record<string, unknown>;
  readonly version: number;
  readonly severity: "error" | "warning";
}

export interface ValidationResult {
  readonly id: string;
  readonly validationId: string;
  readonly ruleId: string;
  readonly status: "pass" | "fail" | "inconclusive";
  readonly score: number;
  readonly confidence: number;
  readonly details: Record<string, unknown>;
}

export interface ValidationDecision {
  readonly outcome: ValidationOutcome;
  readonly confidence: number;
  readonly reasons: string[];
  readonly results: ValidationResult[];
}

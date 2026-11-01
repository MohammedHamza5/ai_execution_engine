import { describe, it, expect } from "vitest";
import { ValidationDiagnosisEngine } from "../src/engine/validationDiagnosis.js";
import { ValidationOutcomeNormalizer } from "../src/engine/validationOutcome.js";
import { ValidationDecision } from "../src/domain/validation/types.js";

describe("M2.2 — Validation Failure Diagnosis", () => {
  const schemaFailDecision: ValidationDecision = {
    outcome: "REJECT",
    confidence: 0.0,
    reasons: ["Schema Validation failed: Malformed JSON output (Unexpected token)"],
    results: [
      {
        id: "res-1",
        validationId: "val-100",
        ruleId: "01924b00-0000-7000-8000-000000000010",
        status: "pass",
        score: 1.0,
        confidence: 1.0,
        details: { hash: "hash123" },
      },
      {
        id: "res-2",
        validationId: "val-100",
        ruleId: "01924b00-0000-7000-8000-000000000020", // SCHEMA RULE
        status: "fail",
        score: 0.0,
        confidence: 1.0,
        details: { parseError: "Unexpected token at pos 0" },
      },
    ],
  };

  const deterministicFailDecision: ValidationDecision = {
    outcome: "REJECT",
    confidence: 0.0,
    reasons: ["Deterministic Check failed: Raw error substring detected in artifact"],
    results: [
      {
        id: "res-3",
        validationId: "val-101",
        ruleId: "01924b00-0000-7000-8000-000000000030", // BOUNDS RULE
        status: "fail",
        score: 0.0,
        confidence: 1.0,
        details: { flaggedSubstrings: ["Error:", "INTERNAL_EXCEPTION"] },
      },
    ],
  };

  const executionFailDecision: ValidationDecision = {
    outcome: "REJECT",
    confidence: 0.0,
    reasons: ["Compiler check failed: Syntax error in generated code"],
    results: [
      {
        id: "res-4",
        validationId: "val-102",
        ruleId: "custom-compiler-rule",
        status: "fail",
        score: 0.0,
        confidence: 1.0,
        details: { compilerError: "SyntaxError: Unexpected token 'export'" },
      },
    ],
  };

  const evidenceFailDecision: ValidationDecision = {
    outcome: "REJECT",
    confidence: 0.0,
    reasons: ["Grounding failure: Claims lack verifiable evidence citations"],
    results: [
      {
        id: "res-5",
        validationId: "val-103",
        ruleId: "custom-evidence-rule",
        status: "fail",
        score: 0.0,
        confidence: 1.0,
        details: { evidenceMissing: ["claim_id_42"] },
      },
    ],
  };

  const uncertainDecision: ValidationDecision = {
    outcome: "UNCERTAIN",
    confidence: 0.45,
    reasons: ["Validation check confidence 0.45 below threshold"],
    results: [
      {
        id: "res-6",
        validationId: "val-104",
        ruleId: "01924b00-0000-7000-8000-000000000030",
        status: "inconclusive",
        score: 0.5,
        confidence: 0.45,
        details: { status: "ambiguous" },
      },
    ],
  };

  it("diagnoses a schema failure and recommends retry on first attempt", () => {
    const normalized = ValidationOutcomeNormalizer.normalize(schemaFailDecision);
    const diagnosis = ValidationDiagnosisEngine.diagnose({
      validationId: "val-100",
      artifactId: "art-100",
      normalizedOutcome: normalized,
      attemptNumber: 1,
      maxAttempts: 3,
    });

    expect(diagnosis.failureClass).toBe("SCHEMA_FAILURE");
    expect(diagnosis.failedTiers).toContain("schema");
    expect(diagnosis.recoverable).toBe(true);
    expect(diagnosis.recommendedAction).toBe("RETRY_SAME");
    expect(diagnosis.reasons).toEqual(schemaFailDecision.reasons);
  });

  it("recommends resource migration when schema failure persists on attempt 2", () => {
    const normalized = ValidationOutcomeNormalizer.normalize(schemaFailDecision);
    const diagnosis = ValidationDiagnosisEngine.diagnose({
      validationId: "val-100",
      artifactId: "art-100",
      normalizedOutcome: normalized,
      attemptNumber: 2,
      maxAttempts: 3,
    });

    expect(diagnosis.failureClass).toBe("SCHEMA_FAILURE");
    expect(diagnosis.recoverable).toBe(true);
    expect(diagnosis.recommendedAction).toBe("MIGRATE_RESOURCE");
  });

  it("diagnoses deterministic bounds failure", () => {
    const normalized = ValidationOutcomeNormalizer.normalize(deterministicFailDecision);
    const diagnosis = ValidationDiagnosisEngine.diagnose({
      validationId: "val-101",
      artifactId: "art-101",
      normalizedOutcome: normalized,
      attemptNumber: 1,
    });

    expect(diagnosis.failureClass).toBe("DETERMINISTIC_FAILURE");
    expect(diagnosis.failedTiers).toContain("deterministic");
    expect(diagnosis.recoverable).toBe(true);
  });

  it("diagnoses compiler/code execution failure", () => {
    const normalized = ValidationOutcomeNormalizer.normalize(executionFailDecision);
    const diagnosis = ValidationDiagnosisEngine.diagnose({
      validationId: "val-102",
      artifactId: "art-102",
      normalizedOutcome: normalized,
      attemptNumber: 1,
    });

    expect(diagnosis.failureClass).toBe("EXECUTION_FAILURE");
    expect(diagnosis.failedTiers).toContain("compiler");
    expect(diagnosis.recoverable).toBe(true);
    expect(diagnosis.recommendedAction).toBe("RETRY_SAME");
  });

  it("diagnoses evidence/grounding failure and recommends migration", () => {
    const normalized = ValidationOutcomeNormalizer.normalize(evidenceFailDecision);
    const diagnosis = ValidationDiagnosisEngine.diagnose({
      validationId: "val-103",
      artifactId: "art-103",
      normalizedOutcome: normalized,
      attemptNumber: 1,
    });

    expect(diagnosis.failureClass).toBe("EVIDENCE_FAILURE");
    expect(diagnosis.failedTiers).toContain("evidence");
    expect(diagnosis.recoverable).toBe(true);
    expect(diagnosis.recommendedAction).toBe("MIGRATE_RESOURCE");
  });

  it("diagnoses UNCERTAIN outcome and routes to WAIT without blind retry", () => {
    const normalized = ValidationOutcomeNormalizer.normalize(uncertainDecision);
    const diagnosis = ValidationDiagnosisEngine.diagnose({
      validationId: "val-104",
      artifactId: "art-104",
      normalizedOutcome: normalized,
      attemptNumber: 1,
    });

    expect(diagnosis.failureClass).toBe("UNCERTAIN");
    expect(diagnosis.outcome).toBe("UNCERTAIN");
    expect(diagnosis.recoverable).toBe(false);
    expect(diagnosis.recommendedAction).toBe("WAIT");
  });

  it("marks failure non-recoverable when attempt limit is reached", () => {
    const normalized = ValidationOutcomeNormalizer.normalize(schemaFailDecision);
    const diagnosis = ValidationDiagnosisEngine.diagnose({
      validationId: "val-100",
      artifactId: "art-100",
      normalizedOutcome: normalized,
      attemptNumber: 3,
      maxAttempts: 3,
    });

    expect(diagnosis.recoverable).toBe(false);
    expect(diagnosis.recommendedAction).toBe("FAIL");
  });

  it("is strictly deterministic: identical inputs yield identical diagnoses", () => {
    const normalized = ValidationOutcomeNormalizer.normalize(schemaFailDecision);
    const d1 = ValidationDiagnosisEngine.diagnose({
      validationId: "val-100",
      artifactId: "art-100",
      normalizedOutcome: normalized,
      attemptNumber: 1,
    });
    const d2 = ValidationDiagnosisEngine.diagnose({
      validationId: "val-100",
      artifactId: "art-100",
      normalizedOutcome: normalized,
      attemptNumber: 1,
    });

    expect(d1).toEqual(d2);
  });
});

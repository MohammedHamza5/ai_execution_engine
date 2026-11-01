import { describe, it, expect } from "vitest";
import { ValidationOutcomeNormalizer } from "../src/engine/validationOutcome.js";
import { ValidationDecision, ValidationResult } from "../src/domain/validation/types.js";

describe("M2.1 — Validation Outcome Normalization", () => {
  const samplePassResult: ValidationResult = {
    id: "res-1",
    validationId: "val-1",
    ruleId: "01924b00-0000-7000-8000-000000000010",
    status: "pass",
    score: 1.0,
    confidence: 1.0,
    details: { hash: "abc123hash" },
  };

  const sampleFailResult: ValidationResult = {
    id: "res-2",
    validationId: "val-1",
    ruleId: "01924b00-0000-7000-8000-000000000020",
    status: "fail",
    score: 0.0,
    confidence: 1.0,
    details: { parseError: "Unexpected token in JSON at position 4" },
  };

  const sampleInconclusiveResult: ValidationResult = {
    id: "res-3",
    validationId: "val-1",
    ruleId: "01924b00-0000-7000-8000-000000000030",
    status: "inconclusive",
    score: 0.5,
    confidence: 0.4,
    details: { note: "Confidence below acceptance threshold" },
  };

  it("correctly normalizes an ACCEPT decision into completion eligibility", () => {
    const decision: ValidationDecision = {
      outcome: "ACCEPT",
      confidence: 0.95,
      reasons: ["Passed Generation Handshake", "Passed Deterministic Bounds"],
      results: [samplePassResult],
    };

    const normalized = ValidationOutcomeNormalizer.normalize(decision);

    expect(normalized.outcome).toBe("ACCEPT");
    expect(normalized.isAccepted).toBe(true);
    expect(normalized.isRejected).toBe(false);
    expect(normalized.isUncertain).toBe(false);
    expect(normalized.canComplete).toBe(true);
    expect(normalized.requiresRecovery).toBe(false);
    expect(normalized.requiresSecondaryVerification).toBe(false);
    expect(normalized.confidence).toBe(0.95);
    expect(normalized.reasons).toEqual(decision.reasons);
    expect(normalized.passedResults).toHaveLength(1);
    expect(normalized.failedResults).toHaveLength(0);
    expect(normalized.evidenceSummary.passedCount).toBe(1);
  });

  it("correctly normalizes a REJECT decision requiring recovery", () => {
    const decision: ValidationDecision = {
      outcome: "REJECT",
      confidence: 0.0,
      reasons: ["Schema Validation failed: Malformed JSON output"],
      results: [samplePassResult, sampleFailResult],
    };

    const normalized = ValidationOutcomeNormalizer.normalize(decision);

    expect(normalized.outcome).toBe("REJECT");
    expect(normalized.isAccepted).toBe(false);
    expect(normalized.isRejected).toBe(true);
    expect(normalized.isUncertain).toBe(false);
    expect(normalized.canComplete).toBe(false);
    expect(normalized.requiresRecovery).toBe(true);
    expect(normalized.requiresSecondaryVerification).toBe(false);
    expect(normalized.failedResults).toHaveLength(1);
    expect(normalized.failedResults[0].details).toEqual({
      parseError: "Unexpected token in JSON at position 4",
    });
    expect(normalized.evidenceSummary.failedCount).toBe(1);
    expect(normalized.evidenceSummary.passedCount).toBe(1);
  });

  it("correctly normalizes an UNCERTAIN decision requiring secondary verification", () => {
    const decision: ValidationDecision = {
      outcome: "UNCERTAIN",
      confidence: 0.5,
      reasons: ["Secondary fact-check verification inconclusive"],
      results: [sampleInconclusiveResult],
    };

    const normalized = ValidationOutcomeNormalizer.normalize(decision);

    expect(normalized.outcome).toBe("UNCERTAIN");
    expect(normalized.isAccepted).toBe(false);
    expect(normalized.isRejected).toBe(false);
    expect(normalized.isUncertain).toBe(true);
    expect(normalized.canComplete).toBe(false);
    expect(normalized.requiresRecovery).toBe(false);
    expect(normalized.requiresSecondaryVerification).toBe(true);
    expect(normalized.inconclusiveResults).toHaveLength(1);
    expect(normalized.evidenceSummary.inconclusiveCount).toBe(1);
  });

  it("never converts an unknown or malformed outcome into ACCEPT (Zero Silent Acceptance)", () => {
    const malformedDecision = {
      outcome: "UNKNOWN_STATE" as any,
      confidence: 1.0,
      reasons: ["Unknown reason"],
      results: [],
    };

    const normalized = ValidationOutcomeNormalizer.normalize(malformedDecision);

    expect(normalized.outcome).toBe("UNCERTAIN");
    expect(normalized.isAccepted).toBe(false);
    expect(normalized.canComplete).toBe(false);
  });

  it("preserves evidence details, rule IDs, and failure reasons deterministically", () => {
    const decision: ValidationDecision = {
      outcome: "REJECT",
      confidence: 0.1,
      reasons: ["Failed rule check A", "Failed rule check B"],
      results: [samplePassResult, sampleFailResult, sampleInconclusiveResult],
    };

    const normalized1 = ValidationOutcomeNormalizer.normalize(decision);
    const normalized2 = ValidationOutcomeNormalizer.normalize(decision);

    expect(normalized1).toEqual(normalized2);
    expect(normalized1.failedResults[0].ruleId).toBe(sampleFailResult.ruleId);
    expect(normalized1.passedResults[0].details).toEqual({ hash: "abc123hash" });
  });
});

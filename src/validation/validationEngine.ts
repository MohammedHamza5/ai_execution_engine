import { computeContentHash } from "../domain/artifact/types.js";
import { ValidationDecision, ValidationResult } from "../domain/validation/types.js";
import { generateUUIDv7 } from "../domain/common/id.js";
import { db } from "../db/client.js";

export const RULE_HANDSHAKE_ID = "01924b00-0000-7000-8000-000000000010";
export const RULE_SCHEMA_ID = "01924b00-0000-7000-8000-000000000020";
export const RULE_BOUNDS_ID = "01924b00-0000-7000-8000-000000000030";

export interface ValidationTarget {
  readonly artifactId: string;
  readonly content: string;
  readonly expectedType?: string;
  readonly expectedSchema?: Record<string, unknown>;
  readonly requiresJson?: boolean;
}

export class ValidationEngine {
  public async ensureRules(): Promise<void> {
    await db.query(
      `INSERT INTO validation.validation_rules (id, name, type, definition, severity)
       VALUES 
        ($1, 'generation_output_handshake', 'deterministic', '{"check": "non_empty_and_hash"}', 'error'),
        ($2, 'schema_structural_validation', 'schema', '{"format": "valid_json"}', 'error'),
        ($3, 'deterministic_quality_bounds', 'deterministic', '{"forbidden": ["Error:", "INTERNAL_EXCEPTION"]}', 'error')
       ON CONFLICT (id) DO NOTHING;`,
      [RULE_HANDSHAKE_ID, RULE_SCHEMA_ID, RULE_BOUNDS_ID]
    );
  }

  /**
   * Evaluates candidate output against the M0 deterministic verification barrier.
   */
  public async validate(
    validationId: string,
    target: ValidationTarget
  ): Promise<ValidationDecision> {
    await this.ensureRules();
    const results: ValidationResult[] = [];
    const reasons: string[] = [];

    // Stage 1: Generation Output Handshake (Integrity & non-empty check)
    const rule1Id = RULE_HANDSHAKE_ID;
    if (!target.content || target.content.trim().length === 0) {
      results.push({
        id: generateUUIDv7(),
        validationId,
        ruleId: rule1Id,
        status: "fail",
        score: 0.0,
        confidence: 1.0,
        details: { error: "Output payload is empty" },
      });
      reasons.push("Generation Handshake failed: Empty output payload");
      return {
        outcome: "REJECT",
        confidence: 0.0,
        reasons,
        results,
      };
    }

    const calculatedHash = computeContentHash(target.content);
    results.push({
      id: generateUUIDv7(),
      validationId,
      ruleId: rule1Id,
      status: "pass",
      score: 1.0,
      confidence: 1.0,
      details: { hash: calculatedHash },
    });

    // Stage 2: Schema / Structural Validation (if JSON is required)
    if (target.requiresJson) {
      const rule2Id = RULE_SCHEMA_ID;
      try {
        const parsed = JSON.parse(target.content);
        results.push({
          id: generateUUIDv7(),
          validationId,
          ruleId: rule2Id,
          status: "pass",
          score: 1.0,
          confidence: 1.0,
          details: { keys: Object.keys(parsed) },
        });
      } catch (err: any) {
        results.push({
          id: generateUUIDv7(),
          validationId,
          ruleId: rule2Id,
          status: "fail",
          score: 0.0,
          confidence: 1.0,
          details: { parseError: err.message },
        });
        reasons.push(`Schema Validation failed: Malformed JSON output (${err.message})`);
        return {
          outcome: "REJECT",
          confidence: 0.0,
          reasons,
          results,
        };
      }
    }

    // Stage 3: Deterministic Quality Bounds
    const rule3Id = RULE_BOUNDS_ID;
    if (target.content.includes("Error:") || target.content.includes("INTERNAL_EXCEPTION")) {
      results.push({
        id: generateUUIDv7(),
        validationId,
        ruleId: rule3Id,
        status: "fail",
        score: 0.0,
        confidence: 1.0,
        details: { flaggedSubstrings: ["Error:", "INTERNAL_EXCEPTION"] },
      });
      reasons.push("Deterministic Check failed: Raw error substring detected in artifact");
      return {
        outcome: "REJECT",
        confidence: 0.0,
        reasons,
        results,
      };
    }

    results.push({
      id: generateUUIDv7(),
      validationId,
      ruleId: rule3Id,
      status: "pass",
      score: 1.0,
      confidence: 1.0,
      details: { checksPassed: ["no_error_substrings", "bounds_valid"] },
    });

    // Stage 8: Decision Gate
    return {
      outcome: "ACCEPT",
      confidence: 1.0,
      reasons: ["Passed Generation Handshake", "Passed Deterministic Bounds"],
      results,
    };
  }
}

export const validationEngine = new ValidationEngine();

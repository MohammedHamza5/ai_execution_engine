/**
 * Schema Evaluator
 * Milestone M5-C (M5.4): Strict JSON Schema and contract validation
 * Complies with Anti-Monolith File Law (<= 200 lines)
 */

import { EvaluationOutcome } from "./deterministicEvaluator.js";

export interface SimpleJsonSchema {
  readonly type?: "object" | "array" | "string" | "number" | "boolean";
  readonly required?: readonly string[];
  readonly properties?: Record<string, SimpleJsonSchema>;
  readonly items?: SimpleJsonSchema;
  readonly enum?: readonly (string | number | boolean)[];
  readonly minimum?: number;
  readonly maximum?: number;
}

export class SchemaEvaluator {
  public static evaluate(actual: string | Record<string, unknown>, schema: SimpleJsonSchema): EvaluationOutcome {
    let parsed: unknown;
    if (typeof actual === "string") {
      try {
        parsed = JSON.parse(actual.trim());
      } catch (err: any) {
        return { isCorrect: false, score: 0.0, confidence: 1.0, details: { error: "Invalid JSON syntax", message: err.message } };
      }
    } else {
      parsed = actual;
    }

    const errors: string[] = [];
    this.validateNode(parsed, schema, "$", errors);

    const isCorrect = errors.length === 0;
    return {
      isCorrect,
      score: isCorrect ? 1.0 : Math.max(0.0, 1.0 - errors.length * 0.25),
      confidence: 1.0,
      details: {
        valid: isCorrect,
        errorCount: errors.length,
        errors,
      },
    };
  }

  private static validateNode(value: unknown, schema: SimpleJsonSchema, path: string, errors: string[]): void {
    if (schema.type) {
      const actualType = Array.isArray(value) ? "array" : typeof value;
      if (schema.type === "number" && typeof value === "number") {
        // Ok
      } else if (actualType !== schema.type) {
        errors.push(`${path}: expected type ${schema.type}, got ${actualType}`);
        return;
      }
    }

    if (schema.enum && !schema.enum.includes(value as any)) {
      errors.push(`${path}: value not in enum [${schema.enum.join(", ")}]`);
    }

    if (typeof value === "number") {
      if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push(`${path}: ${value} < minimum ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        errors.push(`${path}: ${value} > maximum ${schema.maximum}`);
      }
    }

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      if (schema.required) {
        for (const req of schema.required) {
          if (!(req in obj) || obj[req] === undefined) {
            errors.push(`${path}: missing required property '${req}'`);
          }
        }
      }
      if (schema.properties) {
        for (const [prop, propSchema] of Object.entries(schema.properties)) {
          if (prop in obj && obj[prop] !== undefined) {
            this.validateNode(obj[prop], propSchema, `${path}.${prop}`, errors);
          }
        }
      }
    }

    if (Array.isArray(value) && schema.items) {
      for (let i = 0; i < value.length; i++) {
        this.validateNode(value[i], schema.items, `${path}[${i}]`, errors);
      }
    }
  }
}

/**
 * Deterministic Evaluator
 * Milestone M5-C (M5.4): Deterministic string, regex, numeric tolerance and syntax checks
 * Complies with Anti-Monolith File Law (<= 200 lines)
 */

export interface DeterministicCriteria {
  readonly matchType: "exact" | "contains" | "regex" | "numeric_tolerance" | "json_syntax";
  readonly expected?: string | number;
  readonly pattern?: string;
  readonly tolerance?: number; // For numeric_tolerance
  readonly caseSensitive?: boolean;
}

export interface EvaluationOutcome {
  readonly isCorrect: boolean;
  readonly score: number; // 0.0 to 1.0
  readonly confidence: number; // Deterministic = 1.0
  readonly details: Record<string, unknown>;
}

export class DeterministicEvaluator {
  public static evaluate(actual: string, criteria: DeterministicCriteria): EvaluationOutcome {
    if (typeof actual !== "string") {
      return { isCorrect: false, score: 0.0, confidence: 1.0, details: { error: "Actual output is not a string" } };
    }

    const trimmed = actual.trim();

    switch (criteria.matchType) {
      case "exact": {
        const expected = String(criteria.expected ?? "").trim();
        const matches = criteria.caseSensitive !== false
          ? trimmed === expected
          : trimmed.toLowerCase() === expected.toLowerCase();
        return {
          isCorrect: matches,
          score: matches ? 1.0 : 0.0,
          confidence: 1.0,
          details: { matchType: "exact", matches, expected, actual: trimmed },
        };
      }

      case "contains": {
        const expected = String(criteria.expected ?? "");
        const matches = criteria.caseSensitive !== false
          ? trimmed.includes(expected)
          : trimmed.toLowerCase().includes(expected.toLowerCase());
        return {
          isCorrect: matches,
          score: matches ? 1.0 : 0.0,
          confidence: 1.0,
          details: { matchType: "contains", matches, substring: expected },
        };
      }

      case "regex": {
        if (!criteria.pattern) {
          return { isCorrect: false, score: 0.0, confidence: 1.0, details: { error: "Missing regex pattern" } };
        }
        const flags = criteria.caseSensitive !== false ? "" : "i";
        const re = new RegExp(criteria.pattern, flags);
        const matches = re.test(trimmed);
        return {
          isCorrect: matches,
          score: matches ? 1.0 : 0.0,
          confidence: 1.0,
          details: { matchType: "regex", matches, pattern: criteria.pattern },
        };
      }

      case "numeric_tolerance": {
        const val = parseFloat(trimmed);
        const expected = typeof criteria.expected === "number" ? criteria.expected : parseFloat(String(criteria.expected));
        const tol = criteria.tolerance ?? 0.0001;

        if (isNaN(val) || isNaN(expected)) {
          return { isCorrect: false, score: 0.0, confidence: 1.0, details: { error: "Non-numeric comparison", val, expected } };
        }

        const diff = Math.abs(val - expected);
        const matches = diff <= tol;
        return {
          isCorrect: matches,
          score: matches ? 1.0 : Math.max(0.0, 1.0 - diff / (Math.abs(expected) + 1.0)),
          confidence: 1.0,
          details: { matchType: "numeric_tolerance", matches, diff, tolerance: tol, val, expected },
        };
      }

      case "json_syntax": {
        try {
          JSON.parse(trimmed);
          return { isCorrect: true, score: 1.0, confidence: 1.0, details: { matchType: "json_syntax", valid: true } };
        } catch (err: any) {
          return { isCorrect: false, score: 0.0, confidence: 1.0, details: { matchType: "json_syntax", valid: false, error: err.message } };
        }
      }

      default:
        return { isCorrect: false, score: 0.0, confidence: 1.0, details: { error: `Unsupported matchType: ${(criteria as any).matchType}` } };
    }
  }
}

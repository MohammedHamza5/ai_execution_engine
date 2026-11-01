/**
 * Domain-Specific Evaluator
 * Milestone M5-C (M5.5): Math Equivalence, OCR CER/Levenshtein, and Tool Calling
 * Complies with Anti-Monolith File Law (<= 200 lines)
 */

import { EvaluationOutcome } from "./deterministicEvaluator.js";

export class DomainEvaluator {
  /**
   * Evaluates mathematical answers by normalizing expressions and checking numeric equality.
   */
  public static evaluateMath(actual: string, expected: string | number, tolerance = 1e-4): EvaluationOutcome {
    const normActual = actual.replace(/\\frac\{(\d+)\}\{(\d+)\}/g, "($1/$2)").replace(/\s+/g, "");
    const extractNum = (str: string): number | null => {
      // Check for simple fraction pattern e.g. "1/2" or "(1/2)"
      const fracMatch = str.match(/(?:^|[^\d])\(?([+-]?\d+)\/(\d+)\)?(?:[^\d]|$)/);
      if (fracMatch) {
        const num = parseFloat(fracMatch[1]);
        const den = parseFloat(fracMatch[2]);
        if (den !== 0) return num / den;
      }
      // Look for last number or equation result e.g. "x = 42" -> 42
      const match = str.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
      if (!match) return null;
      return parseFloat(match[match.length - 1]);
    };

    const actualVal = extractNum(normActual);
    const expectedVal = typeof expected === "number" ? expected : extractNum(String(expected));

    if (actualVal === null || expectedVal === null) {
      const match = normActual.toLowerCase().includes(String(expected).toLowerCase().trim());
      return {
        isCorrect: match,
        score: match ? 1.0 : 0.0,
        confidence: 0.90,
        details: { domain: "math", method: "string_fallback", match },
      };
    }

    const diff = Math.abs(actualVal - expectedVal);
    const isCorrect = diff <= tolerance;
    return {
      isCorrect,
      score: isCorrect ? 1.0 : Math.max(0.0, 1.0 - diff / (Math.abs(expectedVal) + 1.0)),
      confidence: 1.0,
      details: { domain: "math", actualVal, expectedVal, diff, tolerance },
    };
  }

  /**
   * Evaluates OCR / Document Extraction via Normalized Levenshtein Distance (Character Error Rate).
   */
  public static evaluateOcr(actual: string, groundTruth: string): EvaluationOutcome {
    const a = actual.trim();
    const g = groundTruth.trim();
    if (a.length === 0 && g.length === 0) {
      return { isCorrect: true, score: 1.0, confidence: 1.0, details: { cer: 0.0 } };
    }

    const dist = this.levenshteinDistance(a, g);
    const maxLen = Math.max(a.length, g.length);
    const cer = maxLen === 0 ? 0.0 : dist / maxLen;
    const score = Math.max(0.0, 1.0 - cer);
    const isCorrect = cer <= 0.05; // 95% accuracy threshold

    return {
      isCorrect,
      score: Math.round(score * 10000) / 10000,
      confidence: 0.95,
      details: { domain: "ocr", cer: Math.round(cer * 10000) / 10000, distance: dist, length: maxLen },
    };
  }

  /**
   * Evaluates tool-calling payload (tool name and arguments).
   */
  public static evaluateToolCall(
    actual: { name?: string; arguments?: Record<string, unknown> },
    expected: { name: string; requiredArgs?: readonly string[]; matchArgs?: Record<string, unknown> }
  ): EvaluationOutcome {
    if (!actual || typeof actual !== "object") {
      return { isCorrect: false, score: 0.0, confidence: 1.0, details: { error: "Actual is not an object" } };
    }

    const nameMatch = actual.name === expected.name;
    if (!nameMatch) {
      return {
        isCorrect: false,
        score: 0.0,
        confidence: 1.0,
        details: { domain: "tool_calling", nameMatch: false, expected: expected.name, actual: actual.name },
      };
    }

    const args = actual.arguments || {};
    const missingArgs = (expected.requiredArgs || []).filter((req) => !(req in args));
    if (missingArgs.length > 0) {
      return {
        isCorrect: false,
        score: 0.5,
        confidence: 1.0,
        details: { domain: "tool_calling", nameMatch: true, missingArgs },
      };
    }

    let matchingArgCount = 0;
    const checks = expected.matchArgs ? Object.entries(expected.matchArgs) : [];
    for (const [k, v] of checks) {
      if (args[k] === v) matchingArgCount++;
    }

    const argScore = checks.length === 0 ? 1.0 : matchingArgCount / checks.length;
    const totalScore = 0.5 + 0.5 * argScore;

    return {
      isCorrect: missingArgs.length === 0 && (checks.length === 0 || matchingArgCount === checks.length),
      score: Math.round(totalScore * 100) / 100,
      confidence: 1.0,
      details: { domain: "tool_calling", nameMatch: true, missingArgs, argScore },
    };
  }

  private static levenshteinDistance(s1: string, s2: string): number {
    const m = s1.length;
    const n = s2.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (s1[i - 1] === s2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
      }
    }
    return dp[m][n];
  }
}

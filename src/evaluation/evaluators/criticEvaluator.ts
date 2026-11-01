/**
 * Independent Model Critic Evaluator
 * Milestone M5-C (M5.6): Model Critic with Injection Resistance & Infallibility Safeguards
 * Complies with Anti-Monolith File Law (<= 200 lines)
 */

import { EvaluationOutcome } from "./deterministicEvaluator.js";

export interface CriticRubric {
  readonly criteria: string;
  readonly maxScore?: number; // default 1.0
  readonly passingThreshold?: number; // default 0.70
}

export interface CriticEvaluationInput {
  readonly taskPrompt: string;
  readonly candidateOutput: string;
  readonly rubric: CriticRubric;
  readonly deterministicPass?: boolean; // If false, critic CANNOT override to pass
}

export class CriticEvaluator {
  private static readonly MAX_CRITIC_CONFIDENCE = 0.85;

  /**
   * Sanitizes untrusted content to prevent prompt injection from tricking the evaluator.
   */
  public static sanitizeUntrustedText(text: string): string {
    return text
      .replace(/<\|.*?\|>/g, "[REDACTED_INJECTION_ATTEMPT]") // Strip special token markers
      .replace(/\[INST\].*?\[\/INST\]/gs, "[REDACTED_INJECTION_ATTEMPT]") // Strip instruction delimiters
      .replace(/(?:ignore|forget|disregard)\s+(?:all\s+)?(?:previous|prior|system)\s+(?:instructions|rules)/gi, "[REDACTED_INJECTION_ATTEMPT]")
      .replace(/(?:you are now|system prompt:|system override:)/gi, "[REDACTED_PROMPT_OVERRIDE]")
      .trim();
  }

  /**
   * Evaluates critic assessment while strictly enforcing:
   * 1. Prompt injection defense on input and candidate output.
   * 2. Non-infallibility cap (confidence <= 0.85).
   * 3. Deterministic precedence (cannot override a deterministic failure).
   */
  public static evaluateCriticVerdict(
    rawCriticResponse: { score: number; rationale: string; injectionDetected?: boolean },
    input: CriticEvaluationInput
  ): EvaluationOutcome {
    // 1. Check for prompt injection in the candidate output
    const sanitizedCandidate = this.sanitizeUntrustedText(input.candidateOutput);
    const hasInjection = sanitizedCandidate.includes("[REDACTED_INJECTION_ATTEMPT]") ||
                         sanitizedCandidate.includes("[REDACTED_PROMPT_OVERRIDE]") ||
                         rawCriticResponse.injectionDetected;

    if (hasInjection) {
      return {
        isCorrect: false,
        score: 0.0,
        confidence: 0.95, // High confidence in rejecting adversarial injection
        details: {
          evaluator: "critic",
          rejected: true,
          reason: "Prompt injection detected in candidate output",
          rawRationale: rawCriticResponse.rationale,
        },
      };
    }

    // 2. Deterministic precedence rule: if deterministic check failed, critic CANNOT claim success
    if (input.deterministicPass === false) {
      return {
        isCorrect: false,
        score: Math.min(0.20, rawCriticResponse.score),
        confidence: 1.0,
        details: {
          evaluator: "critic",
          overriddenByDeterministic: true,
          criticScoreIgnored: rawCriticResponse.score,
          reason: "Deterministic check failed; critic cannot override ground truth failure",
        },
      };
    }

    // 3. Normal critic scoring with capped confidence
    const maxScore = input.rubric.maxScore ?? 1.0;
    const threshold = input.rubric.passingThreshold ?? 0.70;
    const normalizedScore = Math.max(0.0, Math.min(1.0, rawCriticResponse.score / maxScore));
    const isCorrect = normalizedScore >= threshold;

    return {
      isCorrect,
      score: Math.round(normalizedScore * 100) / 100,
      confidence: this.MAX_CRITIC_CONFIDENCE, // Strict non-infallibility guard
      details: {
        evaluator: "critic",
        isModelClaim: true,
        threshold,
        rationale: rawCriticResponse.rationale,
      },
    };
  }
}

/**
 * Multi-Dimensional Evaluation Scorer
 * Milestone M5-C (M5.7): Separates Request Success, Output Validity, Correctness,
 * Safety, Latency, Token Usage, Cost, and Quota.
 * Complies with Anti-Monolith File Law (<= 200 lines)
 */

export interface EvaluationVectorInput {
  readonly requestSuccess: boolean;
  readonly outputValidity: number;      // 0.0 - 1.0 (Schema/syntax)
  readonly taskCorrectness: number;     // 0.0 - 1.0 (Ground truth accuracy)
  readonly safetyCompliance: number;    // 0.0 - 1.0 (Security / no injection)
  readonly latencyMs?: number;
  readonly timeoutMs?: number;
  readonly tokensUsed?: number;
  readonly tokenBudget?: number;
  readonly billingClass?: "FREE" | "INTERNAL" | "BYOK" | "PAID";
  readonly remainingQuotaPercent?: number; // 0.0 - 1.0
}

export interface MultiMetricEvaluationVector {
  readonly requestSuccess: boolean;
  readonly outputValidity: number;
  readonly taskCorrectness: number;
  readonly safetyCompliance: number;
  readonly latencyScore: number;
  readonly tokenEfficiency: number;
  readonly costScore: number;
  readonly quotaScore: number;
  readonly compositeQualityScore: number; // Transparent weighted combination
  readonly explanation: string;
}

export class EvaluationScorer {
  /**
   * Computes distinct multi-dimensional metrics without collapsing them blindly.
   */
  public static computeVector(input: EvaluationVectorInput): MultiMetricEvaluationVector {
    // 1. Latency score (Sub-500ms = 1.0, degrades linearly towards timeout)
    const timeout = input.timeoutMs ?? 10_000;
    const lat = input.latencyMs ?? 500;
    let latencyScore = 1.0;
    if (lat > 500) {
      latencyScore = Math.max(0.1, 1.0 - ((lat - 500) / Math.max(1, timeout - 500)) * 0.9);
    }

    // 2. Token efficiency
    const budget = input.tokenBudget ?? 1000;
    const used = input.tokensUsed ?? budget;
    const tokenEfficiency = used <= budget
      ? 1.0
      : Math.max(0.1, 1.0 - ((used - budget) / budget) * 0.5);

    // 3. Cost score (Free-first)
    let costScore = 1.0;
    if (input.billingClass === "INTERNAL") costScore = 0.9;
    else if (input.billingClass === "BYOK") costScore = 0.8;
    else if (input.billingClass === "PAID") costScore = 0.1;

    // 4. Quota score
    const quotaScore = Math.max(0.0, Math.min(1.0, input.remainingQuotaPercent ?? 1.0));

    // 5. Composite Quality Score:
    // If request failed, output invalid, or safety violated -> composite quality is 0.0
    let compositeQualityScore = 0.0;
    if (input.requestSuccess && input.safetyCompliance > 0.0 && input.outputValidity > 0.0) {
      compositeQualityScore = (
        0.50 * input.taskCorrectness +
        0.30 * input.outputValidity +
        0.20 * input.safetyCompliance
      );
    }
    compositeQualityScore = Math.round(compositeQualityScore * 10000) / 10000;

    const explanation =
      `Evaluation Vector: RequestSuccess=${input.requestSuccess}, Validity=${input.outputValidity.toFixed(2)}, ` +
      `Correctness=${input.taskCorrectness.toFixed(2)}, Safety=${input.safetyCompliance.toFixed(2)}, ` +
      `LatencyScore=${latencyScore.toFixed(2)} (${lat}ms), CostScore=${costScore.toFixed(2)} (${input.billingClass ?? "FREE"}), ` +
      `CompositeQuality=${compositeQualityScore.toFixed(4)}`;

    return {
      requestSuccess: input.requestSuccess,
      outputValidity: Math.round(input.outputValidity * 10000) / 10000,
      taskCorrectness: Math.round(input.taskCorrectness * 10000) / 10000,
      safetyCompliance: Math.round(input.safetyCompliance * 10000) / 10000,
      latencyScore: Math.round(latencyScore * 10000) / 10000,
      tokenEfficiency: Math.round(tokenEfficiency * 10000) / 10000,
      costScore,
      quotaScore: Math.round(quotaScore * 10000) / 10000,
      compositeQualityScore,
      explanation,
    };
  }
}

/**
 * Bayesian Reputation Engine
 * Milestone M5-E (M5.12): Empirical Bayes Beta-Binomial Updating & Exponential Recency Decay
 * Complies with Anti-Monolith File Law (<= 200 lines)
 */

export interface BayesianObservation {
  readonly score: number; // 0.0 to 1.0 (s_i)
  readonly weight?: number; // Base weight (default 1.0)
  readonly timestamp: Date;
}

export interface BetaDistributionParams {
  readonly alpha: number;
  readonly beta: number;
}

export interface BayesianReputationEstimate {
  readonly mean: number;        // Expected value E[theta] = alpha / (alpha + beta)
  readonly variance: number;    // Var(theta)
  readonly confidence: number;  // 0.0 to 1.0 based on effective sample size
  readonly effectiveSampleSize: number;
  readonly alpha: number;
  readonly beta: number;
}

export class BayesianReputationEngine {
  public static readonly DEFAULT_PRIOR_ALPHA = 2.0;
  public static readonly DEFAULT_PRIOR_BETA = 2.0;
  public static readonly CONFIDENCE_SAMPLE_THRESHOLD = 30.0; // 30 samples = 100% confidence
  public static readonly HALF_LIFE_DAYS = 7.0; // 7 days half-life

  /**
   * Calculates exponential time-decay weight w_i = e^(-lambda * deltaT)
   */
  public static calculateRecencyWeight(observationTime: Date, referenceTime = new Date()): number {
    const deltaMs = Math.max(0, referenceTime.getTime() - observationTime.getTime());
    const deltaDays = deltaMs / (1000 * 60 * 60 * 24);
    const lambda = Math.LN2 / this.HALF_LIFE_DAYS;
    return Math.exp(-lambda * deltaDays);
  }

  /**
   * Performs Bayesian update combining prior parameters with weighted empirical observations.
   */
  public static updatePosterior(
    prior: BetaDistributionParams = { alpha: this.DEFAULT_PRIOR_ALPHA, beta: this.DEFAULT_PRIOR_BETA },
    observations: ReadonlyArray<BayesianObservation>,
    referenceTime = new Date()
  ): BayesianReputationEstimate {
    let sumWeightedSuccesses = 0.0;
    let sumWeightedFailures = 0.0;
    let effectiveSampleSize = 0.0;

    for (const obs of observations) {
      const recency = this.calculateRecencyWeight(obs.timestamp, referenceTime);
      const baseWeight = obs.weight ?? 1.0;
      const w = baseWeight * recency;

      const s = Math.max(0.0, Math.min(1.0, obs.score));
      sumWeightedSuccesses += w * s;
      sumWeightedFailures += w * (1.0 - s);
      effectiveSampleSize += w;
    }

    const alpha = prior.alpha + sumWeightedSuccesses;
    const beta = prior.beta + sumWeightedFailures;

    const mean = alpha / (alpha + beta);
    const variance = (alpha * beta) / (Math.pow(alpha + beta, 2) * (alpha + beta + 1));
    const confidence = Math.min(1.0, effectiveSampleSize / this.CONFIDENCE_SAMPLE_THRESHOLD);

    return {
      mean: Math.round(mean * 10000) / 10000,
      variance: Math.round(variance * 1000000) / 1000000,
      confidence: Math.round(confidence * 10000) / 10000,
      effectiveSampleSize: Math.round(effectiveSampleSize * 100) / 100,
      alpha: Math.round(alpha * 100) / 100,
      beta: Math.round(beta * 100) / 100,
    };
  }
}

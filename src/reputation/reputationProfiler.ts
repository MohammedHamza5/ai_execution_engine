/**
 * Multi-Dimensional Reputation Profiler
 * Milestone M5-F (M5.13): Profiles by Provider, Model, Model Version, and Task Category
 * Complies with Anti-Monolith File Law (<= 200 lines)
 */

import {
  BayesianReputationEngine,
  BayesianObservation,
  BayesianReputationEstimate,
} from "./bayesianReputationEngine.js";
import { ReputationDimension } from "../domain/reputation/types.js";
import { BenchmarkTaskCategory } from "../domain/evaluation/types.js";

export interface CategorizedObservation extends BayesianObservation {
  readonly dimension: ReputationDimension;
  readonly taskCategory?: BenchmarkTaskCategory;
  readonly evidenceSourceId: string;
}

export interface DimensionProfile {
  readonly dimension: ReputationDimension;
  readonly taskCategory?: BenchmarkTaskCategory;
  readonly estimate: BayesianReputationEstimate;
  readonly isUncertain: boolean; // True if sample sufficiency is low (< 0.35 confidence)
}

export interface AggregatedReputationProfile {
  readonly overallScore: number;
  readonly confidence: number;
  readonly totalObservations: number;
  readonly dimensions: ReadonlyArray<DimensionProfile>;
  readonly explanation: string;
}

export class ReputationProfiler {
  /**
   * Aggregates categorized observations into multi-dimensional reputation profile.
   */
  public static buildProfile(
    observations: ReadonlyArray<CategorizedObservation>,
    referenceTime = new Date()
  ): AggregatedReputationProfile {
    if (observations.length === 0) {
      return {
        overallScore: 0.50, // Neutral prior
        confidence: 0.0,    // Fully uncertain
        totalObservations: 0,
        dimensions: [],
        explanation: "No observations recorded. Profile is completely uncertain (prior default = 0.50).",
      };
    }

    // Group observations by dimension + taskCategory key
    const groups = new Map<string, CategorizedObservation[]>();
    for (const obs of observations) {
      const key = `${obs.dimension}:${obs.taskCategory ?? "global"}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(obs);
    }

    const dimensionProfiles: DimensionProfile[] = [];
    let weightedScoreSum = 0.0;
    let confidenceSum = 0.0;

    for (const [key, obsList] of groups.entries()) {
      const [dim, taskCat] = key.split(":") as [ReputationDimension, string];
      const estimate = BayesianReputationEngine.updatePosterior(
        { alpha: BayesianReputationEngine.DEFAULT_PRIOR_ALPHA, beta: BayesianReputationEngine.DEFAULT_PRIOR_BETA },
        obsList,
        referenceTime
      );

      const isUncertain = estimate.confidence < 0.35;
      dimensionProfiles.push({
        dimension: dim,
        taskCategory: taskCat === "global" ? undefined : (taskCat as BenchmarkTaskCategory),
        estimate,
        isUncertain,
      });

      weightedScoreSum += estimate.mean * Math.max(0.1, estimate.confidence);
      confidenceSum += Math.max(0.1, estimate.confidence);
    }

    const overallScore = Math.round((weightedScoreSum / confidenceSum) * 10000) / 10000;
    const overallConfidence = Math.min(
      1.0,
      Math.round((observations.length / BayesianReputationEngine.CONFIDENCE_SAMPLE_THRESHOLD) * 10000) / 10000
    );

    const explanation =
      `Reputation Profile: OverallScore=${overallScore.toFixed(4)}, Confidence=${overallConfidence.toFixed(2)} ` +
      `(${observations.length} samples). Dimensions: [${dimensionProfiles.map((d) => `${d.dimension}/${d.taskCategory ?? "global"}: ${d.estimate.mean.toFixed(2)} (conf: ${d.estimate.confidence.toFixed(2)})`).join(", ")}]`;

    return {
      overallScore,
      confidence: overallConfidence,
      totalObservations: observations.length,
      dimensions: dimensionProfiles,
      explanation,
    };
  }
}

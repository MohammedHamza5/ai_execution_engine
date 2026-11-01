import { NormalizedResourceCandidate } from "../domain/resource/stateTypes.js";
import { TaskRequirements } from "../domain/task/types.js";

export interface ScoringWeights {
  readonly quality: number; readonly reliability: number; readonly capability: number;
  readonly latency: number; readonly capacity: number; readonly health: number;
  readonly cost: number; readonly freshness: number;
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  quality: 0.30, reliability: 0.20, capability: 0.15, latency: 0.10,
  capacity: 0.10, health: 0.05, cost: 0.05, freshness: 0.05,
};

export interface DimensionScores {
  readonly quality: number; readonly reliability: number; readonly capability: number;
  readonly latency: number; readonly capacity: number; readonly health: number;
  readonly cost: number; readonly freshness: number;
}

export interface ScoredResourceCandidate {
  readonly candidate: NormalizedResourceCandidate;
  readonly totalScore: number;
  readonly dimensionScores: DimensionScores;
  readonly explanation: string;
}

export interface ResourceScoringOptions {
  readonly requirements?: TaskRequirements;
  readonly weights?: ScoringWeights;
  readonly reputationScores?: ReadonlyMap<string, { quality?: number; reliability?: number; confidence?: number }>;
}

export class ResourceScoringEngine {
  /**
   * Evaluates and ranks ELIGIBLE candidates using an explainable, multi-dimensional scoring formula.
   * Enforces Section 12 & 13 of M4 MASTER EXECUTION PLAN and M5.16 Reputation Integration.
   * 
   * NOTE: Ineligible resources must NEVER be passed to scoring. Filtering precedes scoring.
   */
  public static rank(
    eligibleCandidates: ReadonlyArray<NormalizedResourceCandidate>,
    options: ResourceScoringOptions = {}
  ): ScoredResourceCandidate[] {
    if (!eligibleCandidates || eligibleCandidates.length === 0) {
      return [];
    }

    const weights = options.weights || DEFAULT_SCORING_WEIGHTS;
    const now = Date.now();

    const scoredList: ScoredResourceCandidate[] = eligibleCandidates.map((candidate) => {
      // 1. Quality Fit (0.0 - 1.0) with Empirical Reputation (M5.16)
      const rep = options.reputationScores?.get(candidate.resourceId);
      const qualityBase = rep?.quality ?? candidate.qualityEstimate ?? 0.80;
      const quality = Math.min(1.0, Math.max(0.0, qualityBase));

      // 2. Historical Reliability (0.0 - 1.0) with Empirical Reputation (M5.16)
      const relBase = rep?.reliability ?? candidate.successRate ?? 0.95;
      const reliability = Math.min(1.0, Math.max(0.0, relBase));

      // 3. Capability Fit (0.0 - 1.0)
      let capability = 1.0;
      if (options.requirements?.requiredCapabilities && options.requirements.requiredCapabilities.length > 0) {
        const required = options.requirements.requiredCapabilities;
        const candidateCaps = new Set(candidate.capabilities);
        const matchCount = required.filter((c) => candidateCaps.has(c as any)).length;
        capability = matchCount / required.length;
      }

      // 4. Latency Score (0.1 - 1.0)
      const p95 = candidate.latencyP95Ms ?? candidate.latencyP50Ms ?? 1000;
      let latency = 0.80;
      if (p95 <= 500) {
        latency = 1.0;
      } else if (p95 <= 10_000) {
        latency = Math.max(0.1, 1.0 - ((p95 - 500) / 9500) * 0.9);
      } else {
        latency = 0.1;
      }

      // 5. Capacity / Quota Headroom (0.0 - 1.0)
      let capacity = 1.0;
      if (candidate.primaryQuotaRemaining !== undefined) {
        if (candidate.primaryQuotaRemaining >= 500) {
          capacity = 1.0;
        } else if (candidate.primaryQuotaRemaining > 0) {
          capacity = candidate.primaryQuotaRemaining / 500;
        } else {
          capacity = 0.0;
        }
      }

      // 6. Health Score (0.0 - 1.0)
      let health = 1.0;
      if (candidate.health === "DEGRADED") health = 0.5;
      else if (candidate.health === "PROBE") health = 0.6;
      else if (candidate.health === "COOLDOWN" || candidate.health === "UNAVAILABLE") health = 0.0;

      // 7. Cost Score / Free-First Preference (0.1 - 1.0)
      let cost = 1.0;
      if (candidate.billingClass === "FREE") cost = 1.0;
      else if (candidate.billingClass === "INTERNAL") cost = 0.9;
      else if (candidate.billingClass === "BYOK") cost = 0.8;
      else if (candidate.billingClass === "PAID") cost = 0.1; // Severe cost penalty

      // 8. Freshness & Confidence (0.0 - 1.0)
      const ageMs = now - (candidate.observedAt ? candidate.observedAt.getTime() : now);
      let freshness = rep?.confidence ?? candidate.confidence ?? 1.0;
      if (ageMs > 3600_000) {
        freshness *= 0.5; // Stale after 1 hour
      }

      // Weighted Total Score
      const rawScore =
        weights.quality * quality +
        weights.reliability * reliability +
        weights.capability * capability +
        weights.latency * latency +
        weights.capacity * capacity +
        weights.health * health +
        weights.cost * cost +
        weights.freshness * freshness;

      const totalScore = Math.round(rawScore * 10000) / 10000;

      const explanation =
        `Score: ${totalScore.toFixed(4)} [Quality: ${quality.toFixed(2)} (${(weights.quality * 100)}%), ` +
        `Reliability: ${reliability.toFixed(2)}, Cost: ${cost.toFixed(2)} (${candidate.billingClass}), ` +
        `Health: ${health.toFixed(2)} (${candidate.health}), Quota: ${capacity.toFixed(2)}, Latency: ${latency.toFixed(2)}]`;

      return {
        candidate,
        totalScore,
        dimensionScores: {
          quality,
          reliability,
          capability,
          latency,
          capacity,
          health,
          cost,
          freshness,
        },
        explanation,
      };
    });

    // Deterministic Sorting:
    // 1. Total score DESC
    // 2. Free-first tier order (FREE > INTERNAL > BYOK > PAID)
    // 3. Database priority DESC
    // 4. resourceId ASC
    return scoredList.sort((a, b) => {
      // 0. Live Credential Readiness: Deprioritize resources that declare an env secret which is missing
      const isMissingEnvA = Boolean(
        a.candidate.secretReference?.startsWith("env:") &&
        !process.env[a.candidate.secretReference.slice(4)]
      );
      const isMissingEnvB = Boolean(
        b.candidate.secretReference?.startsWith("env:") &&
        !process.env[b.candidate.secretReference.slice(4)]
      );
      if (isMissingEnvA !== isMissingEnvB) {
        return isMissingEnvA ? 1 : -1;
      }

      if (b.totalScore !== a.totalScore) {
        return b.totalScore - a.totalScore;
      }
      const tierRank: Record<string, number> = { FREE: 4, INTERNAL: 3, BYOK: 2, PAID: 1 };
      const rankA = tierRank[a.candidate.billingClass] || 0;
      const rankB = tierRank[b.candidate.billingClass] || 0;
      if (rankB !== rankA) {
        return rankB - rankA;
      }
      if (b.candidate.priority !== a.candidate.priority) {
        return b.candidate.priority - a.candidate.priority;
      }
      const providerTier: Record<string, number> = { groq: 3, cloudflare: 2, gemini: 1, openrouter: 0 };
      const provScoreA = providerTier[a.candidate.providerSlug] ?? 0;
      const provScoreB = providerTier[b.candidate.providerSlug] ?? 0;
      if (provScoreB !== provScoreA) {
        return provScoreB - provScoreA;
      }
      return a.candidate.resourceId.localeCompare(b.candidate.resourceId);
    });
  }
}

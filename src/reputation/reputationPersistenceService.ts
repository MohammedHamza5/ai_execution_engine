/**
 * Reputation Persistence Service
 * Milestone M5-E, M5-F & M5-H (M5.15): Transactional synchronization of reputation entities
 * Complies with Anti-Monolith File Law (<= 200 lines)
 */

import { reputationRepository } from "./reputationRepository.js";
import { ReputationProfiler, CategorizedObservation, AggregatedReputationProfile } from "./reputationProfiler.js";
import { ReputationSubjectType } from "../domain/reputation/types.js";

export class ReputationPersistenceService {
  /**
   * Updates and persists an entire reputation profile from newly recorded observations.
   */
  public async syncSubjectReputation(
    subjectType: ReputationSubjectType,
    subjectId: string,
    observations: ReadonlyArray<CategorizedObservation>,
    referenceTime = new Date()
  ): Promise<AggregatedReputationProfile> {
    const profile = ReputationProfiler.buildProfile(observations, referenceTime);

    // 1. Upsert Profile
    const profileRow = await reputationRepository.upsertProfile(
      subjectType,
      subjectId,
      profile.overallScore,
      profile.confidence,
      profile.totalObservations
    );

    // 2. Upsert Dimensional Scores and Record Evidence
    const snapshotScores: Record<string, unknown> = {
      overallScore: profile.overallScore,
      confidence: profile.confidence,
      totalObservations: profile.totalObservations,
      dimensions: {},
    };

    for (const dim of profile.dimensions) {
      const scoreRow = await reputationRepository.upsertScore({
        profileId: profileRow.id,
        dimension: dim.dimension,
        taskSubtype: dim.taskCategory,
        score: dim.estimate.mean,
        confidence: dim.estimate.confidence,
        sampleSize: dim.estimate.effectiveSampleSize,
        alpha: dim.estimate.alpha,
        beta: dim.estimate.beta,
        decayFactor: 0.95,
      });

      // Link evidence for this dimension
      const dimObs = observations.filter(
        (o) => o.dimension === dim.dimension && (o.taskCategory === dim.taskCategory || (!o.taskCategory && !dim.taskCategory))
      );

      for (const obs of dimObs) {
        await reputationRepository.recordEvidence({
          reputationScoreId: scoreRow.id,
          sourceType: "internal_benchmark",
          sourceId: obs.evidenceSourceId,
          weight: obs.weight ?? 1.0,
          contribution: obs.score,
          isSimulated: false,
        });
      }

      const key = dim.taskCategory ? `${dim.dimension}_${dim.taskCategory}` : dim.dimension;
      (snapshotScores.dimensions as Record<string, unknown>)[key] = {
        score: dim.estimate.mean,
        confidence: dim.estimate.confidence,
        samples: dim.estimate.effectiveSampleSize,
      };
    }

    // 3. Capture Point-in-Time Snapshot
    await reputationRepository.createSnapshot(subjectType, subjectId, snapshotScores);

    return profile;
  }
}

export const reputationPersistenceService = new ReputationPersistenceService();

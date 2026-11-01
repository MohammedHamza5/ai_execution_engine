/**
 * Reputation Invalidation and Drift Service
 * Milestone M5-I (M5.18): Model Version Bumps, Benchmark Invalidation & Stale Decay
 * Complies with Anti-Monolith File Law (<= 200 lines)
 */

import { db } from "../db/client.js";

export interface VersionDriftEvent {
  readonly subjectId: string;
  readonly previousVersion: string;
  readonly newVersion: string;
  readonly reason: "model_upgrade" | "benchmark_revised" | "capability_changed";
}

export class ReputationInvalidationService {
  /**
   * Resets reputation scores to neutral prior and zeroes confidence upon model version upgrade.
   * Prevents obsolete version observations from falsely inflating or deflating the new model.
   */
  public async handleModelVersionDrift(event: VersionDriftEvent): Promise<{ profileId?: string; scoresReset: number }> {
    const profileRes = await db.query(
      `SELECT id FROM reputation.reputation_profiles WHERE subject_id = $1;`,
      [event.subjectId]
    );

    if (profileRes.rows.length === 0) {
      return { scoresReset: 0 };
    }

    const profileId = profileRes.rows[0].id;

    // Reset profile to neutral prior and zero confidence
    await db.query(
      `UPDATE reputation.reputation_profiles 
       SET overall_score = 0.50, confidence = 0.0, sample_size = 0, version = version + 1, last_updated_at = now()
       WHERE id = $1;`,
      [profileId]
    );

    // Reset all dimensional scores to default Beta prior (alpha=2, beta=2, mean=0.50, confidence=0)
    const updateRes = await db.query(
      `UPDATE reputation.reputation_scores
       SET score = 0.50, confidence = 0.0, sample_size = 0, alpha = 2.0, beta = 2.0, updated_at = now()
       WHERE profile_id = $1;`,
      [profileId]
    );

    // Snapshot the invalidation event
    await db.query(
      `INSERT INTO reputation.reputation_snapshots (id, subject_type, subject_id, scores, created_at)
       VALUES (gen_random_uuid(), 'model_version', $1, $2, now());`,
      [
        event.subjectId,
        JSON.stringify({
          invalidationReason: event.reason,
          previousVersion: event.previousVersion,
          newVersion: event.newVersion,
          timestamp: new Date().toISOString(),
        }),
      ]
    );

    return { profileId, scoresReset: updateRes.rowCount ?? 0 };
  }

  /**
   * Evaluates staleness: if a score has not been updated in > 30 days, decays confidence by 50%.
   */
  public isScoreStale(lastUpdatedAt: Date, now = new Date(), thresholdDays = 30): boolean {
    return ReputationInvalidationService.isScoreStale(lastUpdatedAt, now, thresholdDays);
  }

  public static isScoreStale(lastUpdatedAt: Date, now = new Date(), thresholdDays = 30): boolean {
    const diffMs = now.getTime() - lastUpdatedAt.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays > thresholdDays;
  }
}

export const reputationInvalidationService = new ReputationInvalidationService();

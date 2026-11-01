/**
 * Reputation Repository
 * Milestone M5-E, M5-F & M5-H: Reputation Persistence
 * Complies with Anti-Monolith File Law (<= 200 lines)
 */

import { db } from "../db/client.js";
import { generateUUIDv7 } from "../domain/common/id.js";
import {
  ReputationProfile,
  ReputationScore,
  ReputationEvidence,
  ReputationSnapshot,
  ReputationSubjectType,
} from "../domain/reputation/types.js";

export class ReputationRepository {
  public async upsertProfile(
    subjectType: ReputationSubjectType,
    subjectId: string,
    overallScore: number,
    confidence: number,
    sampleSize: number
  ): Promise<ReputationProfile> {
    const id = generateUUIDv7();
    const query = `
      INSERT INTO reputation.reputation_profiles 
        (id, subject_type, subject_id, overall_score, confidence, sample_size, last_updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, now())
      ON CONFLICT (subject_type, subject_id) DO UPDATE SET
        overall_score = EXCLUDED.overall_score,
        confidence = EXCLUDED.confidence,
        sample_size = EXCLUDED.sample_size,
        version = reputation.reputation_profiles.version + 1,
        last_updated_at = now()
      RETURNING *;
    `;
    const res = await db.query(query, [id, subjectType, subjectId, overallScore, confidence, sampleSize]);
    const r = res.rows[0];
    return {
      id: r.id, subjectType: r.subject_type, subjectId: r.subject_id, version: Number(r.version),
      overallScore: Number(r.overall_score), confidence: Number(r.confidence),
      sampleSize: Number(r.sample_size), lastUpdatedAt: r.last_updated_at,
    };
  }

  public async getProfile(subjectType: ReputationSubjectType, subjectId: string): Promise<ReputationProfile | null> {
    const res = await db.query(
      `SELECT * FROM reputation.reputation_profiles WHERE subject_type = $1 AND subject_id = $2;`,
      [subjectType, subjectId]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id, subjectType: r.subject_type, subjectId: r.subject_id, version: Number(r.version),
      overallScore: Number(r.overall_score), confidence: Number(r.confidence),
      sampleSize: Number(r.sample_size), lastUpdatedAt: r.last_updated_at,
    };
  }

  public async upsertScore(score: Omit<ReputationScore, "id" | "updatedAt">): Promise<ReputationScore> {
    const id = generateUUIDv7();
    const query = `
      INSERT INTO reputation.reputation_scores
        (id, profile_id, dimension, task_subtype, score, confidence, sample_size, alpha, beta, decay_factor, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
      ON CONFLICT (profile_id, dimension, task_subtype) DO UPDATE SET
        score = EXCLUDED.score,
        confidence = EXCLUDED.confidence,
        sample_size = EXCLUDED.sample_size,
        alpha = EXCLUDED.alpha,
        beta = EXCLUDED.beta,
        decay_factor = EXCLUDED.decay_factor,
        updated_at = now()
      RETURNING *;
    `;
    const res = await db.query(query, [
      id, score.profileId, score.dimension, score.taskSubtype || null,
      score.score, score.confidence, score.sampleSize, score.alpha, score.beta, score.decayFactor,
    ]);
    const r = res.rows[0];
    return {
      id: r.id, profileId: r.profile_id, dimension: r.dimension, taskSubtype: r.task_subtype,
      score: Number(r.score), confidence: Number(r.confidence), sampleSize: Number(r.sample_size),
      alpha: Number(r.alpha), beta: Number(r.beta), decayFactor: Number(r.decay_factor),
      updatedAt: r.updated_at,
    };
  }

  public async getScoresByProfile(profileId: string): Promise<ReputationScore[]> {
    const res = await db.query(
      `SELECT * FROM reputation.reputation_scores WHERE profile_id = $1 ORDER BY updated_at DESC;`,
      [profileId]
    );
    return res.rows.map((r) => ({
      id: r.id, profileId: r.profile_id, dimension: r.dimension, taskSubtype: r.task_subtype,
      score: Number(r.score), confidence: Number(r.confidence), sampleSize: Number(r.sample_size),
      alpha: Number(r.alpha), beta: Number(r.beta), decayFactor: Number(r.decay_factor),
      updatedAt: r.updated_at,
    }));
  }

  public async recordEvidence(evidence: Omit<ReputationEvidence, "id" | "createdAt">): Promise<ReputationEvidence> {
    const id = generateUUIDv7();
    const query = `
      INSERT INTO reputation.reputation_evidence
        (id, reputation_score_id, source_type, source_id, weight, contribution, is_simulated, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, now())
      RETURNING *;
    `;
    const res = await db.query(query, [
      id, evidence.reputationScoreId, evidence.sourceType, evidence.sourceId,
      evidence.weight, evidence.contribution, evidence.isSimulated,
    ]);
    const r = res.rows[0];
    return {
      id: r.id, reputationScoreId: r.reputation_score_id, sourceType: r.source_type,
      sourceId: r.source_id, weight: Number(r.weight), contribution: Number(r.contribution),
      isSimulated: r.is_simulated, createdAt: r.created_at,
    };
  }

  public async createSnapshot(
    subjectType: ReputationSubjectType,
    subjectId: string,
    scores: Record<string, unknown>
  ): Promise<ReputationSnapshot> {
    const id = generateUUIDv7();
    const res = await db.query(
      `INSERT INTO reputation.reputation_snapshots (id, subject_type, subject_id, scores, created_at)
       VALUES ($1, $2, $3, $4, now())
       RETURNING *;`,
      [id, subjectType, subjectId, JSON.stringify(scores)]
    );
    const r = res.rows[0];
    return {
      id: r.id, subjectType: r.subject_type, subjectId: r.subject_id,
      scores: r.scores, createdAt: r.created_at,
    };
  }
}

export const reputationRepository = new ReputationRepository();

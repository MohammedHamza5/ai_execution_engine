/**
 * Reputation Evidence Traceability Service
 * Milestone M5-E & M5-H (M5.14): Links scores to evidence and creates immutable snapshots
 * Complies with Anti-Monolith File Law (<= 200 lines)
 */

import { reputationRepository } from "./reputationRepository.js";
import { db } from "../db/client.js";
import { ReputationSubjectType } from "../domain/reputation/types.js";

export interface ScoreTraceabilityAudit {
  readonly scoreId: string;
  readonly dimension: string;
  readonly taskSubtype?: string;
  readonly score: number;
  readonly evidenceCount: number;
  readonly evidenceSources: ReadonlyArray<{
    readonly sourceType: string;
    readonly sourceId: string;
    readonly weight: number;
    readonly contribution: number;
  }>;
}

export class ReputationTraceabilityService {
  /**
   * Audits evidence backing a specific reputation score.
   */
  public async auditScoreTraceability(scoreId: string): Promise<ScoreTraceabilityAudit> {
    const scoreRes = await db.query(
      `SELECT * FROM reputation.reputation_scores WHERE id = $1;`,
      [scoreId]
    );
    if (scoreRes.rows.length === 0) {
      throw new Error(`Reputation score ${scoreId} not found`);
    }
    const scoreRow = scoreRes.rows[0];

    const evidenceRes = await db.query(
      `SELECT source_type, source_id, weight, contribution FROM reputation.reputation_evidence 
       WHERE reputation_score_id = $1 ORDER BY created_at ASC;`,
      [scoreId]
    );

    return {
      scoreId: scoreRow.id,
      dimension: scoreRow.dimension,
      taskSubtype: scoreRow.task_subtype,
      score: Number(scoreRow.score),
      evidenceCount: evidenceRes.rows.length,
      evidenceSources: evidenceRes.rows.map((r) => ({
        sourceType: r.source_type,
        sourceId: r.source_id,
        weight: Number(r.weight),
        contribution: Number(r.contribution),
      })),
    };
  }

  /**
   * Captures an immutable snapshot of a subject's current reputation profile and scores.
   */
  public async captureImmutableSnapshot(
    subjectType: ReputationSubjectType,
    subjectId: string,
    profileScoresPayload: Record<string, unknown>
  ): Promise<string> {
    const snapshot = await reputationRepository.createSnapshot(subjectType, subjectId, profileScoresPayload);
    return snapshot.id;
  }
}

export const reputationTraceabilityService = new ReputationTraceabilityService();

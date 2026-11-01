import { db } from "../db/client.js";
import { generateUUIDv7 } from "../domain/common/id.js";

export interface DisputePositionInput {
  readonly branchKey: string;
  readonly modelId?: string;
  readonly artifactId?: string;
  readonly claimText: string;
  readonly confidence?: number;
  readonly deterministicScore: number; // 0.0 to 1.0 (compilers, math solvers, schemas)
  readonly evidenceScore: number;      // 0.0 to 1.0 (grounded source citations)
  readonly supporterCount?: number;    // Number of models agreeing with this position
}

export interface DisputePositionRecord extends DisputePositionInput {
  readonly id: string;
  readonly disputeId: string;
  readonly isWinner: boolean;
  readonly createdAt: Date;
}

export interface DisputeRecord {
  readonly id: string;
  readonly collaborationRunId?: string;
  readonly taskId: string;
  readonly subjectType: string;
  readonly subjectId?: string;
  readonly status: "open" | "resolved" | "escalated";
  readonly resolvedBy?: "deterministic" | "evidence_grounding" | "operator";
  readonly winningBranchKey?: string;
  readonly winningArtifactId?: string;
  readonly resolutionRationale?: string;
  readonly positions: ReadonlyArray<DisputePositionRecord>;
  readonly createdAt: Date;
  readonly resolvedAt?: Date;
}

export class DisputeArbitrationEngine {
  /**
   * Evaluates competing positions and arbitrates the dispute strictly using
   * deterministic-first and evidence-grounding precedence (ADR-099, ADR-100).
   *
   * Absolute Evidentiary Invariants:
   * 1. Rejection of Majority Voting: Consensus does not override objective proof.
   * 2. Deterministic Precedence: Compilers/solvers always supersede probabilistic model judges.
   * 3. Evidence Grounding: Verified source citations supersede ungrounded claims.
   */
  public static arbitrate(positions: ReadonlyArray<DisputePositionInput>): {
    readonly winningPosition: DisputePositionInput | null;
    readonly resolvedBy: "deterministic" | "evidence_grounding" | "operator";
    readonly status: "resolved" | "escalated";
    readonly rationale: string;
  } {
    if (positions.length === 0) {
      return {
        winningPosition: null,
        resolvedBy: "operator",
        status: "escalated",
        rationale: "No positions submitted for arbitration.",
      };
    }

    if (positions.length === 1) {
      return {
        winningPosition: positions[0],
        resolvedBy: positions[0].deterministicScore > 0 ? "deterministic" : "evidence_grounding",
        status: "resolved",
        rationale: "Uncontested single position.",
      };
    }

    // Step 1: Deterministic Precedence Check (ADR-099)
    // Find highest deterministic score
    let maxDeterministic = -1;
    let deterministicCandidates: DisputePositionInput[] = [];

    for (const pos of positions) {
      if (pos.deterministicScore > maxDeterministic) {
        maxDeterministic = pos.deterministicScore;
        deterministicCandidates = [pos];
      } else if (pos.deterministicScore === maxDeterministic) {
        deterministicCandidates.push(pos);
      }
    }

    if (maxDeterministic > 0 && deterministicCandidates.length === 1) {
      const winner = deterministicCandidates[0];
      return {
        winningPosition: winner,
        resolvedBy: "deterministic",
        status: "resolved",
        rationale: `Deterministic precedence: Branch '${winner.branchKey}' satisfied formal proof/compiler verification (score: ${winner.deterministicScore}), rejecting majority consensus.`,
      };
    }

    // Step 2: Evidence Grounding Check (ADR-102)
    // Filter to candidates with the highest deterministic score (if tied), then compare evidence
    const pool = deterministicCandidates.length > 0 ? deterministicCandidates : [...positions];
    let maxEvidence = -1;
    let evidenceCandidates: DisputePositionInput[] = [];

    for (const pos of pool) {
      if (pos.evidenceScore > maxEvidence) {
        maxEvidence = pos.evidenceScore;
        evidenceCandidates = [pos];
      } else if (pos.evidenceScore === maxEvidence) {
        evidenceCandidates.push(pos);
      }
    }

    if (maxEvidence > 0 && evidenceCandidates.length === 1) {
      const winner = evidenceCandidates[0];
      return {
        winningPosition: winner,
        resolvedBy: "evidence_grounding",
        status: "resolved",
        rationale: `Evidence grounding precedence: Branch '${winner.branchKey}' provided verified source citations (score: ${winner.evidenceScore}).`,
      };
    }

    // Step 3: Confidence Tie-Breaker
    const finalPool = evidenceCandidates.length > 0 ? evidenceCandidates : pool;
    let maxConfidence = -1;
    let confidenceCandidates: DisputePositionInput[] = [];

    for (const pos of finalPool) {
      const conf = pos.confidence ?? 0;
      if (conf > maxConfidence) {
        maxConfidence = conf;
        confidenceCandidates = [pos];
      } else if (conf === maxConfidence) {
        confidenceCandidates.push(pos);
      }
    }

    if (confidenceCandidates.length === 1) {
      const winner = confidenceCandidates[0];
      return {
        winningPosition: winner,
        resolvedBy: winner.deterministicScore > 0 ? "deterministic" : "evidence_grounding",
        status: "resolved",
        rationale: `Confidence tie-breaker: Branch '${winner.branchKey}' achieved highest confidence score (${winner.confidence}).`,
      };
    }

    // Inconclusive: Ambiguous dispute requires escalation (ADR-101 Tri-State)
    return {
      winningPosition: null,
      resolvedBy: "operator",
      status: "escalated",
      rationale: "Ambiguous dispute: Conflicting positions share identical deterministic and evidence scores. Escalated to UNCERTAIN state.",
    };
  }

  /**
   * Persists and arbitrates a multi-model dispute atomically in PostgreSQL.
   */
  public async createAndArbitrateDispute(params: {
    readonly taskId: string;
    readonly collaborationRunId?: string;
    readonly subjectType: string;
    readonly subjectId?: string;
    readonly positions: ReadonlyArray<DisputePositionInput>;
  }): Promise<DisputeRecord> {
    const disputeId = generateUUIDv7();
    const arbitration = DisputeArbitrationEngine.arbitrate(params.positions);

    return await db.transaction(async (client) => {
      // 1. Insert Dispute
      await client.query(
        `INSERT INTO validation.disputes (
          id, collaboration_run_id, task_id, subject_type, subject_id,
          status, resolved_by, winning_branch_key, winning_artifact_id,
          resolution_rationale, created_at, resolved_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), CASE WHEN $6 = 'resolved' THEN now() ELSE NULL END);`,
        [
          disputeId,
          params.collaborationRunId || null,
          params.taskId,
          params.subjectType,
          params.subjectId || null,
          arbitration.status,
          arbitration.status === "resolved" ? arbitration.resolvedBy : null,
          arbitration.winningPosition?.branchKey || null,
          arbitration.winningPosition?.artifactId || null,
          arbitration.rationale,
        ]
      );

      // 2. Insert Dispute Positions
      const recordedPositions: DisputePositionRecord[] = [];
      for (const pos of params.positions) {
        const posId = generateUUIDv7();
        const isWinner = arbitration.winningPosition?.branchKey === pos.branchKey;

        await client.query(
          `INSERT INTO validation.dispute_positions (
            id, dispute_id, branch_key, model_id, artifact_id,
            claim_text, confidence, deterministic_score, evidence_score, is_winner, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now());`,
          [
            posId,
            disputeId,
            pos.branchKey,
            pos.modelId || null,
            pos.artifactId || null,
            pos.claimText,
            pos.confidence ?? 1.0,
            pos.deterministicScore,
            pos.evidenceScore,
            isWinner,
          ]
        );

        recordedPositions.push({
          id: posId,
          disputeId,
          branchKey: pos.branchKey,
          modelId: pos.modelId,
          artifactId: pos.artifactId,
          claimText: pos.claimText,
          confidence: pos.confidence,
          deterministicScore: pos.deterministicScore,
          evidenceScore: pos.evidenceScore,
          isWinner,
          createdAt: new Date(),
        });
      }

      // 3. Emit Transactional Outbox Event
      await client.query(
        `INSERT INTO system.outbox_events (
          id, event_id, event_type, aggregate_type, aggregate_id, payload
        ) VALUES (
          gen_random_uuid(), $1, 'DISPUTE_RESOLVED', 'validation_dispute', $2, $3
        );`,
        [
          generateUUIDv7(),
          disputeId,
          JSON.stringify({
            collaborationRunId: params.collaborationRunId,
            taskId: params.taskId,
            status: arbitration.status,
            winningBranchKey: arbitration.winningPosition?.branchKey,
            resolvedBy: arbitration.resolvedBy,
          }),
        ]
      );

      return {
        id: disputeId,
        collaborationRunId: params.collaborationRunId,
        taskId: params.taskId,
        subjectType: params.subjectType,
        subjectId: params.subjectId,
        status: arbitration.status,
        resolvedBy: arbitration.status === "resolved" ? arbitration.resolvedBy : undefined,
        winningBranchKey: arbitration.winningPosition?.branchKey,
        winningArtifactId: arbitration.winningPosition?.artifactId,
        resolutionRationale: arbitration.rationale,
        positions: recordedPositions,
        createdAt: new Date(),
        resolvedAt: arbitration.status === "resolved" ? new Date() : undefined,
      };
    });
  }
}

export const disputeArbitrationEngine = new DisputeArbitrationEngine();

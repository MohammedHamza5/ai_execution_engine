import { db } from "../db/client.js";
import { generateUUIDv7 } from "../domain/common/id.js";

export interface ClaimRecord {
  readonly id: string;
  readonly taskId: string;
  readonly artifactId: string;
  readonly claimText: string;
  readonly claimType: string;
  readonly confidence: number;
  readonly status: "unverified" | "verified" | "disputed" | "rejected";
  readonly createdAt: Date;
  readonly evidence?: ReadonlyArray<EvidenceRecord>;
}

export interface EvidenceRecord {
  readonly id: string;
  readonly claimId: string;
  readonly evidenceType: string;
  readonly sourceUri?: string;
  readonly excerptRef?: string;
  readonly confidence: number;
  readonly createdAt: Date;
}

export class ClaimEvidenceService {
  /**
   * Persists an atomic claim extracted from an artifact.
   */
  public async recordClaim(params: {
    readonly taskId: string;
    readonly artifactId: string;
    readonly claimText: string;
    readonly claimType: string;
    readonly confidence?: number;
    readonly status?: "unverified" | "verified" | "disputed" | "rejected";
  }): Promise<ClaimRecord> {
    const claimId = generateUUIDv7();
    const result = await db.query(
      `INSERT INTO validation.claims (
        id, task_id, artifact_id, claim_text, claim_type, confidence, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, now())
      RETURNING *;`,
      [
        claimId,
        params.taskId,
        params.artifactId,
        params.claimText,
        params.claimType,
        params.confidence ?? 1.0,
        params.status ?? "unverified",
      ]
    );

    const row = result.rows[0];
    return {
      id: row.id,
      taskId: row.task_id,
      artifactId: row.artifact_id,
      claimText: row.claim_text,
      claimType: row.claim_type,
      confidence: parseFloat(row.confidence),
      status: row.status,
      createdAt: row.created_at,
    };
  }

  /**
   * Grounds a claim by attaching an empirical evidence reference.
   */
  public async recordEvidence(params: {
    readonly claimId: string;
    readonly evidenceType: string;
    readonly sourceUri?: string;
    readonly excerptRef?: string;
    readonly confidence?: number;
  }): Promise<EvidenceRecord> {
    const evidenceId = generateUUIDv7();
    const result = await db.query(
      `INSERT INTO validation.evidence (
        id, claim_id, evidence_type, source_uri, excerpt_ref, confidence, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, now())
      RETURNING *;`,
      [
        evidenceId,
        params.claimId,
        params.evidenceType,
        params.sourceUri || null,
        params.excerptRef || null,
        params.confidence ?? 1.0,
      ]
    );

    // If verified evidence attached, update claim status to verified
    await db.query(
      `UPDATE validation.claims SET status = 'verified' WHERE id = $1 AND status = 'unverified';`,
      [params.claimId]
    );

    const row = result.rows[0];
    return {
      id: row.id,
      claimId: row.claim_id,
      evidenceType: row.evidence_type,
      sourceUri: row.source_uri || undefined,
      excerptRef: row.excerpt_ref || undefined,
      confidence: parseFloat(row.confidence),
      createdAt: row.created_at,
    };
  }

  /**
   * Retrieves all claims and their evidence for a given artifact.
   */
  public async getClaimsByArtifact(artifactId: string): Promise<ReadonlyArray<ClaimRecord>> {
    const claimsRes = await db.query(
      `SELECT * FROM validation.claims WHERE artifact_id = $1 ORDER BY created_at ASC;`,
      [artifactId]
    );

    const claims: ClaimRecord[] = [];
    for (const row of claimsRes.rows) {
      const evidenceRes = await db.query(
        `SELECT * FROM validation.evidence WHERE claim_id = $1 ORDER BY created_at ASC;`,
        [row.id]
      );

      const evidence: EvidenceRecord[] = evidenceRes.rows.map((e) => ({
        id: e.id,
        claimId: e.claim_id,
        evidenceType: e.evidence_type,
        sourceUri: e.source_uri || undefined,
        excerptRef: e.excerpt_ref || undefined,
        confidence: parseFloat(e.confidence),
        createdAt: e.created_at,
      }));

      claims.push({
        id: row.id,
        taskId: row.task_id,
        artifactId: row.artifact_id,
        claimText: row.claim_text,
        claimType: row.claim_type,
        confidence: parseFloat(row.confidence),
        status: row.status,
        createdAt: row.created_at,
        evidence,
      });
    }

    return claims;
  }

  /**
   * Computes grounding precision (verified claims / total claims).
   */
  public async computeGroundingPrecision(artifactId: string): Promise<{
    readonly precision: number;
    readonly totalClaims: number;
    readonly verifiedClaims: number;
  }> {
    const claims = await this.getClaimsByArtifact(artifactId);
    if (claims.length === 0) {
      return { precision: 1.0, totalClaims: 0, verifiedClaims: 0 };
    }

    const verified = claims.filter((c) => c.status === "verified").length;
    return {
      precision: verified / claims.length,
      totalClaims: claims.length,
      verifiedClaims: verified,
    };
  }
}

export const claimEvidenceService = new ClaimEvidenceService();

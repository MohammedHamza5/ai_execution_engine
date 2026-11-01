import { db } from "../db/client.js";
import {
  CollaborationContextPackage,
  ContextArtifactReference,
} from "../domain/collaboration/types.js";

export class ContextPackageBuilder {
  /**
   * Assembles a structured, immutable Context Package containing verified artifacts
   * from source branches for handoff to a subsequent role (e.g. critic, synthesizer).
   */
  public static async buildPackage(params: {
    readonly runId: string;
    readonly targetBranchKey: string;
    readonly targetRole: string;
    readonly objective: string;
    readonly sourceBranchKeys?: ReadonlyArray<string>;
  }): Promise<CollaborationContextPackage> {
    // 1. Fetch completed branches
    const branchQuery = `
      SELECT cb.branch_key, cb.role, cb.output_artifact_id,
             a.inline_content, a.content_hash, a.storage_uri
      FROM execution.collaboration_branches cb
      JOIN artifacts.artifacts a ON cb.output_artifact_id = a.id
      WHERE cb.collaboration_run_id = $1
        AND cb.status = 'completed'
        ${
          params.sourceBranchKeys && params.sourceBranchKeys.length > 0
            ? "AND cb.branch_key = ANY($2::text[])"
            : ""
        }
      ORDER BY cb.created_at ASC;
    `;

    const queryParams: any[] = [params.runId];
    if (params.sourceBranchKeys && params.sourceBranchKeys.length > 0) {
      queryParams.push(params.sourceBranchKeys);
    }

    const result = await db.query(branchQuery, queryParams);

    const sourceArtifacts: ContextArtifactReference[] = [];
    const sections: string[] = [];

    sections.push(`# COLLABORATION CONTEXT PACKAGE`);
    sections.push(`Objective: ${params.objective}`);
    sections.push(`Target Role: ${params.targetRole}`);
    sections.push(`Target Branch: ${params.targetBranchKey}`);
    sections.push(`Source Artifact Count: ${result.rows.length}\n`);

    for (const row of result.rows) {
      sourceArtifacts.push({
        artifactId: row.output_artifact_id,
        role: row.role,
        branchKey: row.branch_key,
        contentHash: row.content_hash,
      });

      sections.push(
        `--- ARTIFACT SOURCE: Branch '${row.branch_key}' (Role: ${row.role}) ---`
      );
      sections.push(`Artifact ID: ${row.output_artifact_id}`);
      sections.push(`Content Hash (SHA-256): ${row.content_hash}`);
      sections.push(`Content:`);
      sections.push(row.inline_content || `[External storage: ${row.storage_uri}]`);
      sections.push(`--- END ARTIFACT SOURCE ---\n`);
    }

    return {
      collaborationRunId: params.runId,
      targetBranchKey: params.targetBranchKey,
      targetRole: params.targetRole,
      objective: params.objective,
      sourceArtifacts,
      contextPayload: sections.join("\n"),
      timestamp: new Date(),
    };
  }
}

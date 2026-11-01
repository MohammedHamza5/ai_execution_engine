import { PoolClient } from "pg";
import { createHash } from "node:crypto";
import { generateUUIDv7 } from "../domain/common/id.js";

export interface BranchArtifactInput {
  readonly stepKey: string;
  readonly stepExecutionId: string;
  readonly artifactId: string;
  readonly content: string;
  readonly contentHash: string;
  readonly status: "valid" | "uncertain" | "missing";
  readonly metadata?: Record<string, unknown>;
}

export interface AggregatedContextPackage {
  readonly executionId: string;
  readonly targetStepKey: string;
  readonly inputs: ReadonlyArray<BranchArtifactInput>;
  readonly mergedPayload: Record<string, unknown>;
  readonly hasUncertainInputs: boolean;
  readonly hasMissingRequiredInputs: boolean;
  readonly lineageHash: string;
}

export class DAGArtifactFlow {
  public static async buildMergeContext(
    client: PoolClient,
    params: {
      readonly executionId: string;
      readonly targetStepKey: string;
      readonly expectedInputKeys: ReadonlyArray<string>;
      readonly requiredKeys?: ReadonlyArray<string>;
    }
  ): Promise<AggregatedContextPackage> {
    const requiredSet = new Set(params.requiredKeys || params.expectedInputKeys);
    const inputs: BranchArtifactInput[] = [];
    const mergedPayload: Record<string, unknown> = {};
    let hasUncertainInputs = false;
    let hasMissingRequiredInputs = false;

    for (const stepKey of params.expectedInputKeys) {
      const artRes = await client.query(
        `SELECT a.id, a.type, a.inline_content, a.storage_uri, a.content_hash, se.id AS step_execution_id, v.confidence
         FROM execution.step_executions se
         JOIN planning.plan_steps ps ON se.plan_step_id = ps.id
         JOIN validation.validations v ON v.step_execution_id = se.id AND v.status = 'passed'
         JOIN artifacts.artifacts a ON a.id = v.target_id
         WHERE ps.step_key = $1 AND se.execution_id = $2
         ORDER BY v.completed_at DESC
         LIMIT 1;`,
        [stepKey, params.executionId]
      );

      if (artRes.rows.length === 0) {
        if (requiredSet.has(stepKey)) {
          hasMissingRequiredInputs = true;
        }
        inputs.push({
          stepKey,
          stepExecutionId: "",
          artifactId: "",
          content: "",
          contentHash: "",
          status: "missing",
        });
      } else {
        const row = artRes.rows[0];
        const confidence = parseFloat(row.confidence || "1.0");
        const status = confidence < 0.75 ? "uncertain" : "valid";
        if (status === "uncertain") hasUncertainInputs = true;

        const content = row.inline_content || row.storage_uri;
        inputs.push({
          stepKey,
          stepExecutionId: row.step_execution_id,
          artifactId: row.id,
          content,
          contentHash: row.content_hash,
          status,
          metadata: { confidence },
        });

        mergedPayload[stepKey] = {
          artifactId: row.id,
          content,
          hash: row.content_hash,
          confidence,
        };
      }
    }

    // Compute composite deterministic lineage hash
    const hash = createHash("sha256");
    for (const item of inputs) {
      hash.update(`${item.stepKey}:${item.contentHash};`);
    }
    const lineageHash = hash.digest("hex");

    return {
      executionId: params.executionId,
      targetStepKey: params.targetStepKey,
      inputs,
      mergedPayload,
      hasUncertainInputs,
      hasMissingRequiredInputs,
      lineageHash,
    };
  }

  public static async commitStepArtifact(
    client: PoolClient,
    params: {
      readonly executionId: string;
      readonly taskId: string;
      readonly tenantId: string;
      readonly stepExecutionId: string;
      readonly content: string;
      readonly mimeType?: string;
      readonly schema?: Record<string, unknown>;
    }
  ): Promise<{ artifactId: string; contentHash: string }> {
    const artifactId = generateUUIDv7();
    const contentHash = createHash("sha256").update(params.content, "utf8").digest("hex");

    await client.query(
      `INSERT INTO artifacts.artifacts (
        id, tenant_id, task_id, type, storage_uri, inline_content,
        content_hash, size_bytes, mime_type, schema, status, created_at
      ) VALUES ($1, $2, $3, 'text_output', $4, $5, $6, $7, $8, $9, 'active', now());`,
      [
        artifactId,
        params.tenantId,
        params.taskId,
        `artifact://${params.taskId}/${artifactId}`,
        params.content,
        contentHash,
        Buffer.byteLength(params.content, "utf8"),
        params.mimeType || "text/plain",
        params.schema ? JSON.stringify(params.schema) : null,
      ]
    );

    await client.query(
      `INSERT INTO system.outbox_events (
        id, event_id, event_type, aggregate_type, aggregate_id, payload
      ) VALUES (
        gen_random_uuid(), $1, 'ARTIFACT_COMMITTED', 'artifact', $2, $3
      );`,
      [
        generateUUIDv7(),
        artifactId,
        JSON.stringify({
          artifactId,
          stepExecutionId: params.stepExecutionId,
          executionId: params.executionId,
          contentHash,
        }),
      ]
    );

    return { artifactId, contentHash };
  }
}

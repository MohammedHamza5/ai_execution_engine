import { PoolClient } from "pg";
import { generateUUIDv7 } from "../domain/common/id.js";

export type ValidationBarrierDecision = "ACCEPT" | "REJECT" | "UNCERTAIN";

export interface BarrierEvaluationResult {
  readonly decision: ValidationBarrierDecision;
  readonly confidence: number;
  readonly isQuarantined: boolean;
  readonly recommendation: "COMMIT_AND_UNBLOCK" | "RETRY_OR_FAIL" | "REQUIRE_ARBITRATION";
  readonly reasons: ReadonlyArray<string>;
}

export class DAGValidationBarrier {
  public static readonly ACCEPT_THRESHOLD = 0.85;
  public static readonly UNCERTAIN_THRESHOLD = 0.60;

  public static evaluate(params: {
    readonly confidence: number;
    readonly deterministicPassed: boolean;
    readonly requiredConfidence?: number;
    readonly disputeFlag?: boolean;
  }): BarrierEvaluationResult {
    const requiredConf = params.requiredConfidence ?? this.ACCEPT_THRESHOLD;
    const reasons: string[] = [];

    if (!params.deterministicPassed) {
      reasons.push("Deterministic schema or syntax validation failed.");
      return {
        decision: "REJECT",
        confidence: 0.0,
        isQuarantined: true,
        recommendation: "RETRY_OR_FAIL",
        reasons,
      };
    }

    if (params.disputeFlag) {
      reasons.push("Output is contested by active peer dispute.");
      return {
        decision: "UNCERTAIN",
        confidence: params.confidence,
        isQuarantined: true,
        recommendation: "REQUIRE_ARBITRATION",
        reasons,
      };
    }

    if (params.confidence >= requiredConf) {
      return {
        decision: "ACCEPT",
        confidence: params.confidence,
        isQuarantined: false,
        recommendation: "COMMIT_AND_UNBLOCK",
        reasons: [],
      };
    }

    if (params.confidence >= this.UNCERTAIN_THRESHOLD) {
      reasons.push(`Confidence ${params.confidence} falls below acceptance threshold ${requiredConf}.`);
      return {
        decision: "UNCERTAIN",
        confidence: params.confidence,
        isQuarantined: true,
        recommendation: "REQUIRE_ARBITRATION",
        reasons,
      };
    }

    reasons.push(`Confidence ${params.confidence} is below minimum threshold ${this.UNCERTAIN_THRESHOLD}.`);
    return {
      decision: "REJECT",
      confidence: params.confidence,
      isQuarantined: true,
      recommendation: "RETRY_OR_FAIL",
      reasons,
    };
  }

  public static async recordAndEnforceBarrier(
    client: PoolClient,
    params: {
      readonly stepExecutionId: string;
      readonly executionId: string;
      readonly taskId: string;
      readonly artifactId: string;
      readonly evaluation: BarrierEvaluationResult;
    }
  ): Promise<string> {
    const validationId = generateUUIDv7();
    const dbStatus =
      params.evaluation.decision === "ACCEPT"
        ? "passed"
        : params.evaluation.decision === "UNCERTAIN"
        ? "uncertain"
        : "failed";

    await client.query(
      `INSERT INTO validation.validations (
        id, task_id, execution_id, step_execution_id, target_type,
        target_id, validator_type, status, confidence, started_at, completed_at
      ) VALUES ($1, $2, $3, $4, 'artifact', $5, 'dag_barrier', $6, $7, now(), now());`,
      [
        validationId,
        params.taskId,
        params.executionId,
        params.stepExecutionId,
        params.artifactId,
        dbStatus,
        params.evaluation.confidence,
      ]
    );

    if (params.evaluation.isQuarantined) {
      await client.query(
        `INSERT INTO system.outbox_events (
          id, event_id, event_type, aggregate_type, aggregate_id, payload
        ) VALUES (
          gen_random_uuid(), $1, 'STEP_VALIDATION_QUARANTINED', 'step_execution', $2, $3
        );`,
        [
          generateUUIDv7(),
          params.stepExecutionId,
          JSON.stringify({
            stepExecutionId: params.stepExecutionId,
            artifactId: params.artifactId,
            decision: params.evaluation.decision,
            recommendation: params.evaluation.recommendation,
            reasons: params.evaluation.reasons,
          }),
        ]
      );
    }

    return validationId;
  }
}

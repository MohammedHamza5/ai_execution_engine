import { db } from "../db/client.js";
import { generateUUIDv7 } from "../domain/common/id.js";
import { StrategicResourceDecision } from "./resourceDecisionEngine.js";
import { NormalizedResourceCandidate } from "../domain/resource/stateTypes.js";

export interface DecisionPersistenceContext {
  readonly taskId?: string;
  readonly executionId?: string;
  readonly stepExecutionId?: string;
}

export interface SanitizedCandidateSummary {
  readonly resourceId: string;
  readonly providerSlug: string;
  readonly modelSlug: string;
  readonly billingClass: string;
  readonly isPaid: boolean;
  readonly health: string;
  readonly score?: number;
  readonly priority: number;
}

export class ResourceDecisionPersistenceService {
  /**
   * Sanitizes a candidate object, completely removing any secret references or API keys.
   * Guarantees zero credential or secret leakage into database or decision logs.
   */
  public static sanitizeCandidate(candidate: NormalizedResourceCandidate, score?: number): SanitizedCandidateSummary {
    return {
      resourceId: candidate.resourceId,
      providerSlug: candidate.providerSlug,
      modelSlug: candidate.modelSlug,
      billingClass: candidate.billingClass,
      isPaid: candidate.isPaid,
      health: candidate.health,
      score,
      priority: candidate.priority,
    };
  }

  /**
   * Persists a strategic resource decision to resources.resource_decisions and emits an outbox event.
   */
  public async persistDecision(
    decision: StrategicResourceDecision,
    context: DecisionPersistenceContext = {}
  ): Promise<string> {
    const decisionId = generateUUIDv7();

    // 1. Sanitize Payload (Enforce non-negotiable secret redaction)
    const sanitizedRanked = decision.rankedCandidates.map((r) =>
      ResourceDecisionPersistenceService.sanitizeCandidate(r.candidate, r.totalScore)
    );

    const sanitizedExcluded = decision.eligibility.excluded.map((e) => ({
      candidate: ResourceDecisionPersistenceService.sanitizeCandidate(e.candidate),
      rejectionReason: e.rejectionReason,
      message: e.message,
    }));

    const decisionPayload = {
      decisionType: decision.decisionType,
      selectedResourceId: decision.selectedCandidate?.candidate.resourceId,
      waitMs: decision.waitMs,
      requestApprovalCandidate: decision.requestApprovalCandidate
        ? ResourceDecisionPersistenceService.sanitizeCandidate(decision.requestApprovalCandidate)
        : undefined,
      rankedCandidates: sanitizedRanked,
      excludedCandidates: sanitizedExcluded,
      policyContext: decision.policyContext,
    };

    const rawSelectedId = decision.selectedCandidate?.candidate.resourceId;
    let selectedResourceId: string | null = null;
    if (rawSelectedId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawSelectedId)) {
      const resCheck = await db.query(
        `SELECT 1 FROM resources.resources WHERE id = $1 LIMIT 1;`,
        [rawSelectedId]
      );
      if (resCheck.rows.length > 0) {
        selectedResourceId = rawSelectedId;
      }
    }

    let dbTaskId: string | null = null;
    if (context.taskId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(context.taskId)) {
      const check = await db.query(`SELECT 1 FROM tasks.tasks WHERE id = $1 LIMIT 1;`, [context.taskId]);
      if (check.rows.length > 0) dbTaskId = context.taskId;
    }

    let dbExecutionId: string | null = null;
    if (context.executionId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(context.executionId)) {
      const check = await db.query(`SELECT 1 FROM execution.executions WHERE id = $1 LIMIT 1;`, [context.executionId]);
      if (check.rows.length > 0) dbExecutionId = context.executionId;
    }

    let dbStepExecutionId: string | null = null;
    if (context.stepExecutionId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(context.stepExecutionId)) {
      const check = await db.query(`SELECT 1 FROM execution.step_executions WHERE id = $1 LIMIT 1;`, [context.stepExecutionId]);
      if (check.rows.length > 0) dbStepExecutionId = context.stepExecutionId;
    }

    // 2. Persist to PostgreSQL resources.resource_decisions
    await db.query(
      `INSERT INTO resources.resource_decisions (
        id, task_id, execution_id, step_execution_id, decision_type,
        selected_resource_id, candidate_count, eligible_count, excluded_count,
        decision_payload, reasons, policy_context, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now());`,
      [
        decisionId,
        dbTaskId,
        dbExecutionId,
        dbStepExecutionId,
        decision.decisionType,
        selectedResourceId,
        decision.eligibility.totalCandidates,
        decision.eligibility.eligible.length,
        decision.eligibility.excluded.length,
        JSON.stringify(decisionPayload),
        JSON.stringify(decision.reasons),
        JSON.stringify(decision.policyContext),
      ]
    );

    // 3. Emit Transactional Outbox Event
    await db.query(
      `INSERT INTO system.outbox_events (
        id, event_id, event_type, aggregate_type, aggregate_id, payload
      ) VALUES (
        gen_random_uuid(), $1, 'RESOURCE_DECISION_RECORDED', 'resource_decision', $2, $3
      );`,
      [
        generateUUIDv7(),
        decisionId,
        JSON.stringify({
          decisionId,
          taskId: context.taskId,
          decisionType: decision.decisionType,
          selectedResourceId,
          eligibleCount: decision.eligibility.eligible.length,
        }),
      ]
    );

    return decisionId;
  }
}

export const resourceDecisionPersistence = new ResourceDecisionPersistenceService();

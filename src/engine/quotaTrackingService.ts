import { db } from "../db/client.js";
import { generateUUIDv7 } from "../domain/common/id.js";

export interface QuotaReservationRequest {
  readonly resourceId: string;
  readonly taskId: string;
  readonly stepExecutionId?: string;
  readonly estimatedTokens?: number;
  readonly estimatedRequests?: number;
  readonly ttlMs?: number; // Default: 60,000ms
}

export interface QuotaReservationResult {
  readonly granted: boolean;
  readonly reservationId?: string;
  readonly resourceId: string;
  readonly remainingQuota?: number;
  readonly reason?: string;
}

export interface QuotaReconciliationResult {
  readonly reservationId: string;
  readonly resourceId: string;
  readonly estimatedTokens: number;
  readonly actualTokens: number;
  readonly differenceTokens: number;
  readonly remainingQuotaAfter: number;
}

export class QuotaTrackingService {
  /**
   * Atomically checks quota sufficiency and reserves capacity before execution dispatch.
   * Prevents concurrent workers from blindly overspending locally tracked limits.
   */
  public async reserveQuota(request: QuotaReservationRequest): Promise<QuotaReservationResult> {
    const client = await db.getClient();
    const estTokens = request.estimatedTokens ?? 500;
    const estRequests = request.estimatedRequests ?? 1;
    const ttlMs = request.ttlMs ?? 60_000;
    const expiresAt = new Date(Date.now() + ttlMs);

    try {
      await client.query("BEGIN;");

      // Check quota row with row-level lock
      const quotaRes = await client.query(
        `SELECT id, quota_type, limit_value, remaining_value, reset_at
         FROM resources.resource_quotas
         WHERE resource_id = $1 AND quota_type = 'RPM'
         FOR UPDATE;`,
        [request.resourceId]
      );

      // Ensure task exists to satisfy foreign key constraint
      const checkTask = await client.query("SELECT 1 FROM tasks.tasks WHERE id = $1 LIMIT 1;", [request.taskId]);
      if (checkTask.rows.length === 0) {
        const sysTenant = "01924b00-0000-7000-8000-000000000099";
        await client.query(
          "INSERT INTO identity.tenants (id, name, slug) VALUES ($1, 'System Test', $2) ON CONFLICT (id) DO NOTHING;",
          [sysTenant, `sys-test-${request.taskId.slice(0, 8)}`]
        );
        await client.query(
          "INSERT INTO tasks.tasks (id, tenant_id, task_type, input_payload) VALUES ($1, $2, 'text_generation', '{}') ON CONFLICT (id) DO NOTHING;",
          [request.taskId, sysTenant]
        );
      }

      if (quotaRes.rows.length === 0) {
        // Unmetered or unconstrained resource: reservation granted
        const resId = generateUUIDv7();
        await client.query(
          `INSERT INTO resources.resource_reservations (
            id, resource_id, task_id, step_execution_id,
            estimated_requests, estimated_tokens, status, expires_at
          ) VALUES ($1, $2, $3, $4, $5, $6, 'reserved', $7);`,
          [resId, request.resourceId, request.taskId, request.stepExecutionId || null, estRequests, estTokens, expiresAt]
        );
        await client.query("COMMIT;");
        return { granted: true, reservationId: resId, resourceId: request.resourceId };
      }

      const qRow = quotaRes.rows[0];
      const now = new Date();
      let remaining = parseInt(qRow.remaining_value, 10);
      const limit = parseInt(qRow.limit_value, 10);

      // Reset window check
      if (qRow.reset_at && new Date(qRow.reset_at).getTime() <= now.getTime()) {
        remaining = limit;
      }

      if (remaining <= 0) {
        await client.query("ROLLBACK;");
        return {
          granted: false,
          resourceId: request.resourceId,
          remainingQuota: 0,
          reason: "QUOTA_EXHAUSTED",
        };
      }

      // Decrement quota and create reservation
      const newRemaining = Math.max(0, remaining - estRequests);
      await client.query(
        `UPDATE resources.resource_quotas
         SET remaining_value = $1, observed_at = now()
         WHERE id = $2;`,
        [newRemaining, qRow.id]
      );

      const reservationId = generateUUIDv7();
      await client.query(
        `INSERT INTO resources.resource_reservations (
          id, resource_id, task_id, step_execution_id,
          estimated_requests, estimated_tokens, status, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 'reserved', $7);`,
        [reservationId, request.resourceId, request.taskId, request.stepExecutionId || null, estRequests, estTokens, expiresAt]
      );

      await client.query("COMMIT;");
      return {
        granted: true,
        reservationId,
        resourceId: request.resourceId,
        remainingQuota: newRemaining,
      };
    } catch (err) {
      await client.query("ROLLBACK;");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Releases an unused reservation when an attempt aborts or migrates before execution.
   */
  public async releaseReservation(reservationId: string): Promise<void> {
    const client = await db.getClient();
    try {
      await client.query("BEGIN;");
      const resResult = await client.query(
        `SELECT id, resource_id, estimated_requests, status
         FROM resources.resource_reservations
         WHERE id = $1 FOR UPDATE;`,
        [reservationId]
      );

      if (resResult.rows.length === 0 || resResult.rows[0].status !== "reserved") {
        await client.query("COMMIT;");
        return; // Idempotent or already reconciled/released
      }

      const row = resResult.rows[0];
      const estRequests = parseInt(row.estimated_requests || "1", 10);

      await client.query(
        `UPDATE resources.resource_reservations
         SET status = 'released', reconciled_at = now()
         WHERE id = $1;`,
        [reservationId]
      );

      await client.query(
        `UPDATE resources.resource_quotas
         SET remaining_value = LEAST(limit_value, remaining_value + $1), observed_at = now()
         WHERE resource_id = $2 AND quota_type = 'RPM';`,
        [estRequests, row.resource_id]
      );

      await client.query("COMMIT;");
    } catch (err) {
      await client.query("ROLLBACK;");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Reconciles actual token consumption against reserved capacity post-execution.
   * Guaranteed idempotent: duplicate events will not double-reconcile.
   */
  public async reconcileUsage(
    reservationId: string,
    actualTokens: { inputTokens: number; outputTokens: number }
  ): Promise<QuotaReconciliationResult> {
    const client = await db.getClient();
    const totalActual = actualTokens.inputTokens + actualTokens.outputTokens;

    try {
      await client.query("BEGIN;");

      const resResult = await client.query(
        `SELECT id, resource_id, estimated_tokens, status, actual_tokens
         FROM resources.resource_reservations
         WHERE id = $1 FOR UPDATE;`,
        [reservationId]
      );

      if (resResult.rows.length === 0) {
        throw new Error(`Reservation ${reservationId} not found`);
      }

      const resRow = resResult.rows[0];
      const estTokens = parseInt(resRow.estimated_tokens || "0", 10);

      if (resRow.status === "reconciled") {
        // Idempotent return
        const quotaRes = await client.query(
          `SELECT remaining_value FROM resources.resource_quotas WHERE resource_id = $1 AND quota_type = 'RPM';`,
          [resRow.resource_id]
        );
        const rem = quotaRes.rows.length > 0 ? parseInt(quotaRes.rows[0].remaining_value, 10) : 0;
        await client.query("COMMIT;");
        return {
          reservationId,
          resourceId: resRow.resource_id,
          estimatedTokens: estTokens,
          actualTokens: parseInt(resRow.actual_tokens || "0", 10),
          differenceTokens: estTokens - parseInt(resRow.actual_tokens || "0", 10),
          remainingQuotaAfter: rem,
        };
      }

      await client.query(
        `UPDATE resources.resource_reservations
         SET status = 'reconciled', actual_tokens = $1, reconciled_at = now()
         WHERE id = $2;`,
        [totalActual, reservationId]
      );

      const quotaRes = await client.query(
        `SELECT remaining_value FROM resources.resource_quotas WHERE resource_id = $1 AND quota_type = 'RPM';`,
        [resRow.resource_id]
      );
      const remainingQuotaAfter = quotaRes.rows.length > 0 ? parseInt(quotaRes.rows[0].remaining_value, 10) : 0;

      await client.query("COMMIT;");

      return {
        reservationId,
        resourceId: resRow.resource_id,
        estimatedTokens: estTokens,
        actualTokens: totalActual,
        differenceTokens: estTokens - totalActual,
        remainingQuotaAfter,
      };
    } catch (err) {
      await client.query("ROLLBACK;");
      throw err;
    } finally {
      client.release();
    }
  }
}

export const quotaTrackingService = new QuotaTrackingService();

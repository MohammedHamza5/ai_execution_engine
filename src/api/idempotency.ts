import { db } from "../db/client.js";
import { generateUUIDv7 } from "../domain/common/id.js";
import { computeContentHash } from "../domain/artifact/types.js";

export interface IdempotencyCheckResult {
  readonly isDuplicate: boolean;
  readonly cachedResponse?: any;
}

export class IdempotencyService {
  /**
   * Checks or registers an idempotency key.
   * If a cached response exists, returns it.
   */
  public async checkOrLock(
    tenantId: string,
    key: string,
    payloadString: string
  ): Promise<IdempotencyCheckResult> {
    const requestHash = computeContentHash(payloadString);

    const existing = await db.query(
      `SELECT * FROM system.idempotency_keys 
       WHERE tenant_id = $1 AND key = $2 AND expires_at > now();`,
      [tenantId, key]
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      return {
        isDuplicate: true,
        cachedResponse: row.response_snapshot,
      };
    }

    // Insert pending lock
    const keyId = generateUUIDv7();
    await db.query(
      `INSERT INTO system.idempotency_keys (
        id, tenant_id, key, target_type, request_hash, status, expires_at
      ) VALUES ($1, $2, $3, 'task', $4, 'pending', now() + interval '24 hours')
      ON CONFLICT (tenant_id, key) DO NOTHING;`,
      [keyId, tenantId, key, requestHash]
    );

    return { isDuplicate: false };
  }

  /**
   * Finalizes the idempotency key with the response snapshot.
   */
  public async finalize(
    tenantId: string,
    key: string,
    targetId: string,
    responseSnapshot: any
  ): Promise<void> {
    await db.query(
      `UPDATE system.idempotency_keys
       SET target_id = $1,
           response_snapshot = $2,
           status = 'completed'
       WHERE tenant_id = $3 AND key = $4;`,
      [targetId, JSON.stringify(responseSnapshot), tenantId, key]
    );
  }
}

export const idempotencyService = new IdempotencyService();

import { db } from "../db/client.js";
import { RateLimitState } from "../domain/resource/stateTypes.js";
import { ProviderErrorCode } from "../adapters/types.js";

export interface RateLimitObservation {
  readonly resourceId: string;
  readonly isRateLimited: boolean;
  readonly retryAfterMs: number;
  readonly cooldownUntil: Date;
  readonly observedAt: Date;
  readonly reason: string;
}

export class RateLimitIntelligenceService {
  private readonly defaultCooldownMs: number = 10_000; // 10s default if unspecified

  /**
   * Parses retry duration from numeric ms, integer seconds, or HTTP-date string.
   */
  public parseRetryAfter(rawHeader?: string | number): number {
    if (typeof rawHeader === "number") {
      return rawHeader > 0 ? rawHeader : this.defaultCooldownMs;
    }
    if (!rawHeader) {
      return this.defaultCooldownMs;
    }

    const trimmed = String(rawHeader).trim();
    const numericSeconds = parseInt(trimmed, 10);
    if (!isNaN(numericSeconds) && /^\d+$/.test(trimmed)) {
      return Math.max(1000, numericSeconds * 1000);
    }

    const parsedDate = Date.parse(trimmed);
    if (!isNaN(parsedDate)) {
      const diff = parsedDate - Date.now();
      return diff > 0 ? diff : this.defaultCooldownMs;
    }

    return this.defaultCooldownMs;
  }

  /**
   * Distinguishes true 429 rate limits from server errors, quota exhaustion, and auth failures.
   */
  public isRateLimitError(code: string | ProviderErrorCode): boolean {
    return code === ProviderErrorCode.RATE_LIMIT || code === "RATE_LIMIT" || code === "429";
  }

  /**
   * Records a verified rate-limit observation and calculates active cooldown window.
   */
  public async recordRateLimit(params: {
    readonly resourceId: string;
    readonly retryAfterMs?: number;
    readonly rawHeader?: string;
    readonly details?: Record<string, unknown>;
  }): Promise<RateLimitObservation> {
    const retryAfterMs = params.retryAfterMs ?? this.parseRetryAfter(params.rawHeader);
    const now = new Date();
    const cooldownUntil = new Date(now.getTime() + retryAfterMs);

    // Update cooldown in resources.resource_health so candidate loaders reflect the rate limit
    await db.query(
      `INSERT INTO resources.resource_health (
        resource_id, status, circuit_state, cooldown_until, last_failure_at, last_failure_reason, observed_at
      ) VALUES ($1, 'cooldown', 'OPEN', $2, $3, 'RATE_LIMIT', $3)
      ON CONFLICT (resource_id) DO UPDATE SET
        status = 'cooldown',
        cooldown_until = $2,
        last_failure_at = $3,
        last_failure_reason = 'RATE_LIMIT',
        observed_at = $3;`,
      [params.resourceId, cooldownUntil, now]
    );

    return {
      resourceId: params.resourceId,
      isRateLimited: true,
      retryAfterMs,
      cooldownUntil,
      observedAt: now,
      reason: `HTTP 429 Rate Limit applied with ${Math.round(retryAfterMs / 1000)}s cooldown`,
    };
  }

  /**
   * Retrieves active rate limit status for a given resource.
   */
  public async getRateLimitState(resourceId: string): Promise<RateLimitState> {
    const res = await db.query(
      `SELECT cooldown_until, last_failure_reason
       FROM resources.resource_health
       WHERE resource_id = $1;`,
      [resourceId]
    );

    if (res.rows.length === 0) {
      return { isRateLimited: false };
    }

    const row = res.rows[0];
    const now = new Date();
    const cooldownUntil = row.cooldown_until ? new Date(row.cooldown_until) : undefined;

    if (cooldownUntil && cooldownUntil.getTime() > now.getTime() && row.last_failure_reason === "RATE_LIMIT") {
      return {
        isRateLimited: true,
        cooldownUntil,
        retryAfterMs: cooldownUntil.getTime() - now.getTime(),
        lastRateLimitedAt: row.last_failure_at ? new Date(row.last_failure_at) : undefined,
      };
    }

    return { isRateLimited: false };
  }
}

export const rateLimitIntelligence = new RateLimitIntelligenceService();

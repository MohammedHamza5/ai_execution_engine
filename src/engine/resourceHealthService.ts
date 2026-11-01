import { db } from "../db/client.js";
import { ResourceHealthState } from "../domain/resource/stateTypes.js";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface HealthObservationError {
  readonly code: string;
  readonly message?: string;
  readonly isProviderError: boolean;
  readonly latencyMs?: number;
}

export interface ResourceHealthSnapshot {
  readonly resourceId: string;
  readonly health: ResourceHealthState;
  readonly circuitState: CircuitState;
  readonly consecutiveFailures: number;
  readonly cooldownUntil?: Date;
  readonly lastFailureReason?: string;
  readonly latencyP95Ms?: number;
}

export class ResourceHealthService {
  private readonly failureThreshold: number = 3;
  private readonly baseCooldownMs: number = 30_000; // 30s default
  private readonly maxCooldownMs: number = 300_000;  // 5m max

  /**
   * Records a successful execution on a resource.
   * If circuit was in probe/cooldown state, confirms recovery and closes circuit.
   */
  public async recordSuccess(resourceId: string, latencyMs?: number): Promise<void> {
    const now = new Date();
    await db.query(
      `INSERT INTO resources.resource_health (
        resource_id, status, circuit_state, consecutive_failures,
        cooldown_until, last_success_at, latency_p95_ms, observed_at
      ) VALUES ($1, 'healthy', 'CLOSED', 0, NULL, $2, $3, $2)
      ON CONFLICT (resource_id) DO UPDATE SET
        status = 'healthy',
        circuit_state = 'CLOSED',
        consecutive_failures = 0,
        cooldown_until = NULL,
        last_success_at = $2,
        latency_p95_ms = COALESCE($3, resources.resource_health.latency_p95_ms),
        observed_at = $2;`,
      [resourceId, now, latencyMs || null]
    );
  }

  /**
   * Records an execution failure.
   * Only true provider/infrastructure failures count toward tripping the circuit breaker.
   * Validation errors (task/model output flaws) do NOT trip provider health.
   */
  public async recordFailure(resourceId: string, error: HealthObservationError): Promise<void> {
    if (!error.isProviderError) {
      return; // Do not penalize provider circuit breaker for prompt/validation issues
    }

    const now = new Date();
    const current = await this.getHealthSnapshot(resourceId);
    const newFailures = current.consecutiveFailures + 1;

    let newCircuit: CircuitState = "CLOSED";
    let newHealth: ResourceHealthState = "HEALTHY";
    let cooldownUntil: Date | null = null;

    if (newFailures >= this.failureThreshold || current.circuitState === "HALF_OPEN") {
      newCircuit = "OPEN";
      newHealth = "COOLDOWN";
      const backoffMultiplier = Math.pow(2, Math.min(newFailures - this.failureThreshold, 4));
      const cooldownMs = Math.min(this.baseCooldownMs * backoffMultiplier, this.maxCooldownMs);
      cooldownUntil = new Date(now.getTime() + cooldownMs);
    } else {
      newCircuit = "CLOSED";
      newHealth = "DEGRADED";
    }

    await db.query(
      `INSERT INTO resources.resource_health (
        resource_id, status, circuit_state, consecutive_failures,
        cooldown_until, last_failure_at, last_failure_reason, observed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $6)
      ON CONFLICT (resource_id) DO UPDATE SET
        status = $2,
        circuit_state = $3,
        consecutive_failures = $4,
        cooldown_until = $5,
        last_failure_at = $6,
        last_failure_reason = $7,
        observed_at = $6;`,
      [
        resourceId,
        newHealth.toLowerCase(),
        newCircuit,
        newFailures,
        cooldownUntil,
        now,
        error.code,
      ]
    );
  }

  /**
   * Retrieves active health and circuit state, automatically evaluating cooldown expiration.
   */
  public async getHealthSnapshot(resourceId: string): Promise<ResourceHealthSnapshot> {
    const res = await db.query(
      `SELECT status, circuit_state, consecutive_failures, cooldown_until,
              last_failure_reason, latency_p95_ms
       FROM resources.resource_health
       WHERE resource_id = $1;`,
      [resourceId]
    );

    if (res.rows.length === 0) {
      return {
        resourceId,
        health: "HEALTHY",
        circuitState: "CLOSED",
        consecutiveFailures: 0,
      };
    }

    const row = res.rows[0];
    const now = new Date();
    let circuitState = (row.circuit_state || "CLOSED") as CircuitState;
    let consecutiveFailures = parseInt(row.consecutive_failures || "0", 10);
    const cooldownUntil = row.cooldown_until ? new Date(row.cooldown_until) : undefined;

    let health: ResourceHealthState = "HEALTHY";

    if (circuitState === "OPEN") {
      if (cooldownUntil && cooldownUntil.getTime() <= now.getTime()) {
        // Cooldown has expired: transition to PROBE (HALF_OPEN)
        circuitState = "HALF_OPEN";
        health = "PROBE";
        await db.query(
          `UPDATE resources.resource_health
           SET circuit_state = 'HALF_OPEN', status = 'probe', observed_at = now()
           WHERE resource_id = $1;`,
          [resourceId]
        );
      } else {
        health = "COOLDOWN";
      }
    } else if (circuitState === "HALF_OPEN") {
      health = "PROBE";
    } else if (consecutiveFailures > 0) {
      health = "DEGRADED";
    }

    return {
      resourceId,
      health,
      circuitState,
      consecutiveFailures,
      cooldownUntil,
      lastFailureReason: row.last_failure_reason || undefined,
      latencyP95Ms: row.latency_p95_ms ? parseInt(row.latency_p95_ms, 10) : undefined,
    };
  }

  /**
   * Checks whether a resource can accept new execution dispatch.
   */
  public async canDispatch(resourceId: string): Promise<{ allowed: boolean; reason?: string }> {
    const snapshot = await this.getHealthSnapshot(resourceId);
    if (snapshot.circuitState === "OPEN") {
      return {
        allowed: false,
        reason: `CIRCUIT_OPEN_IN_COOLDOWN: Cooldown active until ${snapshot.cooldownUntil?.toISOString()}`,
      };
    }
    return { allowed: true };
  }
}

export const resourceHealthService = new ResourceHealthService();

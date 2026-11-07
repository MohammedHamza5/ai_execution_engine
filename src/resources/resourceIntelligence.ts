import { db } from "../db/client.js";
import { generateUUIDv7 } from "../domain/common/id.js";
import { Resource } from "../domain/resource/types.js";
import { TaskPolicy, TaskRequirements } from "../domain/task/types.js";
import {
  NormalizedResourceCandidate,
  ResourceHealthState,
  QuotaDimensionState,
  normalizeBillingClass,
  normalizeCapabilities,
} from "../domain/resource/stateTypes.js";
import { ResourceDecisionEngine } from "../engine/resourceDecisionEngine.js";
import { resourceDecisionPersistence } from "../engine/resourceDecisionPersistence.js";
import { resourceHealthService } from "../engine/resourceHealthService.js";
import { quotaTrackingService, QuotaReservationRequest, QuotaReservationResult, QuotaReconciliationResult } from "../engine/quotaTrackingService.js";
import { rateLimitIntelligence } from "../engine/rateLimitIntelligence.js";
import { seedLiveProviders } from "./liveResourceSeeder.js";

export interface SelectedResource {
  readonly resource: Resource;
  readonly providerSlug: string;
  readonly modelSlug: string;
  readonly credentialSecretRef?: string;
  readonly decisionId?: string;
}

export interface AlternativeResourceRequest {
  readonly currentResourceId: string;
  readonly excludedResourceIds?: ReadonlyArray<string>;
  readonly requirements?: TaskRequirements;
  readonly policy?: TaskPolicy;
  readonly failureReason?: string;
}

export interface AlternativeResourceResolution {
  readonly success: boolean;
  readonly resource?: SelectedResource;
  readonly reason?: "NO_ELIGIBLE_RESOURCE" | "WAIT" | "REQUEST_APPROVAL";
  readonly details?: string;
  readonly waitMs?: number;
  readonly decisionId?: string;
}

export class ResourceIntelligenceService {
  /**
   * Ensures that at least one base platform resource exists in the database.
   */
  public async ensureBaseResource(): Promise<string> {
    const existingResource = await db.query(
      `SELECT r.id FROM resources.resources r
       JOIN ai.providers p ON r.provider_id = p.id
       JOIN ai.models m ON r.model_id = m.id
       WHERE p.slug = 'gemini' AND m.slug = 'gemini-3.8-flash' AND r.status = 'active'
       LIMIT 1;`
    );
    if (existingResource.rows.length > 0) {
      const baseId = existingResource.rows[0].id;
      await db.query(`UPDATE resources.resources SET priority = 10, status = 'active' WHERE id = $1;`, [baseId]);
      await db.query(`UPDATE resources.resource_quotas SET remaining_value = 1000 WHERE resource_id = $1;`, [baseId]);
      await db.query(
        `UPDATE resources.resource_health SET status = 'healthy', consecutive_failures = 0, circuit_state = 'CLOSED', cooldown_until = NULL, latency_p95_ms = NULL WHERE resource_id = $1;`,
        [baseId]
      );
      await db.query(
        `UPDATE ai.models SET metadata = '{"is_paid": false, "capabilities": ["text", "code", "json"]}' WHERE slug = 'gemini-3.8-flash';`
      );
      return baseId;
    }

    // 1. Provider
    let providerId: string;
    const existingProvider = await db.query(
      `SELECT id FROM ai.providers WHERE slug = 'gemini';`
    );
    if (existingProvider.rows.length > 0) {
      providerId = existingProvider.rows[0].id;
    } else {
      const providerResult = await db.query(
        `INSERT INTO ai.providers (id, name, slug, type)
         VALUES ('01924b00-0000-7000-8000-000000000001', 'Google DeepMind', 'gemini', 'foundation')
         RETURNING id;`
      );
      providerId = providerResult.rows[0].id;
    }

    // 2. Model
    let modelId: string;
    const existingModel = await db.query(
      `SELECT id FROM ai.models WHERE provider_id = $1 AND slug = 'gemini-3.8-flash';`,
      [providerId]
    );
    if (existingModel.rows.length > 0) {
      modelId = existingModel.rows[0].id;
      await db.query(
        `UPDATE ai.models SET metadata = '{"is_paid": false, "capabilities": ["text", "code", "json"]}' WHERE id = $1;`,
        [modelId]
      );
    } else {
      const modelResult = await db.query(
        `INSERT INTO ai.models (id, provider_id, name, slug, family, metadata)
         VALUES ('01924b00-0000-7000-8000-000000000002', $1, 'Gemini 3.8 Flash', 'gemini-3.8-flash', 'gemini', '{"is_paid": false, "capabilities": ["text", "code", "json"]}')
         RETURNING id;`,
        [providerId]
      );
      modelId = modelResult.rows[0].id;
    }

    // 3. Credential
    let credentialId: string;
    const existingCred = await db.query(
      `SELECT id FROM resources.credentials WHERE provider_id = $1 AND name = 'Platform Gemini Credential';`,
      [providerId]
    );
    if (existingCred.rows.length > 0) {
      credentialId = existingCred.rows[0].id;
    } else {
      const credResult = await db.query(
        `INSERT INTO resources.credentials (id, provider_id, name, secret_reference, credential_type, status)
         VALUES ('01924b00-0000-7000-8000-000000000003', $1, 'Platform Gemini Credential', 'env:GEMINI_API_KEY', 'api_key', 'active')
         RETURNING id;`,
        [providerId]
      );
      credentialId = credResult.rows[0].id;
    }

    // 4. Resource
    const resResult = await db.query(
      `INSERT INTO resources.resources (id, tenant_id, provider_id, model_id, credential_id, status, priority)
       VALUES ('01924b00-0000-7000-8000-000000000004', NULL, $1, $2, $3, 'active', 10)
       ON CONFLICT (id) DO UPDATE SET
         provider_id = EXCLUDED.provider_id,
         model_id = EXCLUDED.model_id,
         credential_id = EXCLUDED.credential_id,
         status = EXCLUDED.status
       RETURNING id;`,
      [providerId, modelId, credentialId]
    );

    // 5. Quota
    await db.query(
      `INSERT INTO resources.resource_quotas (id, resource_id, quota_type, limit_value, remaining_value, observed_at)
       VALUES ('01924b00-0000-7000-8000-000000000005', $1, 'RPM', 1000, 1000, now())
       ON CONFLICT (id) DO UPDATE SET remaining_value = 1000;`,
      [resResult.rows[0].id]
    );

    // 6. Health
    await db.query(
      `INSERT INTO resources.resource_health (resource_id, status, consecutive_failures, circuit_state)
       VALUES ($1, 'healthy', 0, 'CLOSED')
       ON CONFLICT (resource_id) DO UPDATE SET status = 'healthy', consecutive_failures = 0, circuit_state = 'CLOSED', cooldown_until = NULL, latency_p95_ms = NULL;`,
      [resResult.rows[0].id]
    );

    return resResult.rows[0].id;
  }

  /**
   * Seeds and activates all supported live providers (Gemini, Groq, Cloudflare, OpenRouter).
   */
  public async ensureLiveProviders(): Promise<string[]> {
    return seedLiveProviders();
  }

  /**
   * Registers or updates a concrete resource instance for testing or platform configuration.
   */
  public async registerResource(params: {
    readonly id?: string;
    readonly providerSlug: string;
    readonly providerName?: string;
    readonly modelSlug: string;
    readonly modelName?: string;
    readonly status?: string;
    readonly priority?: number;
    readonly isPaid?: boolean;
    readonly tier?: string;
    readonly credentialType?: string;
    readonly hourlyRate?: number;
    readonly capabilities?: string[];
    readonly secretReference?: string;
    readonly quotaRemaining?: number;
    readonly healthStatus?: string;
    readonly latencyP95Ms?: number;
    readonly qualityEstimate?: number;
  }): Promise<string> {
    const resourceId = params.id || generateUUIDv7();
    const providerId = generateUUIDv7();
    const modelId = generateUUIDv7();
    const credId = generateUUIDv7();

    // Upsert provider
    let pId = providerId;
    const existingP = await db.query("SELECT id FROM ai.providers WHERE slug = $1;", [params.providerSlug]);
    if (existingP.rows.length > 0) {
      pId = existingP.rows[0].id;
    } else {
      await db.query(
        "INSERT INTO ai.providers (id, name, slug, type) VALUES ($1, $2, $3, 'foundation');",
        [pId, params.providerName || params.providerSlug, params.providerSlug]
      );
    }

    // Upsert model
    let mId = modelId;
    const existingM = await db.query("SELECT id FROM ai.models WHERE provider_id = $1 AND slug = $2;", [pId, params.modelSlug]);
    if (existingM.rows.length > 0) {
      mId = existingM.rows[0].id;
      await db.query(
        `UPDATE ai.models SET metadata = $1 WHERE id = $2;`,
        [
          JSON.stringify({
            is_paid: Boolean(params.isPaid || params.tier === "paid"),
            tier: params.tier || (params.isPaid ? "paid" : "free"),
            capabilities: params.capabilities || ["text"],
            quality_estimate: params.qualityEstimate ?? 0.85,
          }),
          mId,
        ]
      );
    } else {
      await db.query(
        `INSERT INTO ai.models (id, provider_id, name, slug, metadata)
         VALUES ($1, $2, $3, $4, $5);`,
        [
          mId,
          pId,
          params.modelName || params.modelSlug,
          params.modelSlug,
          JSON.stringify({
            is_paid: Boolean(params.isPaid || params.tier === "paid"),
            tier: params.tier || (params.isPaid ? "paid" : "free"),
            capabilities: params.capabilities || ["text"],
            quality_estimate: params.qualityEstimate ?? 0.85,
          }),
        ]
      );
    }

    // Upsert credential
    await db.query(
      `INSERT INTO resources.credentials (id, provider_id, name, secret_reference, credential_type, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       ON CONFLICT (id) DO NOTHING;`,
      [
        credId,
        pId,
        `${params.providerSlug}-cred`,
        params.secretReference || `simulated-key-${params.providerSlug}`,
        params.credentialType || (params.isPaid || params.tier === "paid" ? "paid" : "free"),
      ]
    );

    // Upsert resource
    await db.query(
      `INSERT INTO resources.resources (id, provider_id, model_id, credential_id, status, priority)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET status = $5, priority = $6;`,
      [resourceId, pId, mId, credId, params.status || "active", params.priority ?? 10]
    );

    // Quota if specified
    if (params.quotaRemaining !== undefined) {
      const quotaId = generateUUIDv7();
      await db.query(
        `INSERT INTO resources.resource_quotas (id, resource_id, quota_type, limit_value, remaining_value)
         VALUES ($1, $2, 'RPM', 1000, $3);`,
        [quotaId, resourceId, params.quotaRemaining]
      );
    }

    // Health if specified
    if (params.healthStatus || params.latencyP95Ms) {
      await db.query(
        `INSERT INTO resources.resource_health (resource_id, status, latency_p95_ms)
         VALUES ($1, $2, $3)
         ON CONFLICT (resource_id) DO UPDATE SET status = $2, latency_p95_ms = $3;`,
        [resourceId, params.healthStatus || "healthy", params.latencyP95Ms || 800]
      );
    }

    return resourceId;
  }

  /**
   * Loads all active/degraded resources from PostgreSQL and normalizes them into NormalizedResourceCandidate snapshots.
   */
  public async loadNormalizedCandidates(): Promise<NormalizedResourceCandidate[]> {
    const query = `
      SELECT 
        r.id AS resource_id,
        r.tenant_id,
        r.provider_id,
        r.model_id,
        r.credential_id,
        r.status AS resource_status,
        r.priority,
        r.created_at,
        r.updated_at,
        p.slug AS provider_slug,
        p.name AS provider_name,
        m.slug AS model_slug,
        m.name AS model_name,
        m.metadata AS model_metadata,
        c.secret_reference,
        c.status AS credential_status,
        c.credential_type,
        h.status AS health_status,
        h.circuit_state,
        h.consecutive_failures,
        h.cooldown_until,
        h.last_failure_reason,
        h.latency_p50_ms,
        h.latency_p95_ms,
        h.rate_limit_rate,
        h.success_rate,
        q.remaining_value AS quota_remaining,
        q.limit_value AS quota_limit,
        q.quota_type
      FROM resources.resources r
      JOIN ai.providers p ON r.provider_id = p.id
      JOIN ai.models m ON r.model_id = m.id
      LEFT JOIN resources.credentials c ON r.credential_id = c.id
      LEFT JOIN resources.resource_health h ON r.id = h.resource_id
      LEFT JOIN resources.resource_quotas q ON r.id = q.resource_id;
    `;

    const result = await db.query(query);
    const nowTime = Date.now();

    return result.rows.map((row) => {
      const meta = typeof row.model_metadata === "object" && row.model_metadata !== null
        ? row.model_metadata
        : {};

      const billing = normalizeBillingClass({
        isPaid: meta.is_paid,
        tier: meta.tier,
        credentialType: row.credential_type,
      });

      const capabilities = normalizeCapabilities(meta.capabilities);

      const circuitState = (row.circuit_state || "CLOSED").toUpperCase();
      const cooldownUntil = row.cooldown_until ? new Date(row.cooldown_until) : undefined;
      const isCooldownActive = cooldownUntil ? cooldownUntil.getTime() > nowTime : false;

      let isRateLimited = false;
      let retryAfterMs: number | undefined;

      if (row.last_failure_reason === "RATE_LIMIT" && isCooldownActive) {
        isRateLimited = true;
        retryAfterMs = cooldownUntil!.getTime() - nowTime;
      }

      let healthState: ResourceHealthState = "HEALTHY";
      if (circuitState === "OPEN") {
        healthState = isCooldownActive ? "COOLDOWN" : "PROBE";
      } else if (circuitState === "HALF_OPEN") {
        healthState = "PROBE";
      } else {
        const rawHealth = (row.health_status || "").toLowerCase();
        if (rawHealth === "unhealthy" || rawHealth === "down" || rawHealth === "dead") {
          healthState = "UNAVAILABLE";
        } else if (rawHealth === "degraded" || (row.consecutive_failures && parseInt(row.consecutive_failures, 10) > 0)) {
          healthState = "DEGRADED";
        } else if (rawHealth === "cooldown") {
          healthState = "COOLDOWN";
        } else if (rawHealth === "probe") {
          healthState = "PROBE";
        }
      }

      const quotas: QuotaDimensionState[] = [];
      if (row.quota_type) {
        quotas.push({
          type: row.quota_type as any,
          limit: row.quota_limit !== null ? parseInt(row.quota_limit, 10) : undefined,
          remaining: row.quota_remaining !== null ? parseInt(row.quota_remaining, 10) : undefined,
          confidence: 1.0,
        });
      }

      return {
        resourceId: row.resource_id,
        providerId: row.provider_id,
        providerSlug: row.provider_slug,
        providerName: row.provider_name || row.provider_slug,
        modelId: row.model_id,
        modelSlug: row.model_slug,
        modelName: row.model_name || row.model_slug,
        credentialId: row.credential_id || undefined,
        credentialType: row.credential_type || undefined,
        secretReference: row.secret_reference || undefined,
        billingClass: billing.billingClass,
        isPaid: billing.isPaid,
        capabilities,
        health: healthState,
        status: row.resource_status,
        quotas,
        primaryQuotaRemaining: row.quota_remaining !== null && row.quota_remaining !== undefined ? parseInt(row.quota_remaining, 10) : undefined,
        rateLimit: {
          isRateLimited,
          cooldownUntil: isRateLimited ? cooldownUntil : undefined,
          retryAfterMs,
        },
        latencyP50Ms: row.latency_p50_ms ? parseInt(row.latency_p50_ms, 10) : undefined,
        latencyP95Ms: row.latency_p95_ms ? parseInt(row.latency_p95_ms, 10) : undefined,
        successRate: row.success_rate ? parseFloat(row.success_rate) : undefined,
        qualityEstimate: meta.quality_estimate ? parseFloat(meta.quality_estimate) : 0.85,
        priority: row.priority || 0,
        observedAt: row.updated_at || row.created_at || new Date(),
        confidence: 1.0,
      };
    });
  }

  /**
   * Filters, scores, and selects an optimal resource meeting task hard constraints.
   * Enforces Section 10, 11, 12, 13, 20 & 21 of M4 MASTER EXECUTION PLAN.
   */
  public async selectResource(
    requirements?: TaskRequirements,
    policy?: TaskPolicy,
    context?: { taskId?: string; executionId?: string; stepExecutionId?: string }
  ): Promise<SelectedResource> {
    let candidates = await this.loadNormalizedCandidates();
    if (candidates.length === 0) {
      await this.ensureBaseResource();
      candidates = await this.loadNormalizedCandidates();
    }
    const decision = ResourceDecisionEngine.evaluate(candidates, {
      requirements,
      policy,
    });

    // Persist decision record (secret-redacted)
    let decisionId: string | undefined;
    try {
      decisionId = await resourceDecisionPersistence.persistDecision(decision, context);
    } catch (persistErr) {
      console.warn("[ResourceIntelligence] Failed to persist decision record:", persistErr);
    }

    if (decision.decisionType === "REQUEST_APPROVAL") {
      throw new Error(
        `REQUEST_APPROVAL: Paid resource ${decision.requestApprovalCandidate?.modelSlug} requires explicit authorization (allowPaid: false)`
      );
    }

    if (decision.decisionType === "FAIL" || !decision.selectedCandidate) {
      throw new Error(
        `No eligible active resources found meeting constraints (${decision.eligibility.excluded.length} candidate(s) excluded: ${decision.eligibility.excluded.map((e) => e.rejectionReason).join(", ")})`
      );
    }

    const chosen = decision.selectedCandidate.candidate;

    return {
      resource: {
        id: chosen.resourceId,
        providerId: chosen.providerId,
        modelId: chosen.modelId,
        credentialId: chosen.credentialId,
        status: chosen.status,
        priority: chosen.priority,
        createdAt: chosen.observedAt,
        updatedAt: chosen.observedAt,
      },
      providerSlug: chosen.providerSlug,
      modelSlug: chosen.modelSlug,
      credentialSecretRef: chosen.secretReference,
      decisionId,
    };
  }

  /**
   * Retrieves a specific resource by ID with full metadata.
   */
  public async getResourceById(resourceId: string): Promise<SelectedResource | null> {
    const candidates = await this.loadNormalizedCandidates();
    const chosen = candidates.find((c) => c.resourceId === resourceId);
    if (!chosen) return null;

    return {
      resource: {
        id: chosen.resourceId,
        providerId: chosen.providerId,
        modelId: chosen.modelId,
        credentialId: chosen.credentialId,
        status: chosen.status,
        priority: chosen.priority,
        createdAt: chosen.observedAt,
        updatedAt: chosen.observedAt,
      },
      providerSlug: chosen.providerSlug,
      modelSlug: chosen.modelSlug,
      credentialSecretRef: chosen.secretReference,
    };
  }

  /**
   * Evaluates and selects an alternative resource for execution recovery using Strategic Decision Engine.
   */
  public async selectAlternativeResource(
    request: AlternativeResourceRequest,
    context?: { taskId?: string; executionId?: string; stepExecutionId?: string }
  ): Promise<AlternativeResourceResolution> {
    let candidates = await this.loadNormalizedCandidates();
    if (candidates.length === 0) {
      await this.ensureBaseResource();
      candidates = await this.loadNormalizedCandidates();
    }
    const decision = ResourceDecisionEngine.evaluate(candidates, {
      currentResourceId: request.currentResourceId,
      excludedResourceIds: request.excludedResourceIds,
      requirements: request.requirements,
      policy: request.policy,
      failureReason: request.failureReason,
    });

    // Persist decision record (secret-redacted)
    let decisionId: string | undefined;
    try {
      decisionId = await resourceDecisionPersistence.persistDecision(decision, context);
    } catch (persistErr) {
      console.warn("[ResourceIntelligence] Failed to persist decision record:", persistErr);
    }

    if (decision.decisionType === "MIGRATE" && decision.selectedCandidate) {
      const chosen = decision.selectedCandidate.candidate;
      return {
        success: true,
        resource: {
          resource: {
            id: chosen.resourceId,
            providerId: chosen.providerId,
            modelId: chosen.modelId,
            credentialId: chosen.credentialId,
            status: chosen.status,
            priority: chosen.priority,
            createdAt: chosen.observedAt,
            updatedAt: chosen.observedAt,
          },
          providerSlug: chosen.providerSlug,
          modelSlug: chosen.modelSlug,
          credentialSecretRef: chosen.secretReference,
        },
        decisionId,
      };
    }

    if (decision.decisionType === "WAIT") {
      return {
        success: false,
        reason: "WAIT",
        details: decision.reasons.join("; "),
        waitMs: decision.waitMs,
        decisionId,
      };
    }

    if (decision.decisionType === "REQUEST_APPROVAL") {
      return {
        success: false,
        reason: "NO_ELIGIBLE_RESOURCE",
        details: `REQUEST_APPROVAL: ${decision.reasons.join("; ")}`,
        decisionId,
      };
    }

    return {
      success: false,
      reason: "NO_ELIGIBLE_RESOURCE",
      details: decision.reasons.join("; ") || `No active, unexcluded resources meeting constraints found (${decision.eligibility.excluded.length} candidate(s) excluded: ${decision.eligibility.excluded.map((e) => e.rejectionReason).join(", ")})`,
      decisionId,
    };
  }

  /**
   * Records execution outcome to update dynamic health and rate-limit states.
   */
  public async recordExecutionSuccess(resourceId: string, latencyMs?: number): Promise<void> {
    await resourceHealthService.recordSuccess(resourceId, latencyMs);
  }

  public async recordExecutionFailure(
    resourceId: string,
    error: { code: string; message?: string; isProviderError: boolean; latencyMs?: number; retryAfterMs?: number }
  ): Promise<void> {
    await resourceHealthService.recordFailure(resourceId, error);
    if (error.code === "RATE_LIMIT" || error.code === "429") {
      await rateLimitIntelligence.recordRateLimit({
        resourceId,
        retryAfterMs: error.retryAfterMs,
        details: { message: error.message },
      });
    }
  }

  /**
   * Reserves capacity prior to execution dispatch.
   */
  public async reserveQuota(params: QuotaReservationRequest): Promise<QuotaReservationResult> {
    return quotaTrackingService.reserveQuota(params);
  }

  /**
   * Releases an unconsumed reservation.
   */
  public async releaseReservation(reservationId: string): Promise<void> {
    return quotaTrackingService.releaseReservation(reservationId);
  }

  /**
   * Reconciles actual token consumption post-execution.
   */
  public async reconcileUsage(
    reservationId: string,
    actualTokens: { inputTokens: number; outputTokens: number }
  ): Promise<QuotaReconciliationResult> {
    return quotaTrackingService.reconcileUsage(reservationId, actualTokens);
  }
}

export const resourceIntelligence = new ResourceIntelligenceService();

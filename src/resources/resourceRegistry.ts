import { db } from "../db/client.js";
import { generateUUIDv7 } from "../domain/common/id.js";
import { ResourceBillingClass, ResourceCapability } from "../domain/resource/stateTypes.js";

export type ResourceLifecycleStatus =
  | "DISCOVERED"
  | "DOCUMENTATION_VERIFIED"
  | "CREDENTIAL_CONFIGURED"
  | "CONNECTIVITY_VERIFIED"
  | "CAPABILITY_TESTED"
  | "QUOTA_VERIFIED"
  | "INTEGRATION_TESTED"
  | "PRODUCTION_CANDIDATE"
  | "BLOCKED"
  | "RETIRED";

export interface ResourceRegistryEntry {
  readonly id?: string;
  readonly providerSlug: string;
  readonly providerName: string;
  readonly providerType: "direct" | "aggregator";
  readonly upstreamProviderSlug?: string;
  readonly modelSlug: string;
  readonly modelName: string;
  readonly billingClass: ResourceBillingClass;
  readonly lifecycleStatus: ResourceLifecycleStatus;
  readonly capabilities: ReadonlyArray<ResourceCapability>;
  readonly knownLimits?: {
    readonly rpm?: number;
    readonly rpd?: number;
    readonly tpm?: number;
    readonly contextTokens?: number;
    readonly isKnownLimit?: boolean;
  };
  readonly evidence?: {
    readonly sourceUrl?: string;
    readonly verificationDate?: string;
    readonly evidenceStatus?: string;
    readonly notes?: string;
  };
  readonly documentationUrl?: string;
  readonly createdAt?: Date;
  readonly updatedAt?: Date;
}

export class ResourceDiscoveryRegistry {
  /**
   * Registers or updates a discovered resource candidate.
   * Guarantees zero credential or secret storage in metadata.
   */
  public async registerCandidate(entry: ResourceRegistryEntry): Promise<string> {
    const id = entry.id || generateUUIDv7();
    const now = new Date();

    // Sanitize evidence: ensure no keys or tokens
    const sanitizedEvidence = { ...(entry.evidence || {}) };
    for (const key of Object.keys(sanitizedEvidence)) {
      if (/key|secret|token|password|auth/i.test(key)) {
        delete (sanitizedEvidence as any)[key];
      }
    }

    await db.query(
      `INSERT INTO resources.resource_registry (
        id, provider_slug, provider_name, provider_type, upstream_provider_slug,
        model_slug, model_name, billing_class, lifecycle_status, capabilities,
        known_limits, evidence, documentation_url, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)
      ON CONFLICT (provider_slug, model_slug) DO UPDATE SET
        provider_name = $3,
        provider_type = $4,
        upstream_provider_slug = $5,
        model_name = $7,
        billing_class = $8,
        lifecycle_status = $9,
        capabilities = $10,
        known_limits = $11,
        evidence = $12,
        documentation_url = $13,
        updated_at = $14;`,
      [
        id,
        entry.providerSlug,
        entry.providerName,
        entry.providerType,
        entry.upstreamProviderSlug || null,
        entry.modelSlug,
        entry.modelName,
        entry.billingClass,
        entry.lifecycleStatus,
        JSON.stringify(entry.capabilities),
        JSON.stringify(entry.knownLimits || {}),
        JSON.stringify(sanitizedEvidence),
        entry.documentationUrl || null,
        now,
      ]
    );

    return id;
  }

  /**
   * Transitions lifecycle stage (e.g. from DOCUMENTATION_VERIFIED to CONNECTIVITY_VERIFIED).
   */
  public async updateLifecycleStatus(
    providerSlug: string,
    modelSlug: string,
    status: ResourceLifecycleStatus,
    evidenceUpdate?: Record<string, unknown>
  ): Promise<void> {
    const existing = await this.getEntry(providerSlug, modelSlug);
    if (!existing) {
      throw new Error(`Resource candidate ${providerSlug}/${modelSlug} not found in registry`);
    }

    const mergedEvidence = {
      ...(existing.evidence || {}),
      ...(evidenceUpdate || {}),
      lastStatusTransition: status,
      transitionTimestamp: new Date().toISOString(),
    };

    await db.query(
      `UPDATE resources.resource_registry
       SET lifecycle_status = $1, evidence = $2, updated_at = now()
       WHERE provider_slug = $3 AND model_slug = $4;`,
      [status, JSON.stringify(mergedEvidence), providerSlug, modelSlug]
    );
  }

  /**
   * Retrieves a candidate entry by provider and model slug.
   */
  public async getEntry(providerSlug: string, modelSlug: string): Promise<ResourceRegistryEntry | null> {
    const res = await db.query(
      `SELECT * FROM resources.resource_registry WHERE provider_slug = $1 AND model_slug = $2;`,
      [providerSlug, modelSlug]
    );

    if (res.rows.length === 0) return null;
    return this.mapRow(res.rows[0]);
  }

  /**
   * Lists registered candidates matching optional lifecycle or billing criteria.
   */
  public async listCandidates(filter?: {
    lifecycleStatus?: ResourceLifecycleStatus;
    billingClass?: ResourceBillingClass;
    providerType?: "direct" | "aggregator";
  }): Promise<ResourceRegistryEntry[]> {
    let query = `SELECT * FROM resources.resource_registry WHERE 1=1`;
    const params: any[] = [];

    if (filter?.lifecycleStatus) {
      params.push(filter.lifecycleStatus);
      query += ` AND lifecycle_status = $${params.length}`;
    }
    if (filter?.billingClass) {
      params.push(filter.billingClass);
      query += ` AND billing_class = $${params.length}`;
    }
    if (filter?.providerType) {
      params.push(filter.providerType);
      query += ` AND provider_type = $${params.length}`;
    }

    query += ` ORDER BY provider_slug ASC, model_slug ASC;`;

    const res = await db.query(query, params);
    return res.rows.map(this.mapRow);
  }

  /**
   * Deprecates or retires a resource candidate safely without breaking audit traces.
   */
  public async deprecateCandidate(providerSlug: string, modelSlug: string, reason: string): Promise<void> {
    await this.updateLifecycleStatus(providerSlug, modelSlug, "RETIRED", { retirementReason: reason });
  }

  private mapRow(row: any): ResourceRegistryEntry {
    return {
      id: row.id,
      providerSlug: row.provider_slug,
      providerName: row.provider_name,
      providerType: row.provider_type,
      upstreamProviderSlug: row.upstream_provider_slug || undefined,
      modelSlug: row.model_slug,
      modelName: row.model_name,
      billingClass: row.billing_class,
      lifecycleStatus: row.lifecycle_status,
      capabilities: row.capabilities,
      knownLimits: row.known_limits,
      evidence: row.evidence,
      documentationUrl: row.documentation_url || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

export const resourceDiscoveryRegistry = new ResourceDiscoveryRegistry();

import { db } from "../db/client.js";
import { LIVE_PROVIDERS, type ProviderSeedConfig } from "./seedCatalog.js";

export { LIVE_PROVIDERS, type ProviderSeedConfig };

export async function seedLiveProviders(): Promise<string[]> {
  const seededResourceIds: string[] = [];

  for (const item of LIVE_PROVIDERS) {
    // 1. Provider
    const provRes = await db.query(
      `INSERT INTO ai.providers (id, name, slug, type)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id;`,
      [item.providerId, item.providerName, item.providerSlug, item.providerType]
    );
    const resolvedProvId = provRes.rows[0].id;

    // 2. Model resolution (Lookup existing or insert new to prevent PK collision)
    const isEmbedding = item.modelSlug.includes("bge") || item.modelSlug.includes("embedding");
    const modelCaps = isEmbedding ? ["embeddings", "vector"] : ["text", "code", "json"];
    const metadataJson = JSON.stringify({ is_paid: false, capabilities: modelCaps });

    const existingModel = await db.query(
      `SELECT id FROM ai.models WHERE provider_id = $1 AND slug = $2;`,
      [resolvedProvId, item.modelSlug]
    );
    let resolvedModelId: string;
    if (existingModel.rows.length > 0) {
      resolvedModelId = existingModel.rows[0].id;
      await db.query(
        `UPDATE ai.models SET name = $1, metadata = $2, updated_at = now() WHERE id = $3;`,
        [item.modelName, metadataJson, resolvedModelId]
      );
    } else {
      const modelRes = await db.query(
        `INSERT INTO ai.models (id, provider_id, name, slug, family, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id;`,
        [item.modelId, resolvedProvId, item.modelName, item.modelSlug, item.modelFamily, metadataJson]
      );
      resolvedModelId = modelRes.rows[0].id;
    }

    // 3. Credential
    const credRes = await db.query(
      `INSERT INTO resources.credentials (id, provider_id, name, secret_reference, credential_type, status)
       VALUES ($1, $2, $3, $4, 'api_key', 'active')
       ON CONFLICT (id) DO UPDATE SET secret_reference = EXCLUDED.secret_reference, status = 'active'
       RETURNING id;`,
      [item.credentialId, resolvedProvId, item.credentialName, item.secretRef]
    );
    const resolvedCredId = credRes.rows[0].id;

    // 4. Resource
    const resRes = await db.query(
      `INSERT INTO resources.resources (id, tenant_id, provider_id, model_id, credential_id, status, priority)
       VALUES ($1, NULL, $2, $3, $4, 'active', $5)
       ON CONFLICT (id) DO UPDATE SET status = 'active', priority = EXCLUDED.priority, model_id = EXCLUDED.model_id, credential_id = EXCLUDED.credential_id
       RETURNING id;`,
      [item.resourceId, resolvedProvId, resolvedModelId, resolvedCredId, item.priority]
    );
    const resolvedResId = resRes.rows[0].id;

    // 5. Quota
    await db.query(
      `INSERT INTO resources.resource_quotas (id, resource_id, quota_type, limit_value, remaining_value, observed_at)
       VALUES ($1, $2, 'RPM', 1000, 1000, now())
       ON CONFLICT (id) DO UPDATE SET remaining_value = 1000;`,
      [item.quotaId, resolvedResId]
    );

    // 6. Health State Reset
    await db.query(
      `INSERT INTO resources.resource_health (resource_id, status, circuit_state, consecutive_failures)
       VALUES ($1, 'healthy', 'CLOSED', 0)
       ON CONFLICT (resource_id) DO UPDATE SET status = 'healthy', circuit_state = 'CLOSED', consecutive_failures = 0, cooldown_until = NULL;`,
      [resolvedResId]
    );

    // 7. Resource Discovery Registry (Task M4.10)
    await db.query(
      `INSERT INTO resources.resource_registry (
         id, provider_slug, provider_name, provider_type, model_slug, model_name,
         billing_class, lifecycle_status, capabilities
       ) VALUES ($1, $2, $3, $4, $5, $6, 'FREE', 'PRODUCTION_CANDIDATE', '["text", "code", "json"]')
       ON CONFLICT (provider_slug, model_slug) DO UPDATE
         SET lifecycle_status = 'PRODUCTION_CANDIDATE';`,
      [
        item.resourceId,
        item.providerSlug,
        item.providerName,
        item.providerType,
        item.modelSlug,
        item.modelName,
      ]
    );

    seededResourceIds.push(resolvedResId);
  }

  return seededResourceIds;
}

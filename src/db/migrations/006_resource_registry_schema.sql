-- ============================================================================
-- Migration 006: Resource Discovery Registry Schema (Milestone M4 Batch D)
-- Enforces Task M4.10 Normalized Discovery and Registry Contract
-- ============================================================================

CREATE TABLE IF NOT EXISTS resources.resource_registry (
    id UUID PRIMARY KEY,
    provider_slug TEXT NOT NULL,
    provider_name TEXT NOT NULL,
    provider_type TEXT NOT NULL DEFAULT 'direct', -- 'direct' or 'aggregator'
    upstream_provider_slug TEXT,
    model_slug TEXT NOT NULL,
    model_name TEXT NOT NULL,
    billing_class TEXT NOT NULL DEFAULT 'FREE', -- 'FREE', 'PAID', 'BYOK', 'INTERNAL'
    lifecycle_status TEXT NOT NULL DEFAULT 'DISCOVERED',
    capabilities JSONB NOT NULL DEFAULT '[]',
    known_limits JSONB NOT NULL DEFAULT '{}',
    evidence JSONB NOT NULL DEFAULT '{}',
    documentation_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider_slug, model_slug)
);

CREATE INDEX IF NOT EXISTS idx_resource_registry_status ON resources.resource_registry(lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_resource_registry_billing ON resources.resource_registry(billing_class);

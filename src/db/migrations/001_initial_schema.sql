-- 001_initial_schema.sql
-- M0 Architectural Schema Baseline

CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS projects;
CREATE SCHEMA IF NOT EXISTS tasks;
CREATE SCHEMA IF NOT EXISTS planning;
CREATE SCHEMA IF NOT EXISTS execution;
CREATE SCHEMA IF NOT EXISTS artifacts;
CREATE SCHEMA IF NOT EXISTS ai;
CREATE SCHEMA IF NOT EXISTS resources;
CREATE SCHEMA IF NOT EXISTS validation;
CREATE SCHEMA IF NOT EXISTS system;

-- ============================================================================
-- 1. Identity & Projects Domain
-- ============================================================================

CREATE TABLE IF NOT EXISTS identity.tenants (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active',
    plan TEXT NOT NULL DEFAULT 'free',
    settings JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS identity.users (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES identity.tenants(id),
    email TEXT NOT NULL,
    name TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    role TEXT NOT NULL DEFAULT 'developer',
    preferences JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, email)
);

CREATE TABLE IF NOT EXISTS projects.projects (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES identity.tenants(id),
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    settings JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, slug)
);

CREATE TABLE IF NOT EXISTS identity.api_keys (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES identity.tenants(id),
    project_id UUID REFERENCES projects.projects(id),
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL,
    scopes JSONB NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ
);

-- ============================================================================
-- 2. Tasks Domain
-- ============================================================================

CREATE TABLE IF NOT EXISTS tasks.tasks (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES identity.tenants(id),
    project_id UUID REFERENCES projects.projects(id),
    created_by_user_id UUID REFERENCES identity.users(id),
    task_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    priority INTEGER NOT NULL DEFAULT 0,
    input_payload JSONB NOT NULL,
    requirements JSONB NOT NULL DEFAULT '{}',
    policy JSONB NOT NULL DEFAULT '{}',
    quality_score NUMERIC(5,4),
    output_artifact_id UUID,
    error_id UUID,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tasks_tenant_status ON tasks.tasks (tenant_id, status);

-- ============================================================================
-- 3. Planning Domain
-- ============================================================================

CREATE TABLE IF NOT EXISTS planning.execution_plans (
    id UUID PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES tasks.tasks(id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'draft',
    strategy TEXT NOT NULL,
    quality_estimate NUMERIC(5,4),
    latency_estimate_ms INTEGER,
    cost_estimate NUMERIC(12,6),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    validated_at TIMESTAMPTZ,
    activated_at TIMESTAMPTZ,
    UNIQUE (task_id, version)
);

CREATE TABLE IF NOT EXISTS planning.plan_steps (
    id UUID PRIMARY KEY,
    plan_id UUID NOT NULL REFERENCES planning.execution_plans(id) ON DELETE CASCADE,
    step_key TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    step_type TEXT NOT NULL,
    order_index INTEGER NOT NULL,
    required_capability TEXT,
    input_schema JSONB,
    output_schema JSONB,
    assigned_resource_id UUID,
    assigned_model_id UUID,
    quality_target NUMERIC(5,4),
    timeout_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (plan_id, step_key)
);

CREATE TABLE IF NOT EXISTS planning.step_dependencies (
    id UUID PRIMARY KEY,
    plan_step_id UUID NOT NULL REFERENCES planning.plan_steps(id) ON DELETE CASCADE,
    depends_on_step_id UUID NOT NULL REFERENCES planning.plan_steps(id) ON DELETE CASCADE,
    dependency_type TEXT NOT NULL DEFAULT 'completion',
    condition JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (plan_step_id, depends_on_step_id)
);

-- ============================================================================
-- 4. Execution Domain (Authoritative Work Queue & Attempts)
-- ============================================================================

CREATE TABLE IF NOT EXISTS execution.executions (
    id UUID PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES tasks.tasks(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES planning.execution_plans(id),
    status TEXT NOT NULL DEFAULT 'pending',
    current_step_id UUID,
    total_cost NUMERIC(12,6) NOT NULL DEFAULT 0,
    total_input_tokens BIGINT NOT NULL DEFAULT 0,
    total_output_tokens BIGINT NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    retry_count INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Authoritative Work Queue (ADR-094)
CREATE TABLE IF NOT EXISTS execution.step_executions (
    id UUID PRIMARY KEY,
    execution_id UUID NOT NULL REFERENCES execution.executions(id) ON DELETE CASCADE,
    plan_step_id UUID NOT NULL REFERENCES planning.plan_steps(id),
    task_id UUID NOT NULL REFERENCES tasks.tasks(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    resource_id UUID,
    model_id UUID,
    worker_id UUID,
    lease_token TEXT,
    lease_expires_at TIMESTAMPTZ,
    fencing_token BIGINT NOT NULL DEFAULT 0,
    priority INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    input_tokens BIGINT,
    output_tokens BIGINT,
    latency_ms BIGINT,
    quality_score NUMERIC(5,4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_step_executions_queue 
ON execution.step_executions (priority DESC, available_at ASC)
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_step_executions_lease_reaper
ON execution.step_executions (lease_expires_at)
WHERE status = 'running';

CREATE TABLE IF NOT EXISTS execution.execution_attempts (
    id UUID PRIMARY KEY,
    step_execution_id UUID NOT NULL REFERENCES execution.step_executions(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL,
    resource_id UUID,
    provider_id UUID,
    model_id UUID,
    status TEXT NOT NULL,
    request_ref TEXT,
    response_ref TEXT,
    input_tokens BIGINT,
    output_tokens BIGINT,
    latency_ms BIGINT,
    error_id UUID,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    UNIQUE (step_execution_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS execution.execution_errors (
    id UUID PRIMARY KEY,
    execution_id UUID REFERENCES execution.executions(id),
    step_execution_id UUID REFERENCES execution.step_executions(id),
    attempt_id UUID REFERENCES execution.execution_attempts(id),
    category TEXT NOT NULL,
    code TEXT,
    provider_code TEXT,
    message TEXT,
    retryable BOOLEAN NOT NULL DEFAULT FALSE,
    migratable BOOLEAN NOT NULL DEFAULT FALSE,
    details JSONB NOT NULL DEFAULT '{}',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS execution.checkpoints (
    id UUID PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES tasks.tasks(id) ON DELETE CASCADE,
    execution_id UUID NOT NULL REFERENCES execution.executions(id) ON DELETE CASCADE,
    step_execution_id UUID REFERENCES execution.step_executions(id),
    sequence_number INTEGER NOT NULL,
    snapshot_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (execution_id, sequence_number)
);

CREATE TABLE IF NOT EXISTS execution.side_effect_receipts (
    id UUID PRIMARY KEY,
    effect_key TEXT NOT NULL UNIQUE,
    task_id UUID NOT NULL REFERENCES tasks.tasks(id) ON DELETE CASCADE,
    execution_id UUID NOT NULL REFERENCES execution.executions(id) ON DELETE CASCADE,
    step_execution_id UUID NOT NULL REFERENCES execution.step_executions(id) ON DELETE CASCADE,
    mutation_type TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    external_transaction_id TEXT,
    status TEXT NOT NULL,
    response_digest JSONB NOT NULL DEFAULT '{}',
    executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 5. Artifacts Domain
-- ============================================================================

CREATE TABLE IF NOT EXISTS artifacts.artifacts (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES identity.tenants(id),
    project_id UUID REFERENCES projects.projects(id),
    task_id UUID REFERENCES tasks.tasks(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    name TEXT,
    storage_uri TEXT NOT NULL,
    inline_content TEXT,
    mime_type TEXT,
    size_bytes BIGINT,
    content_hash TEXT NOT NULL,
    schema JSONB,
    producer_type TEXT,
    producer_id UUID,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS artifacts.artifact_versions (
    id UUID PRIMARY KEY,
    artifact_id UUID NOT NULL REFERENCES artifacts.artifacts(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    storage_uri TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    size_bytes BIGINT,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (artifact_id, version)
);

-- ============================================================================
-- 6. AI Ecosystem Catalog
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai.providers (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    api_base_url TEXT,
    documentation_url TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai.models (
    id UUID PRIMARY KEY,
    provider_id UUID NOT NULL REFERENCES ai.providers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    family TEXT,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider_id, slug)
);

-- ============================================================================
-- 7. Resource Intelligence Domain
-- ============================================================================

CREATE TABLE IF NOT EXISTS resources.credentials (
    id UUID PRIMARY KEY,
    tenant_id UUID REFERENCES identity.tenants(id),
    provider_id UUID NOT NULL REFERENCES ai.providers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    secret_reference TEXT NOT NULL,
    credential_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    last_validated_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS resources.resources (
    id UUID PRIMARY KEY,
    tenant_id UUID REFERENCES identity.tenants(id),
    provider_id UUID NOT NULL REFERENCES ai.providers(id) ON DELETE CASCADE,
    model_id UUID NOT NULL REFERENCES ai.models(id) ON DELETE CASCADE,
    model_version_id UUID,
    credential_id UUID REFERENCES resources.credentials(id),
    status TEXT NOT NULL DEFAULT 'active',
    region TEXT,
    endpoint TEXT,
    priority INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS resources.resource_quotas (
    id UUID PRIMARY KEY,
    resource_id UUID NOT NULL REFERENCES resources.resources(id) ON DELETE CASCADE,
    quota_type TEXT NOT NULL,
    limit_value BIGINT,
    remaining_value BIGINT,
    unit TEXT,
    window_type TEXT,
    window_start TIMESTAMPTZ,
    window_end TIMESTAMPTZ,
    reset_at TIMESTAMPTZ,
    confidence NUMERIC(5,4),
    observed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS resources.resource_reservations (
    id UUID PRIMARY KEY,
    resource_id UUID NOT NULL REFERENCES resources.resources(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES tasks.tasks(id) ON DELETE CASCADE,
    step_id UUID,
    estimated_requests BIGINT,
    estimated_tokens BIGINT,
    status TEXT NOT NULL DEFAULT 'reserved',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS resources.resource_health (
    resource_id UUID PRIMARY KEY REFERENCES resources.resources(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    latency_p50_ms BIGINT,
    latency_p95_ms BIGINT,
    error_rate NUMERIC(7,6),
    timeout_rate NUMERIC(7,6),
    rate_limit_rate NUMERIC(7,6),
    success_rate NUMERIC(7,6),
    observed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 8. Truth & Validation Domain
-- ============================================================================

CREATE TABLE IF NOT EXISTS validation.validations (
    id UUID PRIMARY KEY,
    task_id UUID REFERENCES tasks.tasks(id) ON DELETE CASCADE,
    execution_id UUID REFERENCES execution.executions(id) ON DELETE CASCADE,
    step_execution_id UUID REFERENCES execution.step_executions(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL,
    target_id UUID NOT NULL,
    validator_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    confidence NUMERIC(5,4),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS validation.validation_rules (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    definition JSONB NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    severity TEXT NOT NULL DEFAULT 'error',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS validation.validation_results (
    id UUID PRIMARY KEY,
    validation_id UUID NOT NULL REFERENCES validation.validations(id) ON DELETE CASCADE,
    rule_id UUID NOT NULL REFERENCES validation.validation_rules(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    score NUMERIC(5,4),
    confidence NUMERIC(5,4),
    details JSONB NOT NULL DEFAULT '{}',
    evidence_refs JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS validation.claims (
    id UUID PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES tasks.tasks(id) ON DELETE CASCADE,
    artifact_id UUID NOT NULL REFERENCES artifacts.artifacts(id) ON DELETE CASCADE,
    claim_text TEXT NOT NULL,
    claim_type TEXT NOT NULL,
    confidence NUMERIC(5,4),
    status TEXT NOT NULL DEFAULT 'unverified',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS validation.evidence (
    id UUID PRIMARY KEY,
    claim_id UUID NOT NULL REFERENCES validation.claims(id) ON DELETE CASCADE,
    evidence_type TEXT NOT NULL,
    source_uri TEXT,
    excerpt_ref TEXT,
    confidence NUMERIC(5,4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 9. System & Resilience Domain
-- ============================================================================

CREATE TABLE IF NOT EXISTS system.idempotency_keys (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES identity.tenants(id),
    key TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id UUID,
    request_hash TEXT NOT NULL,
    response_snapshot JSONB,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS system.outbox_events (
    id UUID PRIMARY KEY,
    event_id UUID NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id UUID NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_outbox_events_unprocessed
ON system.outbox_events (created_at ASC)
WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS system.event_consumptions (
    id UUID PRIMARY KEY,
    consumer_name TEXT NOT NULL,
    event_id UUID NOT NULL,
    consumed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (consumer_name, event_id)
);

CREATE TABLE IF NOT EXISTS system.migrations (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

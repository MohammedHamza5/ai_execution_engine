# AI Execution Engine — Database Schema Specification

**Document:** `DATABASE_SCHEMA.md`  
**Status:** COMPLETE (Database Architecture & DDL Baseline)  
**Version:** 1.0.0  
**Authority:** Derived from Database Schema v1.0 Material  

---

## 1. Purpose

This document provides the authoritative, production-grade **PostgreSQL Database Schema** for the AI Execution Engine. It formalizes the Data Contract defined in `INTERNAL_DATA_MODEL.md` into concrete DDL, foreign keys, constraints, indexes, transaction boundaries, concurrency controls, and idempotency mechanisms.

### Core Database Principle
> **«PostgreSQL + Modular Monolith + UUIDv7 + Selective JSONB + Event Log + Explicit Foreign Keys.»**  
> **«The Database is the system of record and durable state store. The Database is NOT the decision brain.»**  
> All planning, routing, resource intelligence, and validation decisions belong in Application Logic, with results ACID-persisted in PostgreSQL.

---

## 2. Global Conventions & Standards

1. **Universal Primary Keys:** Every primary table uses `id UUID PRIMARY KEY`. IDs are generated using **UUIDv7** (time-sortable, globally unique, high locality for B-Tree indexing).
2. **Strict Timezone Handling:** All timestamp columns use `TIMESTAMPTZ` with defaults `DEFAULT now()`. Naked `TIMESTAMP` without timezone is strictly forbidden.
3. **Audit Columns:** Tables track `created_at TIMESTAMPTZ NOT NULL DEFAULT now()` and `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`. Soft-deletable entities include `deleted_at TIMESTAMPTZ`.
4. **ENUM vs. Dynamic Tables (ADR-022):** PostgreSQL native `ENUM` types are reserved exclusively for strictly finite, closed lifecycle states (e.g. `task_status`). Highly extensible concepts (capabilities, provider types, validator types) are represented as relational catalog tables or validated text columns to prevent schema migration locks.
5. **No Secrets in Plaintext (ADR-023):** API keys, credentials, and provider secrets are stored as hashes (`key_hash`) or external KMS / Vault references (`secret_reference`).

---

## 3. Database Schemas (Namespaces)

The single PostgreSQL database is organized into **12 logical schemas**:

```text
PostgreSQL (Single Database)
├── identity       (Tenants, Users, API Keys)
├── projects       (Project isolation)
├── tasks          (Durable Task specifications, policies, requirements, state)
├── planning       (Execution Plans, DAG steps, step dependencies, decisions)
├── execution      (Executions, Step Executions, Attempts, Errors, Checkpoints, Handoffs)
├── artifacts      (Immutable content-addressed artifacts, versions, relations)
├── ai             (Providers, Models, Model Versions, Capabilities, Mappings)
├── resources      (Resource instances, credentials, quotas, health, reservations)
├── validation     (Validation operations, rules, results, claims, evidence, disputes)
├── evaluation     (Holistic evaluations, metrics, benchmarks, benchmark results)
├── reputation     (Profiles, multi-dimensional scores, evidence weights, snapshots)
└── system         (Event store / Outbox, Audit logs, Policies, Idempotency keys)
```

---

## 4. DDL Specification

### 4.1 Enums & Types

```sql
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS projects;
CREATE SCHEMA IF NOT EXISTS tasks;
CREATE SCHEMA IF NOT EXISTS planning;
CREATE SCHEMA IF NOT EXISTS execution;
CREATE SCHEMA IF NOT EXISTS artifacts;
CREATE SCHEMA IF NOT EXISTS ai;
CREATE SCHEMA IF NOT EXISTS resources;
CREATE SCHEMA IF NOT EXISTS validation;
CREATE SCHEMA IF NOT EXISTS evaluation;
CREATE SCHEMA IF NOT EXISTS reputation;
CREATE SCHEMA IF NOT EXISTS system;

CREATE TYPE tasks.task_status AS ENUM (
    'pending',
    'analyzing',
    'planning',
    'ready',
    'running',
    'waiting',
    'validating',
    'completed',
    'failed',
    'cancelled',
    'paused'
);
```

---

### 4.2 Identity & Projects Domain

```sql
-- Tenants (Organizations / Accounts)
CREATE TABLE identity.tenants (
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

-- Users
CREATE TABLE identity.users (
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

-- Projects
CREATE TABLE projects.projects (
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

-- Client API Keys (Hashed, never plaintext)
CREATE TABLE identity.api_keys (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES identity.tenants(id),
    project_id UUID REFERENCES projects.projects(id),
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL,
    scopes JSONB NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active',
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

### 4.3 Task System Domain

```sql
-- Master Task Entity
CREATE TABLE tasks.tasks (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES identity.tenants(id),
    project_id UUID NOT NULL REFERENCES projects.projects(id),
    external_id TEXT,
    title TEXT,
    description TEXT,
    intent TEXT,
    task_type TEXT,
    status tasks.task_status NOT NULL DEFAULT 'pending',
    priority INTEGER NOT NULL DEFAULT 0,
    complexity_score NUMERIC(5,4),
    quality_floor NUMERIC(5,4),
    parent_task_id UUID REFERENCES tasks.tasks(id),
    current_plan_id UUID,
    current_step_id UUID,
    created_by UUID REFERENCES identity.users(id),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);

-- Task Inputs
CREATE TABLE tasks.task_inputs (
    id UUID PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES tasks.tasks(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    name TEXT,
    content_ref TEXT,
    artifact_id UUID,
    mime_type TEXT,
    size_bytes BIGINT,
    content_hash TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Task Outputs
CREATE TABLE tasks.task_outputs (
    id UUID PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES tasks.tasks(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    name TEXT,
    artifact_id UUID,
    output_schema JSONB,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Task Requirements
CREATE TABLE tasks.task_requirements (
    id UUID PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES tasks.tasks(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    key TEXT NOT NULL,
    value JSONB NOT NULL,
    required BOOLEAN NOT NULL DEFAULT TRUE,
    priority INTEGER NOT NULL DEFAULT 0,
    source TEXT,
    confidence NUMERIC(5,4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Task Policies (Budgets, permissions, privacy)
CREATE TABLE tasks.task_policies (
    id UUID PRIMARY KEY,
    task_id UUID NOT NULL UNIQUE REFERENCES tasks.tasks(id) ON DELETE CASCADE,
    budget_mode TEXT NOT NULL DEFAULT 'free_first',
    max_cost NUMERIC(12,6),
    quality_target NUMERIC(5,4),
    latency_target TEXT,
    allow_paid BOOLEAN NOT NULL DEFAULT FALSE,
    allow_multi_model BOOLEAN NOT NULL DEFAULT TRUE,
    allow_parallel BOOLEAN NOT NULL DEFAULT TRUE,
    privacy_level TEXT,
    preferred_providers JSONB NOT NULL DEFAULT '[]',
    blocked_providers JSONB NOT NULL DEFAULT '[]',
    max_attempts INTEGER NOT NULL DEFAULT 3,
    max_duration_ms BIGINT,
    retention_policy JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Operational Task State (Projection / Snapshot)
CREATE TABLE tasks.task_state (
    task_id UUID PRIMARY KEY REFERENCES tasks.tasks(id) ON DELETE CASCADE,
    status tasks.task_status NOT NULL,
    current_step_id UUID,
    progress NUMERIC(5,4),
    completed_steps JSONB NOT NULL DEFAULT '[]',
    pending_steps JSONB NOT NULL DEFAULT '[]',
    failed_steps JSONB NOT NULL DEFAULT '[]',
    active_attempts JSONB NOT NULL DEFAULT '[]',
    last_checkpoint_id UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

### 4.4 Planning Domain

```sql
-- Execution Strategies Catalog
CREATE TABLE planning.strategies (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    version INTEGER NOT NULL,
    description TEXT,
    strategy_type TEXT NOT NULL,
    constraints JSONB NOT NULL DEFAULT '{}',
    parameters JSONB NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (name, version)
);

-- Execution Plans
CREATE TABLE planning.execution_plans (
    id UUID PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES tasks.tasks(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    strategy_id UUID REFERENCES planning.strategies(id),
    planner_version TEXT,
    input_snapshot JSONB,
    quality_estimate NUMERIC(5,4),
    latency_estimate_ms BIGINT,
    cost_estimate NUMERIC(12,6),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    validated_at TIMESTAMPTZ,
    activated_at TIMESTAMPTZ,
    UNIQUE (task_id, version)
);

-- DAG Plan Steps
CREATE TABLE planning.plan_steps (
    id UUID PRIMARY KEY,
    plan_id UUID NOT NULL REFERENCES planning.execution_plans(id) ON DELETE CASCADE,
    step_key TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    step_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    order_index INTEGER,
    required_capability TEXT,
    input_schema JSONB,
    output_schema JSONB,
    assigned_resource_id UUID,
    assigned_model_id UUID,
    parallel_group TEXT,
    retry_policy JSONB,
    timeout_ms BIGINT,
    quality_target NUMERIC(5,4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (plan_id, step_key)
);

-- DAG Step Dependencies
CREATE TABLE planning.step_dependencies (
    id UUID PRIMARY KEY,
    plan_step_id UUID NOT NULL REFERENCES planning.plan_steps(id) ON DELETE CASCADE,
    depends_on_step_id UUID NOT NULL REFERENCES planning.plan_steps(id) ON DELETE CASCADE,
    dependency_type TEXT NOT NULL DEFAULT 'completion',
    condition JSONB,
    UNIQUE (plan_step_id, depends_on_step_id),
    CHECK (plan_step_id <> depends_on_step_id)
);

-- Planner Decisions (Audit & Explainability)
CREATE TABLE planning.plan_decisions (
    id UUID PRIMARY KEY,
    plan_id UUID NOT NULL REFERENCES planning.execution_plans(id) ON DELETE CASCADE,
    decision_type TEXT NOT NULL,
    selected_option JSONB NOT NULL,
    alternatives JSONB NOT NULL DEFAULT '[]',
    reasons JSONB NOT NULL DEFAULT '[]',
    constraints_considered JSONB NOT NULL DEFAULT '[]',
    confidence NUMERIC(5,4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

### 4.5 Execution Domain

```sql
-- Plan Executions
CREATE TABLE execution.executions (
    id UUID PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES tasks.tasks(id),
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

-- Step Execution Lifecycle (Authoritative Execution Work Queue)
CREATE TABLE execution.step_executions (
    id UUID PRIMARY KEY,
    execution_id UUID NOT NULL REFERENCES execution.executions(id) ON DELETE CASCADE,
    plan_step_id UUID NOT NULL REFERENCES planning.plan_steps(id),
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

-- Transient Execution Attempts
CREATE TABLE execution.execution_attempts (
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

-- Normalized Execution Errors
CREATE TABLE execution.execution_errors (
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

-- Durable Checkpoints
CREATE TABLE execution.checkpoints (
    id UUID PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES tasks.tasks(id),
    execution_id UUID NOT NULL REFERENCES execution.executions(id),
    step_execution_id UUID,
    sequence BIGINT NOT NULL,
    state_snapshot JSONB NOT NULL,
    completed_steps JSONB NOT NULL DEFAULT '[]',
    pending_steps JSONB NOT NULL DEFAULT '[]',
    artifact_refs JSONB NOT NULL DEFAULT '[]',
    resource_state JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (execution_id, sequence)
);

-- Structured Model Handoffs
CREATE TABLE execution.handoffs (
    id UUID PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES tasks.tasks(id),
    execution_id UUID NOT NULL REFERENCES execution.executions(id),
    step_execution_id UUID,
    from_resource_id UUID,
    to_resource_id UUID,
    reason TEXT NOT NULL,
    handoff_package_artifact_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent Side Effect Receipts (ADR-096)
CREATE TABLE execution.side_effect_receipts (
    id UUID PRIMARY KEY,
    effect_key TEXT NOT NULL UNIQUE, -- e.g. "task_id:step_id:mutation_type:target_id"
    task_id UUID NOT NULL REFERENCES tasks.tasks(id),
    execution_id UUID NOT NULL REFERENCES execution.executions(id),
    step_execution_id UUID NOT NULL REFERENCES execution.step_executions(id),
    mutation_type TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    external_transaction_id TEXT,
    status TEXT NOT NULL, -- 'executed', 'confirmed_duplicate', 'failed'
    response_digest JSONB NOT NULL DEFAULT '{}',
    executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

### 4.6 Artifacts Domain

```sql
-- First-Class Artifacts
CREATE TABLE artifacts.artifacts (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES identity.tenants(id),
    project_id UUID REFERENCES projects.projects(id),
    task_id UUID REFERENCES tasks.tasks(id),
    type TEXT NOT NULL,
    name TEXT,
    storage_uri TEXT NOT NULL,
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

-- Artifact Versions
CREATE TABLE artifacts.artifact_versions (
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

-- Artifact Lineage Graph
CREATE TABLE artifacts.artifact_relations (
    id UUID PRIMARY KEY,
    source_artifact_id UUID NOT NULL REFERENCES artifacts.artifacts(id),
    target_artifact_id UUID NOT NULL REFERENCES artifacts.artifacts(id),
    relation_type TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (source_artifact_id <> target_artifact_id)
);
```

---

### 4.7 AI Ecosystem Catalog

```sql
-- AI Providers
CREATE TABLE ai.providers (
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

-- Canonical Models
CREATE TABLE ai.models (
    id UUID PRIMARY KEY,
    provider_id UUID NOT NULL REFERENCES ai.providers(id),
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

-- Model Backend Versions
CREATE TABLE ai.model_versions (
    id UUID PRIMARY KEY,
    model_id UUID NOT NULL REFERENCES ai.models(id) ON DELETE CASCADE,
    version_identifier TEXT NOT NULL,
    released_at TIMESTAMPTZ,
    deprecated_at TIMESTAMPTZ,
    context_limit BIGINT,
    max_output_tokens BIGINT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (model_id, version_identifier)
);

-- Capability Taxonomy
CREATE TABLE ai.capabilities (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    description TEXT,
    version TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Model-to-Capability M:N Map
CREATE TABLE ai.model_capabilities (
    model_id UUID NOT NULL REFERENCES ai.models(id) ON DELETE CASCADE,
    capability_id UUID NOT NULL REFERENCES ai.capabilities(id) ON DELETE CASCADE,
    support_level TEXT NOT NULL,
    score NUMERIC(5,4),
    confidence NUMERIC(5,4),
    evidence_count INTEGER NOT NULL DEFAULT 0,
    last_evaluated_at TIMESTAMPTZ,
    PRIMARY KEY (model_id, capability_id)
);
```

---

### 4.8 Resource Intelligence Domain

```sql
-- Credentials (KMS / Vault Reference Only)
CREATE TABLE resources.credentials (
    id UUID PRIMARY KEY,
    tenant_id UUID REFERENCES identity.tenants(id),
    provider_id UUID NOT NULL REFERENCES ai.providers(id),
    name TEXT NOT NULL,
    secret_reference TEXT NOT NULL,
    credential_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    last_validated_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Concrete Resource Instances (Provider, Model, Credential)
CREATE TABLE resources.resources (
    id UUID PRIMARY KEY,
    tenant_id UUID REFERENCES identity.tenants(id),
    provider_id UUID NOT NULL REFERENCES ai.providers(id),
    model_id UUID NOT NULL REFERENCES ai.models(id),
    model_version_id UUID REFERENCES ai.model_versions(id),
    credential_id UUID REFERENCES resources.credentials(id),
    status TEXT NOT NULL DEFAULT 'active',
    region TEXT,
    endpoint TEXT,
    priority INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Resource Runtime Capability Constraints
CREATE TABLE resources.resource_capabilities (
    resource_id UUID NOT NULL REFERENCES resources.resources(id) ON DELETE CASCADE,
    capability_id UUID NOT NULL REFERENCES ai.capabilities(id),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    limitations JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (resource_id, capability_id)
);

-- Quota Tracking
CREATE TABLE resources.resource_quotas (
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

-- Consumption Accounting
CREATE TABLE resources.resource_usage (
    id UUID PRIMARY KEY,
    resource_id UUID NOT NULL REFERENCES resources.resources(id),
    task_id UUID REFERENCES tasks.tasks(id),
    execution_id UUID,
    attempt_id UUID,
    metric TEXT NOT NULL,
    amount NUMERIC(20,6) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Real-Time Health & Circuit Breaker
CREATE TABLE resources.resource_health (
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

-- Logical Reservations
CREATE TABLE resources.resource_reservations (
    id UUID PRIMARY KEY,
    resource_id UUID NOT NULL REFERENCES resources.resources(id),
    task_id UUID NOT NULL REFERENCES tasks.tasks(id),
    step_id UUID,
    estimated_requests BIGINT,
    estimated_tokens BIGINT,
    status TEXT NOT NULL DEFAULT 'reserved',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

### 4.9 Truth & Validation Domain

```sql
-- Validations
CREATE TABLE validation.validations (
    id UUID PRIMARY KEY,
    task_id UUID REFERENCES tasks.tasks(id),
    execution_id UUID REFERENCES execution.executions(id),
    step_execution_id UUID,
    target_type TEXT NOT NULL,
    target_id UUID NOT NULL,
    validator_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    confidence NUMERIC(5,4),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Validation Rules
CREATE TABLE validation.validation_rules (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    definition JSONB NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    severity TEXT NOT NULL DEFAULT 'error',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (name, version)
);

-- Validation Rule Results
CREATE TABLE validation.validation_results (
    id UUID PRIMARY KEY,
    validation_id UUID NOT NULL REFERENCES validation.validations(id) ON DELETE CASCADE,
    rule_id UUID REFERENCES validation.validation_rules(id),
    status TEXT NOT NULL,
    score NUMERIC(5,4),
    confidence NUMERIC(5,4),
    details JSONB NOT NULL DEFAULT '{}',
    evidence_refs JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Extracted Claims
CREATE TABLE validation.claims (
    id UUID PRIMARY KEY,
    task_id UUID REFERENCES tasks.tasks(id),
    artifact_id UUID REFERENCES artifacts.artifacts(id),
    text TEXT NOT NULL,
    claim_type TEXT NOT NULL,
    source_type TEXT,
    source_id UUID,
    confidence NUMERIC(5,4),
    status TEXT NOT NULL DEFAULT 'unverified',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Supporting Evidence
CREATE TABLE validation.evidence (
    id UUID PRIMARY KEY,
    claim_id UUID NOT NULL REFERENCES validation.claims(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    artifact_id UUID REFERENCES artifacts.artifacts(id),
    location JSONB,
    excerpt_ref TEXT,
    strength NUMERIC(5,4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Disputes
CREATE TABLE validation.disputes (
    id UUID PRIMARY KEY,
    task_id UUID REFERENCES tasks.tasks(id),
    subject_type TEXT NOT NULL,
    subject_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);
```

---

### 4.10 Evaluation, Benchmarks & Reputation Domain

```sql
-- Holistic Evaluations
CREATE TABLE evaluation.evaluations (
    id UUID PRIMARY KEY,
    task_id UUID REFERENCES tasks.tasks(id),
    execution_id UUID REFERENCES execution.executions(id),
    evaluator_type TEXT NOT NULL,
    status TEXT NOT NULL,
    overall_score NUMERIC(5,4),
    confidence NUMERIC(5,4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE evaluation.evaluation_metrics (
    id UUID PRIMARY KEY,
    evaluation_id UUID NOT NULL REFERENCES evaluation.evaluations(id) ON DELETE CASCADE,
    metric TEXT NOT NULL,
    score NUMERIC(5,4),
    weight NUMERIC(5,4),
    evidence_refs JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Benchmarks
CREATE TABLE evaluation.benchmarks (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    domain TEXT,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (slug, version)
);

CREATE TABLE evaluation.benchmark_cases (
    id UUID PRIMARY KEY,
    benchmark_id UUID NOT NULL REFERENCES evaluation.benchmarks(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    difficulty NUMERIC(5,4),
    input_artifact_id UUID REFERENCES artifacts.artifacts(id),
    expected_output_artifact_id UUID REFERENCES artifacts.artifacts(id),
    validation_strategy JSONB,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE evaluation.benchmark_runs (
    id UUID PRIMARY KEY,
    benchmark_id UUID NOT NULL REFERENCES evaluation.benchmarks(id),
    model_id UUID REFERENCES ai.models(id),
    resource_id UUID REFERENCES resources.resources(id),
    version INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE evaluation.benchmark_results (
    id UUID PRIMARY KEY,
    benchmark_run_id UUID NOT NULL REFERENCES evaluation.benchmark_runs(id) ON DELETE CASCADE,
    benchmark_case_id UUID NOT NULL REFERENCES evaluation.benchmark_cases(id),
    output_artifact_id UUID REFERENCES artifacts.artifacts(id),
    score NUMERIC(5,4),
    confidence NUMERIC(5,4),
    latency_ms BIGINT,
    input_tokens BIGINT,
    output_tokens BIGINT,
    validation_id UUID REFERENCES validation.validations(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reputation
CREATE TABLE reputation.reputation_profiles (
    id UUID PRIMARY KEY,
    subject_type TEXT NOT NULL,
    subject_id UUID NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    overall_score NUMERIC(5,4),
    confidence NUMERIC(5,4),
    sample_size BIGINT NOT NULL DEFAULT 0,
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (subject_type, subject_id)
);

CREATE TABLE reputation.reputation_scores (
    id UUID PRIMARY KEY,
    profile_id UUID NOT NULL REFERENCES reputation.reputation_profiles(id) ON DELETE CASCADE,
    dimension TEXT NOT NULL,
    task_subtype TEXT,
    score NUMERIC(5,4),
    confidence NUMERIC(5,4),
    sample_size BIGINT NOT NULL DEFAULT 0,
    decay_factor NUMERIC(8,6),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (profile_id, dimension, task_subtype)
);

CREATE TABLE reputation.reputation_evidence (
    id UUID PRIMARY KEY,
    reputation_score_id UUID NOT NULL REFERENCES reputation.reputation_scores(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,
    source_id UUID NOT NULL,
    weight NUMERIC(8,6),
    contribution NUMERIC(8,6),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reputation.reputation_snapshots (
    id UUID PRIMARY KEY,
    subject_type TEXT NOT NULL,
    subject_id UUID NOT NULL,
    scores JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

### 4.11 System, Outbox & Idempotency Domain

```sql
-- Canonical Immutable Event Store (Historical Fact Log)
CREATE TABLE system.events (
    id UUID PRIMARY KEY,
    tenant_id UUID REFERENCES identity.tenants(id),
    project_id UUID REFERENCES projects.projects(id),
    event_type TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id UUID NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    actor_type TEXT,
    actor_id UUID,
    correlation_id UUID,
    causation_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Transactional Outbox Delivery Queue (Ephemeral Delivery Buffer - ADR-095)
CREATE TABLE system.outbox_events (
    id UUID PRIMARY KEY,
    event_id UUID NOT NULL UNIQUE REFERENCES system.events(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id UUID NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    headers JSONB NOT NULL DEFAULT '{}',
    published_at TIMESTAMPTZ, -- Populated by Outbox Worker after publish
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent Consumer Deduplication Ledger (ADR-036 / ADR-095)
CREATE TABLE system.event_consumptions (
    consumer_name TEXT NOT NULL,
    event_id UUID NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (consumer_name, event_id)
);

-- Audit Logs
CREATE TABLE system.audit_logs (
    id UUID PRIMARY KEY,
    tenant_id UUID REFERENCES identity.tenants(id),
    actor_id UUID,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id UUID NOT NULL,
    before_state JSONB,
    after_state JSONB,
    ip_hash TEXT,
    user_agent_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- System Policies
CREATE TABLE system.policies (
    id UUID PRIMARY KEY,
    tenant_id UUID REFERENCES identity.tenants(id),
    project_id UUID REFERENCES projects.projects(id),
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    rules JSONB NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- API Idempotency Keys
CREATE TABLE system.idempotency_keys (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES identity.tenants(id),
    key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response JSONB,
    status TEXT NOT NULL DEFAULT 'processing',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, key)
);
```

---

## 5. Indexing Strategy

To guarantee low latency without indexing bloat:

```sql
-- Tasks
CREATE INDEX idx_tasks_tenant ON tasks.tasks(tenant_id);
CREATE INDEX idx_tasks_project ON tasks.tasks(project_id);
CREATE INDEX idx_tasks_status ON tasks.tasks(status);
CREATE INDEX idx_tasks_created_at ON tasks.tasks(created_at DESC);
CREATE INDEX idx_tasks_active ON tasks.tasks(status)
WHERE status IN ('pending', 'analyzing', 'planning', 'ready', 'running', 'waiting', 'validating');

-- Executions, Attempts & Work Queue (ADR-094)
CREATE INDEX idx_executions_task ON execution.executions(task_id);
CREATE INDEX idx_executions_status ON execution.executions(status);
CREATE INDEX idx_step_executions_execution ON execution.step_executions(execution_id);
CREATE INDEX idx_step_executions_queue ON execution.step_executions(priority DESC, available_at ASC)
WHERE status = 'pending'; -- High-throughput Work Queue Claiming (FOR UPDATE SKIP LOCKED)
CREATE INDEX idx_step_executions_reaper ON execution.step_executions(lease_expires_at)
WHERE status = 'running'; -- Automated Lease Reaper Index
CREATE INDEX idx_attempts_step_execution ON execution.execution_attempts(step_execution_id);
CREATE INDEX idx_attempts_resource ON execution.execution_attempts(resource_id);
CREATE INDEX idx_side_effect_receipts_key ON execution.side_effect_receipts(effect_key); -- ADR-096 Idempotency

-- Resources & Health
CREATE INDEX idx_resources_provider ON resources.resources(provider_id);
CREATE INDEX idx_resources_model ON resources.resources(model_id);
CREATE INDEX idx_resources_status ON resources.resources(status);
CREATE INDEX idx_resource_quota_resource ON resources.resource_quotas(resource_id);
CREATE INDEX idx_resource_usage_resource_time ON resources.resource_usage(resource_id, timestamp DESC);
CREATE INDEX idx_resource_health_observed ON resources.resource_health(observed_at DESC);

-- Events & Outbox (ADR-095)
CREATE INDEX idx_events_aggregate ON system.events(aggregate_type, aggregate_id, created_at);
CREATE INDEX idx_events_correlation ON system.events(correlation_id);
CREATE INDEX idx_events_created_at ON system.events(created_at DESC);
CREATE INDEX idx_outbox_unpublished ON system.outbox_events(created_at)
WHERE published_at IS NULL; -- Partial Index for Fast Domain Outbox Dispatching
```

---

## 6. Transaction Boundaries & Critical Operational Invariants

### 6.1 Absolute Database Invariant: No Transactions Across External Calls (ADR-024)
> **FORBIDDEN:**
> `BEGIN → Call External AI Provider API (network wait) → COMMIT`  
> **MANDATORY:**
> All database transactions must complete before initiating an outbound HTTP request, and a new transaction is opened to record results.

### 6.2 Transaction Boundary Scenarios

#### Scenario 1: Atomic Task Creation
```text
BEGIN;
  INSERT INTO tasks.tasks (...);
  INSERT INTO tasks.task_policies (...);
  INSERT INTO tasks.task_inputs (...);
  INSERT INTO tasks.task_requirements (...);
  INSERT INTO system.events (event_type = 'TASK_CREATED', ...);
COMMIT;
```

#### Scenario 2: Plan Activation
```text
BEGIN;
  UPDATE planning.execution_plans SET status = 'active', activated_at = now() WHERE id = $plan_id;
  UPDATE tasks.tasks SET current_plan_id = $plan_id, status = 'ready' WHERE id = $task_id;
  INSERT INTO system.events (event_type = 'PLAN_ACTIVATED', ...);
COMMIT;
```

#### Scenario 3: Attempt Completion
```text
BEGIN;
  INSERT INTO artifacts.artifacts (...);
  UPDATE execution.execution_attempts SET status = 'success', completed_at = now() WHERE id = $attempt_id;
  UPDATE execution.step_executions SET status = 'completed' WHERE id = $step_exec_id;
  INSERT INTO resources.resource_usage (...);
  INSERT INTO execution.checkpoints (...);
  INSERT INTO system.events (event_type = 'STEP_COMPLETED', ...);
COMMIT;
```

#### Scenario 4: Quota Exhaustion & Migration (State Transition)
```text
BEGIN;
  UPDATE execution.execution_attempts SET status = 'quota_exhausted' WHERE id = $attempt_id;
  INSERT INTO execution.execution_errors (category = 'quota', migratable = TRUE, ...);
  INSERT INTO execution.checkpoints (...); -- Durable state freeze
  UPDATE resources.resource_reservations SET status = 'released' WHERE id = $reservation_id;
  INSERT INTO execution.handoffs (from_resource_id = $res_a, to_resource_id = $res_b, ...);
  INSERT INTO resources.resource_reservations (resource_id = $res_b, ...);
  INSERT INTO system.events (event_type = 'RESOURCE_MIGRATED', ...);
COMMIT;
-- Note: Worker triggers Provider B API call OUTSIDE this transaction.
```

---

## 7. Concurrency Control & Row-Level Locking

1. **Logical Quota Reservations:**
   When allocating quota capacity, workers avoid race conditions using row-level locking:
   ```sql
   SELECT remaining_value FROM resources.resource_quotas
   WHERE resource_id = $resource_id AND quota_type = $quota_type
   FOR UPDATE;
   ```
2. **Optimistic Locking:**
   Core entities (`tasks`, `executions`, `resources`) will support an incrementing `version INTEGER NOT NULL DEFAULT 1` column to prevent stale workers from overwriting newer state.

---

## 8. Architectural Decisions Enshrined

- **ADR-022 (Selective ENUM vs. Relational Catalogs):** Native ENUMs restricted to closed lifecycles (`tasks.task_status`). Capabilities, providers, and models use dynamic relational tables.
- **ADR-023 (Cryptographic Secret Isolation):** Raw API keys and credentials are never stored in plaintext in the database.
- **ADR-024 (Zero Long-Lived Transactions Across Network):** Database transactions are decoupled entirely from outbound AI provider latency.
- **ADR-025 (Partial Index for Outbox Polling):** Partial index on `system.events(created_at) WHERE published_at IS NULL` guarantees high-performance outbox dispatching without table scans.
- **ADR-026 (Explicit Foreign Key Graph):** Comprehensive foreign keys with selective `ON DELETE CASCADE` on tightly owned sub-entities (e.g. `task_inputs`, `plan_steps`) and restrictive keys on shared resources.
- **ADR-027 (Client Idempotency Enforcement):** `system.idempotency_keys` prevents double submission and replay of API requests.
- **ADR-028 (Logical vs. Vendor Quotas):** System acknowledges that quota reservations are internal logical estimations and cannot guarantee vendor-side capacity without vendor cooperation.
- **ADR-093 (Core Runtime):** TypeScript / Node.js Modular Monolith with strict typing.
- **ADR-094 (MVP Execution Work Queue):** Workers claim work directly from `execution.step_executions` via `FOR UPDATE SKIP LOCKED`.
- **ADR-095 (Dedicated Outbox & Consumption Tables):** `system.outbox_events` provides an ephemeral transactional buffer for immutable domain events; `system.event_consumptions` enforces consumer deduplication.
- **ADR-096 (Side Effect Receipts):** `execution.side_effect_receipts` enforces unique `effect_key` constraint for non-generative external mutations.

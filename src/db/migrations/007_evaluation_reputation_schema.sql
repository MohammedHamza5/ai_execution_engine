-- Milestone M5 Database Migration 007
-- Enforces evaluation and reputation schemas from ADR-018 and DATABASE_SCHEMA.md Section 4.10

CREATE SCHEMA IF NOT EXISTS evaluation;
CREATE SCHEMA IF NOT EXISTS reputation;

-- Holistic Evaluations
CREATE TABLE IF NOT EXISTS evaluation.evaluations (
    id UUID PRIMARY KEY,
    task_id UUID REFERENCES tasks.tasks(id) ON DELETE CASCADE,
    execution_id UUID REFERENCES execution.executions(id) ON DELETE CASCADE,
    evaluator_type TEXT NOT NULL,
    status TEXT NOT NULL,
    overall_score NUMERIC(5,4),
    confidence NUMERIC(5,4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evaluation.evaluation_metrics (
    id UUID PRIMARY KEY,
    evaluation_id UUID NOT NULL REFERENCES evaluation.evaluations(id) ON DELETE CASCADE,
    metric TEXT NOT NULL,
    score NUMERIC(5,4),
    weight NUMERIC(5,4),
    evidence_refs JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Benchmarks
CREATE TABLE IF NOT EXISTS evaluation.benchmarks (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    domain TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (slug, version)
);

CREATE TABLE IF NOT EXISTS evaluation.benchmark_cases (
    id UUID PRIMARY KEY,
    benchmark_id UUID NOT NULL REFERENCES evaluation.benchmarks(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    difficulty NUMERIC(5,4) NOT NULL DEFAULT 0.50,
    input_payload JSONB NOT NULL DEFAULT '{}',
    expected_output_payload JSONB DEFAULT '{}',
    validation_strategy JSONB NOT NULL DEFAULT '{}',
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evaluation.benchmark_runs (
    id UUID PRIMARY KEY,
    benchmark_id UUID NOT NULL REFERENCES evaluation.benchmarks(id) ON DELETE CASCADE,
    model_id UUID REFERENCES ai.models(id) ON DELETE CASCADE,
    resource_id UUID REFERENCES resources.resources(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    is_simulated BOOLEAN NOT NULL DEFAULT false,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evaluation.benchmark_results (
    id UUID PRIMARY KEY,
    benchmark_run_id UUID NOT NULL REFERENCES evaluation.benchmark_runs(id) ON DELETE CASCADE,
    benchmark_case_id UUID NOT NULL REFERENCES evaluation.benchmark_cases(id),
    output_artifact_id UUID REFERENCES artifacts.artifacts(id),
    raw_output TEXT,
    score NUMERIC(5,4),
    confidence NUMERIC(5,4),
    latency_ms BIGINT,
    input_tokens BIGINT,
    output_tokens BIGINT,
    is_correct BOOLEAN NOT NULL DEFAULT false,
    validation_details JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reputation
CREATE TABLE IF NOT EXISTS reputation.reputation_profiles (
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

CREATE TABLE IF NOT EXISTS reputation.reputation_scores (
    id UUID PRIMARY KEY,
    profile_id UUID NOT NULL REFERENCES reputation.reputation_profiles(id) ON DELETE CASCADE,
    dimension TEXT NOT NULL,
    task_subtype TEXT,
    score NUMERIC(5,4),
    confidence NUMERIC(5,4),
    sample_size BIGINT NOT NULL DEFAULT 0,
    alpha NUMERIC(10,4) NOT NULL DEFAULT 2.0,
    beta NUMERIC(10,4) NOT NULL DEFAULT 2.0,
    decay_factor NUMERIC(8,6) NOT NULL DEFAULT 1.0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (profile_id, dimension, task_subtype)
);

CREATE TABLE IF NOT EXISTS reputation.reputation_evidence (
    id UUID PRIMARY KEY,
    reputation_score_id UUID NOT NULL REFERENCES reputation.reputation_scores(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,
    source_id UUID NOT NULL,
    weight NUMERIC(8,6),
    contribution NUMERIC(8,6),
    is_simulated BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reputation.reputation_snapshots (
    id UUID PRIMARY KEY,
    subject_type TEXT NOT NULL,
    subject_id UUID NOT NULL,
    scores JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_benchmarks_domain ON evaluation.benchmarks(domain);
CREATE INDEX IF NOT EXISTS idx_benchmark_runs_resource ON evaluation.benchmark_runs(resource_id);
CREATE INDEX IF NOT EXISTS idx_benchmark_runs_model ON evaluation.benchmark_runs(model_id);
CREATE INDEX IF NOT EXISTS idx_benchmark_results_run ON evaluation.benchmark_results(benchmark_run_id);
CREATE INDEX IF NOT EXISTS idx_reputation_profiles_subject ON reputation.reputation_profiles(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_reputation_scores_profile ON reputation.reputation_scores(profile_id);
CREATE INDEX IF NOT EXISTS idx_reputation_scores_dim_task ON reputation.reputation_scores(dimension, task_subtype);

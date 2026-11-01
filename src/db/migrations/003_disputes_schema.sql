-- ============================================================================
-- Migration 003: Multi-Model Disputes & Positions (Milestone M3 Batch C)
-- ============================================================================

CREATE TABLE IF NOT EXISTS validation.disputes (
    id UUID PRIMARY KEY,
    collaboration_run_id UUID REFERENCES execution.collaboration_runs(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES tasks.tasks(id) ON DELETE CASCADE,
    subject_type TEXT NOT NULL,
    subject_id UUID,
    status TEXT NOT NULL DEFAULT 'open',
    resolved_by TEXT,
    winning_branch_key TEXT,
    winning_artifact_id UUID REFERENCES artifacts.artifacts(id) ON DELETE SET NULL,
    resolution_rationale TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS validation.dispute_positions (
    id UUID PRIMARY KEY,
    dispute_id UUID NOT NULL REFERENCES validation.disputes(id) ON DELETE CASCADE,
    branch_key TEXT NOT NULL,
    model_id UUID REFERENCES ai.models(id) ON DELETE SET NULL,
    artifact_id UUID REFERENCES artifacts.artifacts(id) ON DELETE SET NULL,
    claim_text TEXT NOT NULL,
    confidence NUMERIC(5,4),
    deterministic_score NUMERIC(5,4) NOT NULL DEFAULT 0,
    evidence_score NUMERIC(5,4) NOT NULL DEFAULT 0,
    is_winner BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_disputes_collab ON validation.disputes(collaboration_run_id);
CREATE INDEX IF NOT EXISTS idx_dispute_positions_dispute ON validation.dispute_positions(dispute_id);

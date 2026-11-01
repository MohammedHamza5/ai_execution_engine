-- ============================================================================
-- Migration 002: Multi-Model Collaboration Runs & Branches (Milestone M3)
-- ============================================================================

CREATE TABLE IF NOT EXISTS execution.collaboration_runs (
    id UUID PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES tasks.tasks(id) ON DELETE CASCADE,
    execution_id UUID NOT NULL REFERENCES execution.executions(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES planning.execution_plans(id) ON DELETE CASCADE,
    strategy TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'CREATED',
    completion_policy JSONB NOT NULL DEFAULT '{}',
    objective TEXT NOT NULL,
    branch_count INTEGER NOT NULL DEFAULT 0,
    synthesis_artifact_id UUID REFERENCES artifacts.artifacts(id),
    result_artifact_id UUID REFERENCES artifacts.artifacts(id),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS execution.collaboration_branches (
    id UUID PRIMARY KEY,
    collaboration_run_id UUID NOT NULL REFERENCES execution.collaboration_runs(id) ON DELETE CASCADE,
    branch_key TEXT NOT NULL,
    role TEXT NOT NULL,
    step_execution_id UUID NOT NULL REFERENCES execution.step_executions(id) ON DELETE CASCADE,
    resource_id UUID NOT NULL REFERENCES resources.resources(id) ON DELETE CASCADE,
    model_id UUID NOT NULL REFERENCES ai.models(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    output_artifact_id UUID REFERENCES artifacts.artifacts(id) ON DELETE SET NULL,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (collaboration_run_id, branch_key)
);

CREATE INDEX IF NOT EXISTS idx_collab_runs_task ON execution.collaboration_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_collab_branches_run ON execution.collaboration_branches(collaboration_run_id);
CREATE INDEX IF NOT EXISTS idx_collab_branches_step ON execution.collaboration_branches(step_execution_id);

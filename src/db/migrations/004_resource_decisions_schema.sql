-- ============================================================================
-- Migration 004: Resource Decisions Schema (Milestone M4 Batch B)
-- Enforces ADR-076 Explainable Routing Traces & Decision Persistence
-- ============================================================================

CREATE TABLE IF NOT EXISTS resources.resource_decisions (
    id UUID PRIMARY KEY,
    task_id UUID REFERENCES tasks.tasks(id) ON DELETE CASCADE,
    execution_id UUID REFERENCES execution.executions(id) ON DELETE CASCADE,
    step_execution_id UUID REFERENCES execution.step_executions(id) ON DELETE CASCADE,
    decision_type TEXT NOT NULL, -- 'SELECT_RESOURCE', 'WAIT', 'MIGRATE', 'FAIL', 'REQUEST_APPROVAL'
    selected_resource_id UUID REFERENCES resources.resources(id) ON DELETE SET NULL,
    candidate_count INTEGER NOT NULL DEFAULT 0,
    eligible_count INTEGER NOT NULL DEFAULT 0,
    excluded_count INTEGER NOT NULL DEFAULT 0,
    decision_payload JSONB NOT NULL DEFAULT '{}',
    reasons JSONB NOT NULL DEFAULT '[]',
    policy_context JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resource_decisions_task ON resources.resource_decisions(task_id);
CREATE INDEX IF NOT EXISTS idx_resource_decisions_step ON resources.resource_decisions(step_execution_id);

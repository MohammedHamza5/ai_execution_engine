-- ============================================================================
-- Migration 005: Operational Resource Intelligence (Milestone M4 Batch C)
-- Enforces Health Tracking, Circuit Breakers, Quota Reconciliation, and Rate Limits
-- ============================================================================

-- 1. Enhance resource_health with circuit breaker and cooldown tracking
ALTER TABLE resources.resource_health
    ADD COLUMN IF NOT EXISTS circuit_state TEXT NOT NULL DEFAULT 'CLOSED', -- 'CLOSED', 'OPEN', 'HALF_OPEN'
    ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cooldown_until TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_failure_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_failure_reason TEXT;

-- 2. Enhance resource_reservations with actual usage reconciliation
ALTER TABLE resources.resource_reservations
    ADD COLUMN IF NOT EXISTS actual_tokens BIGINT,
    ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS step_execution_id UUID;

-- 3. Indexes for fast lookup during high-concurrency reservation & health checks
CREATE INDEX IF NOT EXISTS idx_resource_health_circuit ON resources.resource_health(circuit_state, cooldown_until);
CREATE INDEX IF NOT EXISTS idx_resource_reservations_status ON resources.resource_reservations(resource_id, status);
CREATE INDEX IF NOT EXISTS idx_resource_quotas_resource ON resources.resource_quotas(resource_id, quota_type);

# AI Execution Engine — Event Model Specification

**Document:** `EVENT_MODEL.md`  
**Status:** COMPLETE (Event-Driven State Transition Baseline)  
**Version:** 1.0.0  
**Authority:** Derived from Event Model v1.0 Material  

---

## 1. Purpose

The Event Model provides the authoritative contract governing how the AI Execution Engine transitions state over time. It answers three fundamental questions for every operational occurrence:
1. **What happened?** (Historical, immutable Domain Event)
2. **Why did it happen?** (Correlation ID, Causation ID, and failure diagnostics)
3. **What happens next?** (Deterministic state transitions, commands, and consumer reactions)

### Core Event Principles
> **«Current State = Snapshot. Event = Historical Fact.»**  
> **«Command = Request to perform an action (Imperative: EXECUTE_STEP). Event = Fact that has already occurred (Past Tense: STEP_COMPLETED).»**  
> **«Transactional Outbox + At-Least-Once Delivery + Idempotent Consumers.»**

---

## 2. Responsibilities & System Boundaries

### 2.1 Responsibilities
- **Domain Event Taxonomy:** Exhaustive definitions of typed events across all 9 domain aggregates.
- **Event Envelope Contract:** Standardized JSON envelope schema with tracing, aggregate context, actor identity, and versioning.
- **State Transition Machine & Guards:** Formal transition rules enforcing valid paths (e.g. `RUNNING` → `STEP_FAILED` → `MIGRATING` → `RUNNING`).
- **Transactional Outbox Engine:** Guaranteed atomic persistence of state updates alongside outbox records, eliminating dual-write vulnerabilities.
- **Failure Choreography:** Deterministic event sequences for Quota Exhaustion (HTTP 429), Worker Crash recovery, and Validation disputes.
- **Idempotency & Deduplication:** Explicit consumer deduplication contracts via `system.event_consumptions`.

### 2.2 Non-Responsibilities
- The Event Model does **NOT** own message broker transport protocols (e.g. whether the message is delivered via internal polling, PostgreSQL `LISTEN/NOTIFY`, or Redis).
- It does **NOT** execute worker business logic.

---

## 3. Canonical Event Envelope (ADR-029)

Every domain event emitted within the system must adhere strictly to this canonical schema:

```json
{
  "event_id": "01924b61-7e8c-7f21-99c0-82a17bc38901",
  "event_type": "STEP_COMPLETED",
  "event_version": 1,
  "aggregate": {
    "type": "step_execution",
    "id": "01924b61-7e8c-7f21-99c0-82a17bc38902"
  },
  "tenant_id": "01924b61-7e8c-7f21-99c0-82a17bc38903",
  "project_id": "01924b61-7e8c-7f21-99c0-82a17bc38904",
  "task_id": "01924b61-7e8c-7f21-99c0-82a17bc38905",
  "execution_id": "01924b61-7e8c-7f21-99c0-82a17bc38906",
  "correlation_id": "01924b61-7e8c-7f21-99c0-82a17bc38907",
  "causation_id": "01924b61-7e8c-7f21-99c0-82a17bc38908",
  "actor": {
    "type": "worker",
    "id": "worker-pool-llm-01"
  },
  "occurred_at": "2026-10-07T02:40:00.123456Z",
  "payload": {}
}
```

### Envelope Field Specifications:
- `event_id`: UUIDv7, globally unique and strictly chronological.
- `event_type`: Formatted strictly as `NOUN_PAST_TENSE` (e.g. `TASK_CREATED`, `QUOTA_EXHAUSTED`).
- `event_version`: Integer starting at 1. Prevents breaking downstream consumers when payload contracts evolve (ADR-030).
- `aggregate`: Identifies the domain root entity (`task`, `plan`, `execution`, `step_execution`, `resource`, `artifact`, `validation`).
- `correlation_id`: Universal trace identifier propagated across the entire lifecycle from initial API request to completion.
- `causation_id`: The `event_id` or command ID that directly triggered this specific event.
- `actor`: Describes the initiating principal (`user`, `system`, `worker`, `provider`).

---

## 4. Command vs. Event Separation (ADR-031)

Commands represent requests for domain actions and may be rejected; Events represent immutable facts that have already occurred:

```text
COMMAND (Imperative Request)       DOMAIN EVENT (Past Tense Fact)
────────────────────────────       ──────────────────────────────
CREATE_TASK                  ──→   TASK_CREATED
ANALYZE_TASK                 ──→   TASK_ANALYZED
CREATE_PLAN                  ──→   PLAN_CREATED
VALIDATE_PLAN                ──→   PLAN_VALIDATED / PLAN_REJECTED
START_EXECUTION              ──→   EXECUTION_CREATED
START_STEP                   ──→   STEP_STARTED
EXECUTE_ATTEMPT              ──→   ATTEMPT_STARTED
RETRY_STEP                   ──→   STEP_RETRY_REQUESTED
MIGRATE_STEP                 ──→   RESOURCE_MIGRATED
CREATE_CHECKPOINT            ──→   CHECKPOINT_CREATED
START_VALIDATION             ──→   VALIDATION_STARTED
RESOLVE_DISPUTE              ──→   DISPUTE_RESOLVED
CANCEL_TASK                  ──→   TASK_CANCELLED
```

---

## 5. Domain Event Inventory & Payload Specifications

### 5.1 Task Events
- **`TASK_CREATED`**: Emitted upon task persistence via API.  
  *Payload:* `{ "task_type": "coding", "input_count": 2, "priority": 5 }`
- **`TASK_ANALYSIS_STARTED`**: Task Intelligence begins intent/capability parsing.  
  *Payload:* `{ "analyzer_version": "1.0.0" }`
- **`TASK_ANALYZED`**: Requirements, complexity, and capabilities identified.  
  *Payload:* `{ "intent": "extract_invoice", "complexity_score": 0.82, "quality_floor": 0.95, "required_capabilities": ["vision", "ocr", "structured_output"] }`
- **`TASK_ANALYSIS_FAILED`**: Fatal analysis error.  
  *Payload:* `{ "error_code": "UNSUPPORTED_INPUT", "retryable": false }`
- **`TASK_VALIDATION_STARTED`**: End-to-end task output validation initiated.
- **`TASK_COMPLETED`**: Final success gate satisfied.  
  *Payload:* `{ "execution_id": "...", "output_artifacts": ["..."], "quality_score": 0.96 }`
- **`TASK_FAILED`**: Unrecoverable execution termination.  
  *Payload:* `{ "reason": "no_viable_resource", "recoverable": false }`
- **`TASK_CANCELLED`**: Client or timeout requested cancellation.  
  *Payload:* `{ "cancelled_by": "user", "reason": "user_abort" }`

### 5.2 Planning Events
- **`PLAN_CREATED`**: Planner outputs candidate execution DAG.  
  *Payload:* `{ "plan_id": "...", "version": 1, "strategy": "specialist_pipeline", "step_count": 4 }`
- **`PLAN_VALIDATION_STARTED`**: Plan feasibility check begins.
- **`PLAN_VALIDATED`**: Plan passes resource and DAG checks.  
  *Payload:* `{ "quality_estimate": 0.94, "latency_estimate_ms": 12000, "cost_estimate": 0, "resource_feasible": true }`
- **`PLAN_REJECTED`**: Feasibility check failed; triggers replan.  
  *Payload:* `{ "reasons": ["insufficient_quota", "missing_capability"] }`
- **`PLAN_ACTIVATED`**: Plan becomes the authoritative active plan.
- **`PLAN_REVISED`**: Existing plan superseded due to runtime failure.  
  *Payload:* `{ "previous_plan_id": "...", "new_plan_id": "...", "reason": "resource_unavailable" }`

### 5.3 Execution Events
- **`EXECUTION_CREATED`**: Active execution instance spawned.
- **`STEP_READY`**: Step dependencies satisfied; queued for worker pickup.  
  *Payload:* `{ "step_id": "...", "step_key": "ocr_invoice" }`
- **`STEP_STARTED`**: Worker claimed step execution lease.  
  *Payload:* `{ "step_id": "...", "resource_id": "...", "model_id": "..." }`
- **`ATTEMPT_STARTED`**: Outbound network invocation to resource initiated.  
  *Payload:* `{ "attempt_id": "...", "attempt_number": 1, "resource_id": "..." }`
- **`ATTEMPT_COMPLETED`**: Response received successfully from provider adapter.  
  *Payload:* `{ "attempt_id": "...", "input_tokens": 5000, "output_tokens": 1200, "latency_ms": 2400 }`
- **`STEP_COMPLETED`**: Artifact generated and step finished.  
  *Payload:* `{ "step_id": "...", "artifact_ids": ["..."], "quality_score": 0.96 }`
- **`STEP_FAILED`**: Execution attempt failed.  
  *Payload:* `{ "step_id": "...", "attempt_id": "...", "error_id": "...", "retryable": true, "migratable": true }`
- **`STEP_RETRY_REQUESTED`**: Transient failure diagnostic triggers backoff retry.
- **`CHECKPOINT_CREATED`**: Durable snapshot frozen in DB.  
  *Payload:* `{ "checkpoint_id": "...", "sequence": 8, "completed_steps": ["step_1"], "pending_steps": ["step_2"] }`

### 5.4 Resource & Quota Events
- **`RESOURCE_HEALTH_CHANGED`**: Latency or error rate transition.  
  *Payload:* `{ "resource_id": "...", "previous_status": "healthy", "new_status": "degraded", "reason": "high_error_rate" }`
- **`RESOURCE_DEGRADED`**: Tripped initial circuit breaker threshold.
- **`RESOURCE_UNAVAILABLE`**: Circuit open due to 5xx or connection drops.
- **`RESOURCE_RECOVERED`**: Canary probe succeeded; returned to healthy.
- **`QUOTA_LOW`**: Warning threshold passed.  
  *Payload:* `{ "resource_id": "...", "quota_type": "output_tokens", "remaining": 12000, "safety_margin": 0.8 }`
- **`QUOTA_EXHAUSTED`**: Critical event; HTTP 429 received or quota zeroed.  
  *Payload:* `{ "resource_id": "...", "quota_type": "requests", "remaining": 0, "reset_at": "...", "provider_code": "429" }`
- **`RESOURCE_MIGRATION_REQUESTED`**: Execution engine requests replacement resource.
- **`RESOURCE_MIGRATED`**: Step successfully transferred to alternate provider.  
  *Payload:* `{ "from_resource_id": "...", "to_resource_id": "...", "step_id": "...", "reason": "quota_exhausted" }`
- **`RESOURCE_RESERVED` / `RELEASED` / `EXPIRED`**: Quota capacity tracking.

### 5.5 Artifact & Validation Events
- **`ARTIFACT_CREATED`**: Durable artifact committed to storage.  
  *Payload:* `{ "artifact_id": "...", "type": "structured_json", "size_bytes": 18200 }`
- **`ARTIFACT_VERSION_CREATED`**: Mutated artifact version committed.
- **`ARTIFACT_VALIDATED`**: Artifact verified by validation engine.
- **`VALIDATION_STARTED`**: Independent validator invoked.
- **`VALIDATION_PASSED`**: Target meets all rules and quality floor.  
  *Payload:* `{ "validation_id": "...", "confidence": 0.98, "methods": ["schema", "deterministic"] }`
- **`VALIDATION_FAILED`**: Verification rejection; triggers diagnostic repair.  
  *Payload:* `{ "validation_id": "...", "failed_rules": ["required_answer_missing"] }`
- **`DISPUTE_CREATED`**: Contradictory claims detected across models.
- **`DISPUTE_RESOLVED`**: Conclusive evidence arbitration finalized.

### 5.6 Evaluation, Reputation & System Events
- **`EVALUATION_STARTED` / `COMPLETED` / `FAILED`**: Holistic run scoring.
- **`REPUTATION_UPDATED`**: Model reputation score updated via evidence.  
  *Payload:* `{ "subject_type": "model", "subject_id": "...", "dimension": "arabic_reasoning", "old_score": 0.84, "new_score": 0.87 }`
- **`WORKER_STARTED` / `STOPPED` / `FAILED`**: Worker lifecycle tracking.
- **`CIRCUIT_OPENED` / `CIRCUIT_CLOSED`**: Circuit breaker state changes.

---

## 6. Mission-Critical State Transition Choreographies

### 6.1 Quota Exhaustion (HTTP 429) Choreography (ADR-032)
When an active worker encounters rate limits, the task is **never** failed or restarted from Step 1:

```text
Worker executing Step 3 (Model A)
  ↓
HTTP 429 returned by Provider Adapter
  ↓
EMIT: ATTEMPT_FAILED (attempt_number = 1, error_category = 'quota')
  ↓
EMIT: QUOTA_EXHAUSTED (resource = Model A, reset_at = ...)
  ↓
EMIT: CHECKPOINT_CREATED (Save completed Steps 1 & 2, pending Step 3)
  ↓
EMIT: RESOURCE_MIGRATION_REQUESTED (step_id = Step 3)
  ↓
Resource Intelligence selects Model B meeting Quality Floor
  ↓
EMIT: RESOURCE_MIGRATED (from = Model A, to = Model B)
  ↓
EMIT: ATTEMPT_STARTED (attempt_number = 2, resource = Model B)
  ↓
Model B succeeds → EMIT: ATTEMPT_COMPLETED
  ↓
EMIT: STEP_COMPLETED (Step 3 finished without restarting Task)
```

### 6.2 Worker Crash & Uncertain Outcome Recovery (ADR-033)
When a worker crashes while awaiting an outbound provider response:
1. Heartbeat expires in worker pool.
2. The attempt state is marked **`uncertain`** (never blindly retried immediately).
3. EMIT: **`RECOVERY_REQUIRED`**.
4. The Recovery Engine inspects:
   - Does the provider adapter support idempotency keys or status queries?
   - Can the side effect be safely re-executed without financial/state corruption?
5. If safe: Issue **`STEP_RETRY_REQUESTED`** with a new attempt.
6. If unsafe/unknown: Quarantine attempt and escalate to Diagnostic Replan.

### 6.3 Task Completion Gate (ADR-034)
A task transitions to `COMPLETED` if and only if all 5 conditions are satisfied:
```text
All Required DAG Steps Completed
               +
All Required Output Artifacts Persisted
               +
Independent Validation Passed (Quality >= Quality Floor)
               +
Zero Unresolved Critical Disputes
               +
Task Policy Constraints Satisfied
               ↓
     EMIT: TASK_COMPLETED
```

---

## 7. Reliability, Delivery & Outbox Contracts

### 7.1 Transactional Outbox Pattern (ADR-035)
To eliminate dual-write distributed transaction failures, domain events are never published directly to an external queue within the business transaction.

```sql
-- Concrete Outbox Table
CREATE TABLE system.outbox_events (
    id UUID PRIMARY KEY,
    event_id UUID NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id UUID NOT NULL,
    payload JSONB NOT NULL,
    correlation_id UUID,
    causation_id UUID,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### Outbox Publishing Flow:
1. **Business Transaction:**
   ```sql
   BEGIN;
     -- 1. Apply domain mutation (e.g. update step_execution)
     -- 2. Insert into system.events (Authoritative Event Store)
     -- 3. Insert into system.outbox_events (Delivery Queue)
   COMMIT;
   ```
2. **Outbox Worker:** Reads pending records (`WHERE published_at IS NULL AND available_at <= now()`), dispatches them to internal consumers or queue broker, and marks `published_at = now()`.

### 7.2 At-Least-Once Delivery & Consumer Deduplication (ADR-036)
- Message delivery is strictly **At-Least-Once**.
- All consumers must be strictly idempotent.
- Duplicate event arrivals are discarded using the consumption registry:

```sql
CREATE TABLE system.event_consumptions (
    consumer_name TEXT NOT NULL,
    event_id UUID NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (consumer_name, event_id)
);
```

### 7.3 Dead Letter Queue (DLQ) & Retry Policy
- Failing consumer invocations follow **Exponential Backoff with Full Jitter**:
  $$\text{Interval} = \min(\text{MaxInterval}, \text{BaseInterval} \times 2^{\text{attempt}}) \times \text{Uniform}(0.8, 1.2)$$
  Standard progression: `1s, 2s, 4s, 8s, 16s, 32s, 60s`.
- After maximum retry exhaustion (default: 5 attempts), the message is routed to the **Dead Letter Queue (DLQ)** with error metadata, preventing queue blockage.

### 7.4 Stream-Level Event Ordering
Ordering guarantees are enforced **per Aggregate Stream** (`aggregate_type` + `aggregate_id`), never globally across the entire system. Events for Task A execute in strict causal sequence without blocking Task B.

---

## 8. Architectural Decision Log (ADR-029 to ADR-036)

- **ADR-029 (Universal Event Envelope):** All domain events share a single envelope schema with UUIDv7, aggregate references, correlation/causation IDs, and actor provenance.
- **ADR-030 (Event Schema Versioning):** Payloads include `event_version` to allow additive backward-compatible contract migrations.
- **ADR-031 (Strict Command/Event Separation):** Commands express intent; Events express immutable completed facts.
- **ADR-032 (Zero Task Restart on Quota Failures):** Quota exhaustion triggers checkpointed provider migration, resuming execution from the current step attempt.
- **ADR-033 (Uncertain Worker Outcome Quarantine):** Worker crashes during outbound network calls enter an `uncertain` recovery state rather than blind retry.
- **ADR-034 (Multi-Condition Completion Gate):** Task completion requires step completion, artifact verification, dispute resolution, and policy satisfaction.
- **ADR-035 (Transactional Outbox Pattern):** Dual-write prevention guaranteed by writing events to PostgreSQL outbox tables within the business transaction.
- **ADR-036 (At-Least-Once Delivery + Idempotent Deduplication):** Consumer deduplication enforced via `system.event_consumptions`.
- **ADR-094 (Execution Queue vs Domain Event Outbox):** Ratifies that `system.outbox_events` is strictly the asynchronous domain event buffer, completely decoupled from the execution work queue (`execution.step_executions`).
- **ADR-095 (Dedicated Outbox & Consumer Tables):** Physical tables `system.outbox_events` and `system.event_consumptions` separate ephemeral event delivery buffers from the append-only `system.events` store.

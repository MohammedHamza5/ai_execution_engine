# AI Execution Engine — Queue & Worker Architecture Specification

**Document:** `QUEUE_WORKER_ARCHITECTURE.md`  
**Status:** COMPLETE (Execution Runtime & Distributed Worker Baseline)  
**Version:** 1.0.0  
**Authority:** Derived from Queue Worker Architecture v1.0 Material  

---

## 1. Purpose

This document defines how tasks transition from API intake to asynchronous execution, detailing the mechanics of the Work Queue, Scheduler, Worker Pool, Provider Adapters, and Validation Engine. It guarantees that:
- Tasks are durable and resilient to infrastructure failures.
- Worker crashes never destroy or corrupt execution progress.
- Concurrent workers never unintentionally execute or mutate the same step.
- Stale workers (zombie workers) cannot overwrite progress made by newer workers.
- Quota exhaustion migrates steps smoothly without restarting tasks from Step 1.
- Retries follow disciplined backoff rather than infinite loops.
- The queue is a disposable delivery layer that can be completely reconstructed from PostgreSQL.
- Message delivery is strictly At-Least-Once with effectively-once business side effects.

### Core Architecture Principle
> **«The Queue distributes work. PostgreSQL owns truth.»**  
> If Redis, RabbitMQ, or any message broker crashes or loses data, zero task state is lost. PostgreSQL is the authoritative system of record from which the active queue state is deterministically reconciled.

---

## 2. Responsibilities & System Boundaries

### 2.1 Component Responsibilities
- **API Layer:** Handles authentication, rate limiting, request validation, idempotency caching, and task creation. It **never** executes long-running LLM calls or retry loops synchronously.
- **PostgreSQL:** System of Record storing tasks, plans, step executions, attempts, artifacts, quotas, checkpoints, and outbox events.
- **Queue Layer:** A delivery mechanism signaling *"what work is ready now"*, storing lightweight pointers to work rather than full state.
- **Scheduler:** Evaluates step dependencies, priority, tenant fairness, and resource capacity to place ready work onto the queue. It **never** executes provider network calls.
- **Worker Runtime:** Claims leased work atomically, maintains heartbeats, dispatches to Provider Adapters, records immutable attempts/artifacts, and executes conditional completion transactions. Workers **never** make routing decisions or bypass Resource Intelligence.
- **Resource Intelligence:** Dynamically evaluates provider quotas, latencies, circuit breakers, and costs to select the optimal resource for each attempt.

---

## 3. High-Level Runtime Architecture

```text
                         CLIENT
                           │
                           ▼
                    ┌──────────────┐
                    │   API Layer  │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │  PostgreSQL  │  (Single Source of Truth)
                    │   DATABASE   │
                    └──────┬───────┘
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
        Task Mutation               Outbox Event
                                         │
                                         ▼
                                ┌─────────────────┐
                                │ Outbox Publisher│
                                └────────┬────────┘
                                         │
                                         ▼
                                ┌─────────────────┐
                                │   Work Queue    │  (PostgreSQL SKIP LOCKED for MVP)
                                └────────┬────────┘
                                         │
                                ┌────────┴────────┐
                                ▼                 ▼
                            Scheduler        Worker Pool
                                                  │
                 ┌────────────────────────────────┼────────────────────────────────┐
                 ▼                                ▼                                ▼
            LLM Worker                      Vision Worker                  Validation Worker
                 │                                │                                │
                 └────────────────────────────────┼────────────────────────────────┘
                                                  │
                                                  ▼
                                         Provider Adapters
                                                  │
                                                  ▼
                                            AI Providers
```

---

## 4. Worker Pool & Capability Taxonomy

Workers are organized into specialized pools (implemented as unified runtimes with a handler registry in the MVP):
- `llm`: General text generation, reasoning, and synthesis.
- `vision`: Multimodal image QA, OCR, diagram, and chart understanding.
- `audio`: Speech-to-text, audio analysis, and TTS.
- `video`: Temporal reasoning and video summarization.
- `embedding`: Vector embeddings and semantic reranking.
- `validation`: Deterministic schema checkers, compiler runners, test suites, and solvers.
- `tool`: Sandboxed code execution, web search, and API connectors.

### 4.1 Worker Capability Declaration
Upon startup, workers register their runtime profiles:
```json
{
  "worker_id": "worker-llm-01",
  "capabilities": ["llm", "vision", "structured_output"],
  "supported_operations": ["generate", "vision", "tool_call"],
  "max_concurrency": 5,
  "status": "healthy"
}
```

### 4.2 Worker Lifecycle State Machine
```text
[STARTING] → [REGISTERING] → [READY] ⇄ [BUSY] → [DRAINING] → [STOPPED]
                                │
                                ↓ (Heartbeat lost)
                             [STALE] → [LEASE_RECOVERY]
```

---

## 5. Work Claiming, Leases & Fencing Tokens

### 5.1 Lightweight Queue Message Pointer (ADR-037)
Queue messages store only pointers to work, never complete task payloads:
```json
{
  "message_id": "01924b61-...",
  "task_id": "01924b61-...",
  "step_id": "01924b61-...",
  "execution_id": "01924b61-...",
  "attempt_id": "01924b61-...",
  "priority": 5,
  "available_at": "2026-10-07T02:00:00Z"
}
```

### 5.2 Atomic Work Claim via `SKIP LOCKED` (ADR-038)
Workers claim pending work units using PostgreSQL row-level locking:
```sql
SELECT id, task_id, plan_step_id
FROM execution.step_executions
WHERE status = 'pending'
  AND available_at <= now()
ORDER BY priority DESC, available_at ASC
FOR UPDATE SKIP LOCKED
LIMIT 1;
```
Within the same transaction, the status transitions to `leased` with an assigned `fencing_token`.

### 5.3 Leases & Dynamic Duration
- Work is never owned indefinitely. Workers obtain a time-bounded **Lease** (default: 60s for simple LLM, 120s for Vision, 300s for large documents).
- Active workers extend their lease via a background **Heartbeat** (e.g. every 15s).
- If a heartbeat fails or the worker crashes, the lease expires naturally.

### 5.4 Fencing Tokens: Zombie Worker Protection (ADR-039)
To prevent network-delayed or frozen workers (zombies) from overwriting results after lease expiry:
1. Every claim increments a monotonic `fencing_token`.
2. Worker completions and state mutations must include the token in a conditional update:
   ```sql
   UPDATE execution.step_executions
   SET status = 'completed', updated_at = now()
   WHERE id = :step_execution_id
     AND fencing_token = :worker_token
     AND status = 'running';
   ```
3. If Worker 1 freezes, its lease expires, and Worker 2 claims with `token = 11`. When Worker 1 awakes with `token = 10`, its conditional update affects 0 rows and is rejected as `STALE_WORKER`.

---

## 6. Worker Execution Loop & Transaction Boundaries

### 6.1 Worker Main Loop
```text
while worker_running:
    work_item = claim_work()
    if work_item is None:
        sleep(backoff)
        continue

    start_heartbeat(work_item.lease_id)
    try:
        # Outbound call happens OUTSIDE database transactions (ADR-024)
        result = provider_adapter.execute(work_item)
        
        # Atomic Completion Transaction
        complete_work_transaction(work_item, result, fencing_token)
        ack_queue_message(work_item.message_id)  # ACK LAST! (ADR-040)
    except Exception as error:
        fail_work_transaction(work_item, error, fencing_token)
        ack_queue_message(work_item.message_id)
    finally:
        stop_heartbeat()
```

### 6.2 Transaction Rules: ACK Last (ADR-040)
- **Mandatory Invariant:** The database transaction must commit successfully **BEFORE** acknowledging the queue message.
- If a worker crashes after DB commit but before ACK, the message is redelivered; the worker’s conditional idempotency check detects the step is already completed and safely discards the message without duplicating work.

---

## 7. Failure Classification, Retries & Quota Migration

### 7.1 Failure Classification Matrix
Errors from Provider Adapters are classified into standardized recovery actions:

| Error Category | Example | Immediate Action | Recovery Strategy |
| :--- | :--- | :--- | :--- |
| **TRANSIENT** | Network socket drop, 503 Overload | Backoff retry | Retry same or alternate resource |
| **RATE_LIMIT / QUOTA** | HTTP 429, daily tokens zeroed | Checkpoint state | Migrate to alternate resource (Attempt N+1) |
| **CAPABILITY** | Image rejected on text model | Do not retry | Replan / Route to vision-capable resource |
| **AUTH** | HTTP 401, Invalid API key | Disable Credential | Flag credential as revoked; alert operator |
| **CONTEXT** | Token limit exceeded | Do not blind retry | Chunk, compress, or migrate to large-context model |
| **INVALID_OUTPUT** | Malformed JSON, missing fields | Repair attempt | Targeted repair prompt or schema-guided retry |
| **QUALITY** | Critic rejection, low validation score | Diagnose failure | Targeted repair step or strategy escalation |
| **UNKNOWN** | Timeout with ambiguous dispatch | Quarantine | Check status / safe idempotent retry |

### 7.2 Exponential Backoff with Full Jitter (ADR-041)
Retries for transient errors apply exponential backoff with full jitter to eliminate the thundering herd problem:
$$\text{Delay} = \text{Uniform}(0.8, 1.2) \times \min(\text{MaxDelay}, \text{BaseDelay} \times 2^{\text{attempt}})$$
Default sequence: `2s, 5s, 15s, 30s, 60s`.

### 7.3 Resource Migration Contract (ADR-042)
When a step encounters HTTP 429 / Quota Exhaustion:
1. `Attempt N` is marked `failed (quota_exhausted)`.
2. A `Checkpoint` durable snapshot is ACID-persisted in PostgreSQL.
3. Resource Intelligence selects an alternate compatible resource meeting the `Quality Floor`.
4. `Attempt N+1` is spawned under the **same logical Step Execution**.
5. Execution resumes seamlessly without restarting the task from Step 1.

```json
{
  "step_id": "01924b61-step3",
  "previous_attempt": "attempt_1",
  "reason": "quota_exhausted",
  "preserved_artifacts": ["partial_ocr.json"],
  "required_capabilities": ["ocr", "document_understanding"],
  "quality_floor": 0.95,
  "new_resource": "resource_google_gemini_flash"
}
```

---

## 8. Scheduling, Concurrency & Fairness

### 8.1 Multi-Dimensional Scheduling Score
The Scheduler evaluates pending work based on priority, latency targets, and runtime availability:
$$\text{Score} = w_p \cdot \text{Priority} + w_a \cdot \text{Age} + w_d \cdot \text{Deadline} + w_r \cdot \text{ResourceFit} - w_c \cdot \text{Congestion}$$

### 8.2 Tenant Concurrency & Fairness (ADR-043)
- Multi-tenant workloads use **Per-Tenant Concurrency Limits** (e.g. Tenant A cannot consume more than 20 concurrent worker leases).
- Prevents a burst of 10,000 tasks from Tenant A from starving Tenant B's interactive tasks.

### 8.3 Global Provider Concurrency Limits (ADR-044)
- Provider accounts enforce upstream rate limits (e.g. 10 concurrent requests max).
- Resource Intelligence enforces provider-level semaphores to prevent worker pools from flooding a single provider and inducing artificial 429 cascades.

### 8.4 Backpressure & Prefetch Limits
- Workers enforce a strict bounded prefetch (default: `prefetch = max_concurrency`, typically 1–5).
- Workers never hoard queue items in memory.

---

## 9. Fault Recovery & Self-Healing Processes

### 9.1 Lease Reaper Process (ADR-045)
An independent background process continuously inspects active leases:
```sql
SELECT id FROM execution.step_executions
WHERE status = 'running'
  AND lease_expires_at < now();
```
- Reaps expired leases, transitions status to `lease_expired`, and emits `STEP_RETRY_REQUESTED`.
- Ensures dead workers are detected automatically without relying on dead workers to report their demise.

### 9.2 Queue Reconciliation Worker (ADR-046)
If the queue broker crashes or drops messages:
- A periodic reconciliation loop queries PostgreSQL for work units that are in `ready` or `retry_wait (available_at <= now())` status but lack active leases.
- Re-enqueues orphaned work items safely.
- **Guarantee:** The Queue can always be rebuilt from PostgreSQL.

### 9.3 Dead Letter Queue (DLQ) & Operator Replay (ADR-047)
- Tasks exhausting maximum attempts (default: 5) transition to `DEAD_LETTER`.
- Full audit context is preserved (task, step, attempt history, error stack, last resource).
- Replays are strictly operator-controlled and audited; automatic infinite replay is forbidden.

### 9.4 Graceful Shutdown (`DRAINING`)
Upon receiving `SIGTERM` / `SIGINT`:
1. Worker status transitions to `DRAINING`.
2. Worker stops claiming new work items.
3. Existing active attempts are allowed to complete up to a shutdown timeout (e.g. 30s).
4. If completed: Worker releases leases cleanly and stops.
5. If timeout exceeded: Process terminates; the Lease Reaper detects expiry and allows another worker to resume safely.

---

## 10. Worker Crash Recovery Matrix

| Failure Mode | Direct Result | Recovery Mechanism | Guarantee |
| :--- | :--- | :--- | :--- |
| **Worker dies before claim** | None | Work remains ready in queue | Zero impact |
| **Worker dies after claim** | Work remains leased | Lease expires; Lease Reaper reclaims | Work picked up by next worker |
| **Worker dies during provider call** | Provider execution unknown | Marked `uncertain`; recovery engine assesses idempotency | No duplicate charge/side-effect |
| **Worker dies after provider success, before DB commit** | DB uncommitted | Lease expires; re-execution via idempotent adapter | Safe retry |
| **Worker dies after DB commit, before ACK** | Message redelivered | Idempotency guard detects completed state; discards message | Zero duplicate execution |
| **Provider returns HTTP 429** | Step failed on Resource A | Checkpoint state → Migrate to Resource B → Attempt N+1 | Zero task restart |
| **Queue broker crash / data loss** | Queue emptied | Reconciliation Worker queries DB and republishes ready work | Complete system recovery |

---

## 11. Side Effect Receipts & Idempotency (ADR-048)

To distinguish between harmless pure generations and dangerous external mutations (sending emails, making payments, mutating databases):
- Every external mutation requires an explicit `side_effect_receipt`:
  ```sql
  CREATE TABLE execution.side_effect_receipts (
      id UUID PRIMARY KEY,
      effect_key TEXT NOT NULL UNIQUE, -- e.g. "task_id:step_id:send_email"
      status TEXT NOT NULL,
      response JSONB,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ```
- Before executing a non-idempotent side effect, the worker asserts `effect_key` uniqueness.

---

## 12. MVP Technology Strategy: PostgreSQL Queue & Outbox Topology (ADR-049 / ADR-094 / ADR-095)

To maintain architectural discipline, eliminate premature infrastructure complexity, and prove correctness first:
- **Phase 1 (MVP Work Queue - ADR-094):** Workers directly claim executable work from `execution.step_executions` using `SELECT ... FOR UPDATE SKIP LOCKED`. The step execution table itself acts as the authoritative, durable work queue. Eliminates external message brokers (Redis, RabbitMQ, Kafka) while delivering full durability, atomic claiming, dynamic leases, and monotonic fencing.
- **Transactional Domain-Event Outbox (ADR-095):** `system.outbox_events` is NOT the execution work queue. It serves strictly as the transactional delivery buffer for domain events published to external listeners, audit pipelines, and client notification streams.
- **Phase 2 (Scale):** Introduce Redis Streams or a dedicated broker if PostgreSQL polling contention emerges, without modifying domain models or worker contracts.

---

## 13. Architectural Decisions Enshrined (ADR-037 to ADR-054, ADR-094 to ADR-096)

- **ADR-037 (Pointers to Work):** Queue messages carry only lightweight identifiers; durable state is always queried from PostgreSQL.
- **ADR-038 (Atomic Claims via SKIP LOCKED):** High-concurrency worker acquisition without lock contention.
- **ADR-039 (Monotonic Fencing Tokens):** Complete immunity against stale/zombie workers overwriting newer execution state.
- **ADR-040 (ACK Last Invariant):** Queue messages are acknowledged strictly after the PostgreSQL commit succeeds.
- **ADR-041 (Full Jitter Exponential Backoff):** Elimination of synchronized retry storms on failing dependencies.
- **ADR-042 (Stateful Step Migration):** HTTP 429 triggers checkpointed failover to alternate providers without task restarts.
- **ADR-043 (Per-Tenant Concurrency Fencing):** Prevents individual tenants from monopolizing worker capacity.
- **ADR-044 (Global Provider Semaphores):** Protects external provider accounts from being overwhelmed by worker concurrency.
- **ADR-045 (Automated Lease Reaper):** Independent detection and recovery of dead workers.
- **ADR-046 (Reconciliation Engine):** Guaranteed ability to rebuild the queue state from PostgreSQL at any time.
- **ADR-047 (Audited DLQ with Controlled Replay):** Failing work is quarantined with full forensic metadata.
- **ADR-048 (Side-Effect Idempotency Receipts):** External mutations are guarded against duplicate execution during retries.
- **ADR-049 (PostgreSQL Queue for MVP):** Rejects Kafka, Temporal, and microservices for early phases; single database delivers all required guarantees.
- **ADR-050 (Worker Routing Isolation):** Workers execute assigned units; routing and replanning belong exclusively to the Planner and Resource Intelligence.
- **ADR-051 (Untrusted Provider Calls):** All provider responses require independent schema and output validation.
- **ADR-052 (No Exactly-Once Transport Fallacy):** Architecture relies on At-Least-Once delivery coupled with idempotent processing.
- **ADR-053 (Credential Isolation):** Workers receive only decrypted ephemeral credentials from the Credential Vault as needed; secrets are barred from payloads and logs.
- **ADR-054 (Step Decomposition):** Long-running tasks are decomposed into discrete, checkpointable DAG steps to facilitate safe failover and parallelism.
- **ADR-094 (MVP Execution Work Queue Topology):** Workers poll `execution.step_executions` directly via `SKIP LOCKED`. `system.outbox_events` is decoupled as the domain event buffer.
- **ADR-095 (Dedicated Outbox & Consumer Tables):** Physical tables `system.outbox_events` and `system.event_consumptions` separate ephemeral event dispatch from immutable event logs.
- **ADR-096 (Side Effect Receipts Table):** Database-enforced uniqueness invariant on `execution.side_effect_receipts(effect_key)`.

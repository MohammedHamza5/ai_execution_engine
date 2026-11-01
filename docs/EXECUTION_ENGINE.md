# EXECUTION ENGINE SPECIFICATION

## 0. Document Status
- **Status:** Core Architecture Contract — Ratified Baseline
- **Version:** `1.0`
- **Domain:** Execution Orchestration, Durable State, Resilient Recovery
- **Upstream Dependencies:** [`MASTER_ARCHITECTURE.md`](./MASTER_ARCHITECTURE.md), [`INTERNAL_DATA_MODEL.md`](./INTERNAL_DATA_MODEL.md), [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md), [`QUEUE_WORKER_ARCHITECTURE.md`](./QUEUE_WORKER_ARCHITECTURE.md), [`RESOURCE_INTELLIGENCE.md`](./RESOURCE_INTELLIGENCE.md)
- **Downstream Consumers:** `VALIDATION_ENGINE.md`, `REPUTATION_ENGINE.md`, Worker Daemons, Scheduler Daemons

---

## 1. Executive Summary & Purpose

The **Execution Engine** is the core operational runtime that transforms an abstract, multi-step **Execution Plan** into durable, observable, deterministic, and recoverable execution.

Its primary responsibility is **NOT** model selection or prompt planning—those tasks are strictly partitioned upstream within **Task Intelligence**, **Execution Planner**, and **Resource Intelligence**.

> **The Sovereign Execution Principle:**
> *«The Task must survive the failure of any individual execution attempt. A model call is disposable; the task state is durable and persistent.»*

```text
TASK (Durable Objective across minutes/hours)
  └── PLAN (DAG of logical dependencies)
        └── STEP (Atomic logical unit of work)
              └── EXECUTION (Lifecycle of executing a step)
                    └── ATTEMPT (Physical ephemeral run on a specific Resource)
```

If an individual model, provider, API connection, worker instance, physical host, network interface, quota window, or HTTP stream collapses, **the Task does not fail**. Only the current **Attempt** fails. The Execution Engine deterministically diagnoses the failure, checkpoints accumulated state, and orchestrates remediation (retry, migrate, replan, wait, or escalate).

---

## 2. Boundaries & Responsibilities

### 2.1 In Scope (Responsibilities)
1. **Durable State Transitioning:** Driving the Task, Step, Execution, and Attempt state machines backed strictly by PostgreSQL (never worker memory).
2. **Atomic Worker Claiming & Leases:** Enforcing dynamic lease terms, heartbeat renewal, and monotonic fencing tokens to eradicate zombie worker write corruption.
3. **Preflight Admission Verification:** Validating tenant budget, step readiness, policy eligibility, artifact availability, and resource reservations before issuing network calls.
4. **Adapter Invocation & Network Isolation:** Invoking `ProviderAdapter` implementations outside database transaction blocks to eliminate connection pool starvation.
5. **Outcome Classification:** Normalizing provider and network outcomes into a 8-outcome taxonomy (`SUCCESS`, `PARTIAL_SUCCESS`, `RETRYABLE_FAILURE`, `QUOTA_FAILURE`, `CAPABILITY_FAILURE`, `QUALITY_FAILURE`, `UNKNOWN_OUTCOME`, `FATAL_FAILURE`).
6. **Artifact-First Data Flow & Lineage:** Tracking artifact versioning (`v1`, `v2`, ...), hashes, object storage references, parent-child provenance, and minimal context delivery.
7. **Side-Effect Idempotency:** Guarding non-generative side effects (emails, external mutations, billing events) via cryptographic `effectKey` tokens and persistent `EffectReceipt` ledgers.
8. **Automated Recovery Orchestration:** Managing bounded exponential backoff, resource migration (preserving checkpoints via `HandoffPackage`), and triggering versioned replanning (`Plan V1` $\to$ `Plan V2`).
9. **Deadlines & Timeouts:** Propagating strict hierarchical timeouts (`Task Deadline` $\ge$ `Step Timeout` $\ge$ `Attempt Timeout` $\ge$ `Provider Timeout`).
10. **Cancellation & Drain Lifecycle:** Providing instant logical cancellation with stale write rejection and graceful worker draining.

### 2.2 Out of Scope (Non-Responsibilities)
1. **Provider Ranking & Quota Accounting:** Delegated exclusively to [`RESOURCE_INTELLIGENCE.md`](./RESOURCE_INTELLIGENCE.md).
2. **Provider API Protocol Details:** Delegated exclusively to [`PROVIDER_ADAPTER_CONTRACT.md`](./PROVIDER_ADAPTER_CONTRACT.md).
3. **Truth Verification & Semantic Correctness:** Delegated to `VALIDATION_ENGINE.md`. The Execution Engine orchestrates validation execution, but does not evaluate schema correctness or semantic truth.
4. **Direct Database Writes inside Workers:** Workers communicate state changes through atomic transactional APIs and the Outbox event bus.

---

## 3. Execution State Machine

Execution state transitions are strictly deterministic. State is persisted durably to PostgreSQL before external notifications or downstream actions trigger.

```text
                         ┌───────────────┐
                         │    CREATED    │
                         └───────┬───────┘
                                 │ Plan DAG generated
                                 ▼
                            ┌─────────┐
                            │  READY  │ (Dependencies satisfied)
                            └────┬────┘
                                 │ Resource selected & reserved
                                 ▼
                            ┌─────────┐
                            │ QUEUED  │ (Outbox message written)
                            └────┬────┘
                                 │ Worker atomic claim (FOR UPDATE SKIP LOCKED)
                                 ▼
                            ┌─────────┐
                            │ LEASED  │ (Fencing token issued)
                            └────┬────┘
                                 │ Preflight checks pass, Attempt started
                                 ▼
                           ┌──────────┐
                           │ RUNNING  │
                           └────┬─────┘
                                │
              ┌─────────────────┼──────────────────┐
              │                 │                  │
        Provider Success   Provider Partial   Provider Error / Timeout
              │                 │                  │
              ▼                 ▼                  ▼
        CHECKPOINTING     CHECKPOINTING          FAILED
              │ (Save output)   │ (Save stream)    │
              ▼                 ▼                  ▼
         VALIDATING        VALIDATING          DIAGNOSING
              │                 │                  │
      ┌───────┴───────┐         │                  ├───────────────┬───────────────┐
      │               │         │                  │               │               │
    Passed          Failed      │              Retryable?      Migratable?    Replannable?
      │               │         │                  │               │               │
      ▼               └────┬────┘                  ▼               ▼               ▼
  COMPLETED                │                     RETRY          MIGRATE         REPLAN
                           │                       │               │               │
                           └───────────────────────┼───────────────┴───────────────┘
                                                   │
                                                   ▼ (Bounded by Recovery Budget)
                                                QUEUED
```

### 3.1 Terminal States
An **Execution** or **Attempt** may resolve into the following terminal states:
* `COMPLETED`: Output produced, required validation passed, artifacts persisted, reservation reconciled.
* `FAILED`: Recovery budget exhausted or unrecoverable error encountered without fallback.
* `CANCELLED`: User or system aborted task execution. Late attempts fenced out.
* `DEAD_LETTERED`: Unrecoverable execution requiring administrative inspection and manual replay.

> [!IMPORTANT]
> **State Independence Invariant:** A failure of an `Attempt` transitions the Attempt to `FAILED` and the Step to `DIAGNOSING`. The overarching `Task` remains `RUNNING` unless the step is mandatory and recovery options are completely exhausted.

---

## 4. Execution Data Contracts & Interfaces

### 4.1 Execution Context
Every running attempt is injected with a strictly scoped context preventing access to unauthorized tenant or environment state:

```typescript
export interface ExecutionContext {
  readonly tenantId: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly planId: string;
  readonly planStepId: string;          // Static DAG step definition (planning.plan_steps)
  readonly stepExecutionId: string;     // Runtime execution instance (execution.step_executions)
  readonly stepId: string;              // Canonical alias for stepExecutionId
  readonly executionId: string;
  readonly attemptId: string;           // Transient attempt instance (execution.execution_attempts)
  readonly workerId: string;
  readonly resourceId: string;
  readonly leaseToken: string;
  readonly fencingToken: number;
  readonly traceId: string;
  readonly deadlineAt: Date;
  readonly attemptTimeoutMs: number;
}
```

### 4.2 Handoff Package (Migration Contract)
When migrating from one resource to another mid-step, the downstream attempt does not restart from raw input prompts. It receives a structured `HandoffPackage`:

```typescript
export interface HandoffPackage {
  readonly taskObjective: string;
  readonly stepId: string;
  readonly stepObjective: string;
  readonly completedWork: ReadonlyArray<ArtifactReference>;
  readonly partialWork?: ArtifactReference;
  readonly knownErrors: ReadonlyArray<ErrorSummary>;
  readonly constraints: ReadonlyArray<StepConstraint>;
  readonly validationRules: ReadonlyArray<ValidationRule>;
  readonly requiredOutput: OutputSpecification;
  readonly previousAttempts: ReadonlyArray<AttemptSummary>;
}

export interface ArtifactReference {
  readonly artifactId: string;
  readonly artifactName: string;
  readonly mimeType: string;
  readonly storageLocation: string; // S3/GCS URI or DB reference
  readonly sha256Hash: string;
  readonly sizeBytes: number;
  readonly version: number;
}

export interface AttemptSummary {
  readonly attemptId: string;
  readonly resourceId: string;
  readonly provider: string;
  readonly model: string;
  readonly failureCode?: string;
  readonly failureReason?: string;
  readonly latencyMs: number;
  readonly tokensConsumed: number;
}
```

### 4.3 Side Effect Idempotency Contracts
External, non-generative mutations require an idempotency key and a durable execution receipt:

```typescript
export interface SideEffectContract {
  /**
   * Deterministic identifier combining task, step, mutation type, and target ID.
   * Format: `${taskId}:${stepId}:${mutationType}:${targetId}`
   */
  readonly effectKey: string;
  readonly mutationType: string;
  readonly payloadHash: string;
  readonly requiresReceipt: boolean;
}

export interface EffectReceipt {
  readonly effectKey: string;
  readonly taskId: string;
  readonly stepId: string;
  readonly executionId: string;
  readonly externalTransactionId?: string;
  readonly status: "EXECUTED" | "CONFIRMED_DUPLICATE" | "FAILED";
  readonly executedAt: Date;
  readonly responseDigest: string;
}
```

### 4.4 Task Result Contract & Provenance Graph
Upon plan completion, final outputs are synthesized along with full cryptographic provenance:

```typescript
export interface TaskResult {
  readonly taskId: string;
  readonly status: "COMPLETED" | "PARTIALLY_COMPLETED";
  readonly output: ArtifactReference;
  readonly validationSummary: ValidationSummary;
  readonly executionSummary: ExecutionSummary;
  readonly provenance: ProvenanceGraph;
}

export interface ProvenanceGraph {
  readonly rootTaskId: string;
  readonly nodes: ReadonlyArray<{
    readonly artifactId: string;
    readonly producedByAttemptId: string;
    readonly resourceId: string;
    readonly provider: string;
    readonly model: string;
    readonly parentArtifactIds: ReadonlyArray<string>;
    readonly validationPassed: boolean;
  }>;
}

export interface ExecutionSummary {
  readonly totalLatencyMs: number;
  readonly totalAttempts: number;
  readonly totalMigrations: number;
  readonly totalReplans: number;
  readonly estimatedCostUsd: number;
  readonly actualCostUsd: number;
  readonly freeQuotaUnitsConsumed: number;
  readonly paidQuotaUnitsConsumed: number;
}
```

---

## 5. Execution Engine Core API

The programmatic surface of the Execution Engine exposed to Workers, Schedulers, and API services:

```typescript
export interface IExecutionEngine {
  /** Initializes task execution, registers plan, and schedules initial ready steps. */
  startTask(taskId: string): Promise<void>;

  /** Evaluates step dependencies, triggers resource reservation, and enqueues attempt. */
  startStep(stepId: string): Promise<void>;

  /** Worker entrypoint: validates claim lease, executes adapter, handles outcome. */
  executeAttempt(attemptId: string, context: ExecutionContext): Promise<void>;

  /** Creates durable point-in-time state checkpoint in PostgreSQL before risky actions. */
  createCheckpoint(executionId: string, reason: string): Promise<CheckpointRecord>;

  /** Handles retryable errors under current resource within exponential backoff limit. */
  retryAttempt(executionId: string, reason: FailureClassification): Promise<void>;

  /** Checkpoints state, releases reservation, selects new resource, spawns attempt N+1. */
  migrateResource(executionId: string, reason: MigrationReason): Promise<void>;

  /** Invalidates failed plan branch and invokes Planner for plan_vN branch. */
  replanTask(taskId: string, failedStepId: string, reason: ReplanReason): Promise<void>;

  /** Halts execution, fences pending worker commits, and marks task CANCELLED. */
  cancelTask(taskId: string, reason: string): Promise<void>;

  /** Periodic daemon hook: scans expired leases and recovers orphaned attempts. */
  recoverOrphanedExecutions(): Promise<number>;
}
```

---

## 6. Outcome Taxonomy & Recovery Handling Matrix

The engine processes provider adapter results through an 8-outcome taxonomy. Blind retries are strictly prohibited.

```text
PROVIDER RESULT
      │
      ├── SUCCESS ──────────────► Validate Artifact ──► Complete Step
      ├── PARTIAL_SUCCESS ──────► Checkpoint stream ──► Resume / Repair Attempt
      ├── RETRYABLE_FAILURE ────► Backoff Check ─────► Retry on Same Resource
      ├── QUOTA_FAILURE ────────► Checkpoint ────────► Migrate to Alternate Resource
      ├── CAPABILITY_FAILURE ───► Invalidate Res ────► Migrate to Capable Resource
      ├── QUALITY_FAILURE ──────► Validator Failed ──► Alternate Model / Repair Step
      ├── UNKNOWN_OUTCOME ──────► Reconcile API ─────► Safe Deduplicated Retry
      └── FATAL_FAILURE ────────► Budget Check ──────► Escalate / Replan / Fail
```

### 6.1 Recovery Decision Matrix

| Failure Classification | Exemplar Triggers | Retry Same Resource? | Migrate Resource? | Replan DAG? | Recovery Budget Impact |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **Network Timeout** | Socket drop, HTTP 504, TCP reset | Yes (max 2) | Yes (if repeated) | Rare | Decrements `maxAttempts` |
| **Rate Limit / 429** | Provider 429, Quota burst limit | Only if reset < 30s | Yes (Immediate) | No | Migrates reservation |
| **Quota Exhaustion** | Daily credit empty, token tier cap | Strictly No | Yes (Required) | Optional | Invalidates resource tier |
| **Capability Mismatch** | Modality rejected, context > window | Strictly No | Yes | Yes (if chunking needed) | Triggers Plan V2 decomposition |
| **Invalid Output Syntax** | Malformed JSON, truncated schema | Yes (with repair prompt) | Yes (after 1 repair) | Optional | Decrements repair budget |
| **Quality Failure** | Factual check failed, logic error | Strictly No | Yes (higher tier) | Yes (multi-step solver) | Decrements quality budget |
| **Authentication / Auth** | Invalid API key, expired token | Strictly No | Yes (alternate key) | No | Marks credential invalid |
| **Content Policy Block** | Safety filter refusal | Strictly No | Optional | Yes (reformulate prompt) | Escalates to human or halts |
| **Provider 5xx Crash** | Internal provider failure, 500/503 | Yes (with jitter) | Yes (if > 1 error) | No | Trips circuit breaker |
| **Unknown Outcome** | Network severed after request sent | Reconcile First | Reconcile First | No | Requires receipt validation |

---

## 7. Recovery Budget & Anti-Loop Safeguards

To prevent infinite recovery loops (e.g., Retry $\to$ Migrate $\to$ Replan $\to$ Retry ...), every Step and Task is governed by a strict **Recovery Budget**:

```typescript
export interface RecoveryBudget {
  readonly maxAttemptsPerStep: number;        // Default: 4
  readonly maxMigrationsPerStep: number;      // Default: 3
  readonly maxReplansPerTask: number;         // Default: 2
  readonly maxValidationRepairsPerStep: number;// Default: 2
  readonly totalTaskTimeoutMs: number;        // Default: 30 minutes
}
```

### 7.1 Exhaustion Protocol
When any recovery parameter reaches 0:
1. The step transitions to `FAILED`.
2. If the step criticality is `OPTIONAL` or `BEST_EFFORT`, the execution engine flags the step as skipped and continues the plan DAG.
3. If the step is `MANDATORY`, the task transitions to `DEAD_LETTERED` or `FAILED`.
4. An alert event (`TASK_RECOVERY_EXHAUSTED`) is written to `system.outbox_events`.

---

## 8. Checkpoint, Storage & Transaction Boundaries

### 8.1 The Two-Phase Network Isolation Rule (ADR-024 / ADR-088)
Under no circumstances may a PostgreSQL database transaction span an external AI provider HTTP call.

```text
[Phase 1: Claim Transaction (ADR-094 Work Queue)]
BEGIN;
  -- Worker atomically claims executable work from the step_executions table (ADR-094)
  SELECT * FROM execution.step_executions 
  WHERE id = $step_execution_id AND status = 'pending' 
  FOR UPDATE SKIP LOCKED;

  UPDATE execution.step_executions 
  SET status = 'running',
      worker_id = $worker_id,
      lease_token = $lease_token,
      lease_expires_at = now() + interval '60 seconds',
      fencing_token = fencing_token + 1,
      started_at = COALESCE(started_at, now()),
      updated_at = now()
  WHERE id = $step_execution_id;

  INSERT INTO execution.execution_attempts (
    id, step_execution_id, attempt_number, resource_id, provider_id, model_id, status, started_at
  ) VALUES (
    $attempt_id, $step_execution_id, $attempt_number, $resource_id, $provider_id, $model_id, 'running', now()
  );
COMMIT;
  │
  ▼ (Outside Database Transaction)
[External Network Call]
  ProviderAdapter.execute(UnifiedRequest) ---> Remote AI Provider (10s - 120s)
  │
  ▼ (Outside Database Transaction)
[Phase 2: Completion Transaction]
BEGIN;
  -- Monotonic fencing token validation (ADR-039 / ADR-082)
  UPDATE execution.step_executions
  SET status = 'validating', updated_at = now()
  WHERE id = $step_execution_id AND fencing_token = $local_fencing_token;
  -- If rows affected == 0, a newer worker took over after lease expiry: ROLLBACK!

  INSERT INTO artifacts.artifacts (...) VALUES (...);
  INSERT INTO execution.checkpoints (...) VALUES (...);
  UPDATE execution.execution_attempts 
  SET status = 'completed', completed_at = now(), output_tokens = $tokens
  WHERE id = $attempt_id;

  -- Domain Event Transactional Outbox (ADR-095 - separate from execution work queue)
  INSERT INTO system.outbox_events (
    id, event_id, event_type, aggregate_type, aggregate_id, payload
  ) VALUES (
    gen_random_uuid(), $event_id, 'STEP_COMPLETED', 'step_execution', $step_execution_id, $payload
  );
COMMIT;

-- ACK Last Invariant: Queue item is completed in database before any subsequent external notifications fire.
```

### 8.2 Large Artifact Handling
1. Artifacts $< 64\text{ KB}$ may be cached directly in the `artifacts.artifact_records.inline_data` column.
2. Artifacts $\ge 64\text{ KB}$ are streamed to Object Storage (S3/GCS/MinIO). PostgreSQL retains only cryptographic metadata: `storage_location`, `sha256_hash`, `size_bytes`, `mime_type`, and `schema_definition`.
3. Checkpoint records serialize the references to these artifacts, ensuring atomic snapshots without database bloat.

---

## 9. Deadlines & Timeout Hierarchy

All timeout controls must strictly adhere to the downward propagation hierarchy. Lower-level timeouts may never exceed their parent scope.

$$\text{Task Deadline} \ge \text{Step Timeout} \ge \text{Attempt Timeout} \ge \text{Provider HTTP Timeout}$$

```text
Task Deadline (e.g., 30m)
  └── Step Timeout (e.g., 10m)
        └── Attempt Timeout (e.g., 3m)
              └── Provider HTTP Socket Timeout (e.g., 90s)
```

If a Provider HTTP call exceeds 90s, the socket is severed. The Attempt fails with `TIMEOUT`. The Step retains 7 minutes to execute a migration or retry without breaching the Task deadline.

---

## 10. Execution Safety Rules (E-001 to E-010)

These rules are immutable and enforced across all execution engine code paths:

* **`E-001` (Memory Distrust):** Never trust Worker memory as source of truth. All state changes must be committed to PostgreSQL before triggering external actions.
* **`E-002` (Mandatory Timeout):** Never call an external provider without explicit connection, socket, and attempt deadlines.
* **`E-003` (No Blind Retries):** Retries must change state (modify temperature, adjust prompt, repair schema, or switch resource). Never retry identical requests repeatedly on degraded resources.
* **`E-004` (Artifact Durability):** Completed intermediate artifacts must never be deleted or overwritten by subsequent failed attempts.
* **`E-005` (Checkpoint Before Migration):** State must be checkpointed to the datastore before initiating resource handoff.
* **`E-006` (Monotonic Fencing):** Stale or zombie workers whose lease expired must be unconditionally rejected from committing state.
* **`E-007` (Validation Barrier):** No step or task may be marked `COMPLETED` without passing mandatory validation policies.
* **`E-008` (Zero Silent Spend):** Paid resources must never be engaged mid-execution without explicit pre-authorized tenant policy approval.
* **`E-009` (Side-Effect Idempotency):** External side effects must be guarded by cryptographic `effectKey` tokens and durable receipts.
* **`E-010` (Bounded Recovery):** Recovery loops are bounded by strict counter budgets to prevent infinite looping and cost explosion.

---

## 11. Architectural Decisions (ADR-080 to ADR-092)

### ADR-080 (D-044): Task-Centric Durable Execution
* **Decision:** The durable execution lifecycle is anchored to the Task, not the ephemeral Model call.
* **Rationale:** AI models and providers fail frequently. Abstracting the task from the model allows transparent recovery without user disruption.

### ADR-081 (D-045): Strict Attempt Isolation
* **Decision:** Every physical invocation against a provider is modeled as an independent `Attempt` record with isolated metrics, logs, and token tracking.
* **Rationale:** Enables forensic auditing, accurate cost allocation, and debugging of intermittent provider regressions.

### ADR-082 (D-046): Database-Backed Durable State
* **Decision:** PostgreSQL is the sole durable state machine. Workers are strictly stateless compute runners.
* **Rationale:** Worker processes can crash or restart without state loss or corrupted task lifecycles.

### ADR-083 (D-047): Atomic Checkpointing Prior to Migration
* **Decision:** Before any resource migration occurs, accumulated partial or completed artifacts must be committed as a durable checkpoint.
* **Rationale:** Ensures incoming replacement models receive verified context (`HandoffPackage`) rather than recomputing work from scratch.

### ADR-084 (D-048): Artifact-First Execution Architecture
* **Decision:** Data flow between DAG steps moves discrete typed `Artifact` records rather than raw conversation chat strings.
* **Rationale:** Allows heterogeneous models (vision, code, reasoning) to consume outputs cleanly without carrying bloated, noisy chat context.

### ADR-085 (D-049): Mandatory Validation Barrier
* **Decision:** An API `SUCCESS` status from an AI provider does not equal step completion. Execution must transition through `VALIDATING` before resolving to `COMPLETED`.
* **Rationale:** Models frequently generate plausible hallucinated output that violates schema or task constraints.

### ADR-086 (D-050): Error-Taxonomy Driven Recovery
* **Decision:** Recovery paths are mapped directly from an 8-outcome taxonomy.
* **Rationale:** Eliminates naive retries on non-transient failures such as daily quota exhaustion or modality capability mismatches.

### ADR-087 (D-051): Bounded Recovery Budget
* **Decision:** Implement explicit maximum limits on attempts, migrations, and replans per execution.
* **Rationale:** Prevents infinite recovery loops, unbounded latency, and billing exhaustion.

### ADR-088 (D-052): First-Class Unknown Outcome Handling
* **Decision:** Network timeouts where provider execution state is uncertain are treated as `UNKNOWN_OUTCOME` rather than definite failures.
* **Rationale:** Prevents destructive duplicate calls on state-mutating operations and informs reconciliation protocols.

### ADR-089 (D-053): Side-Effect Idempotency Receipts
* **Decision:** All mutating actions outside pure generation require an `effectKey` and persistent `EffectReceipt`.
* **Rationale:** Guarantees exactly-once semantics for email sending, external webhook triggers, and third-party mutations during retries.

### ADR-090 (D-054): Versioned Plan Branching (Plan V1 $\to$ Plan V2)
* **Decision:** Replanning generates a new versioned plan branch (`plan_v2`) preserving the historical failed branch for audit and comparison.
* **Rationale:** Prevents history loss, enables forensic analysis, and supports offline benchmark evaluations.

### ADR-091 (D-055): Cryptographic Output Provenance
* **Decision:** All task outputs must compile a `ProvenanceGraph` linking final results to every intermediate model, attempt, and validator that participated.
* **Rationale:** Essential for enterprise compliance, legal auditability, and debugging hallucination chains.

### ADR-092 (D-056): Disposable Provider Architecture
* **Decision:** Any AI provider is treated as entirely disposable. Core business logic never depends on proprietary provider SDK primitives.
* **Rationale:** Eliminates vendor lock-in and protects system availability during major provider outages.

### ADR-093: Core Runtime Environment
* **Decision:** Ratify TypeScript (Node.js) with strict mode enabled as the authoritative core runtime in a Modular Monolith architecture.
* **Rationale:** Preserves all existing type contracts and interfaces in `/docs/`, provides native JSON processing, and handles asynchronous network I/O for provider streaming.

### ADR-094: MVP Execution Work Queue Topology
* **Decision:** Workers claim executable work directly from `execution.step_executions` using `SELECT ... FOR UPDATE SKIP LOCKED`.
* **Rationale:** Eliminates external broker dependencies (Kafka, Redis, RabbitMQ) for MVP while providing ACID durability, atomic leases, and monotonic fencing. `system.outbox_events` is preserved strictly for domain events.

### ADR-095: Dedicated Outbox and Consumer Deduplication Tables
* **Decision:** Ratify physical tables `system.outbox_events` (transactional delivery queue for immutable domain events) and `system.event_consumptions` (idempotent consumer ledger).
* **Rationale:** Decouples ephemeral delivery retries from immutable event history (`system.events`), preventing table bloat and vacuum contention.

### ADR-096: Idempotent Side Effect Receipts
* **Decision:** Ratify physical table `execution.side_effect_receipts` with a database-enforced unique constraint on `effect_key`.
* **Rationale:** Proves non-generative external mutations (emails, payments, webhooks) are never executed twice by competing or recovering workers.

---

## 12. Verification & Testing Contracts

1. **Zombie Worker Rejection Test:** A worker delayed beyond its lease duration must have its completion transaction rejected by PostgreSQL when attempting to write with an outdated fencing token.
2. **Quota Migration Resilience Test:** Injecting a simulated HTTP 429 during Step 3 of a 5-step DAG must result in:
   - State checkpoint creation.
   - Resource release.
   - Replacement resource assignment.
   - Resumption of Step 3 under Attempt 2 using `HandoffPackage`.
   - Steps 1 and 2 are never re-executed.
3. **Recovery Budget Exhaustion Test:** Continuously failing validation on a mandatory step must trip `maxAttemptsPerStep` and transition the task to `DEAD_LETTERED` without infinite loops.
4. **Side-Effect Idempotency Test:** Triggering a retry on a step with an existing `EffectReceipt` must skip external execution and return the cached receipt digest.

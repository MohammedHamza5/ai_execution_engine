# ARCHITECTURE RESOLUTION REPORT: ADR-093 THROUGH ADR-096

## 0. Document Metadata
- **Date:** 2026-10-07
- **Status:** **RATIFIED & SYNCHRONIZED**
- **Authority:** Architecture Audit Resolution Pass
- **Governing Constitution:** [`AGENT_RULES.md`](../AGENT_RULES.md)
- **Preceding Audit:** [`ARCHITECTURE_AUDIT.md`](./ARCHITECTURE_AUDIT.md)
- **Control Board:** [`00_PROJECT_STATUS.md`](./00_PROJECT_STATUS.md)

---

## 1. Executive Summary

Following the comprehensive 30-dimension audit documented in [`ARCHITECTURE_AUDIT.md`](./ARCHITECTURE_AUDIT.md), this Resolution Pass formally ratifies architectural decisions **ADR-093 through ADR-096** and eliminates the physical schema and documentation discrepancies that previously blocked implementation readiness.

All affected specification documents have been synchronized across the repository. The physical database DDL in [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md) now includes all necessary worker lease/fencing columns, outbox delivery tables, consumer deduplication tables, and side-effect receipts. All obsolete SQL references in [`EXECUTION_ENGINE.md`](./EXECUTION_ENGINE.md) have been aligned with the authoritative database schema.

Implementation remains strictly **LOCKED**. The final remaining prerequisite before formal Architecture Freeze is the ingestion of the multi-tiered truth specification: [`VALIDATION_ENGINE.md`](./VALIDATION_ENGINE.md).

---

## 2. Formally Ratified Architectural Decisions

### ADR-093: Core Runtime Environment & Architecture
- **Status:** **FINAL / RATIFIED**
- **Decision:**
  - **Language:** TypeScript
  - **Runtime:** Node.js (LTS)
  - **TypeScript Strict Mode:** Mandatory (`"strict": true`, `"noImplicitAny": true`, `"strictNullChecks": true`)
  - **System Architecture:** Modular Monolith within a single repository and single PostgreSQL database.
  - **Tooling:** Package manager and build tooling will be finalized during the implementation-readiness pass.
- **Context:** `00_PROJECT_STATUS.md` tracked the runtime language (TypeScript vs. Python vs. Go vs. Rust) as an open question. All existing domain interfaces, adapter contracts, execution types, and data models in `/docs/` were already authored in TypeScript.
- **Options Considered:**
  1. *Option A (TypeScript / Node.js):* Native JSON processing, high-concurrency event-loop performance for outbound AI provider HTTP streaming, direct parity with existing architectural contracts.
  2. *Option B (Python):* Ecosystem standard for machine learning, but introduces boilerplate for high-concurrency transactional worker loops and type safety.
  3. *Option C (Go / Rust):* High raw performance, but slower iteration velocity for domain modeling and complex DAG execution logic.
- **Decision Rationale:** The engine is an I/O-bound resource orchestrator managing concurrent network streams and PostgreSQL transactional state machines. TypeScript provides immediate type safety, sub-millisecond JSON parsing, and 100% contract fidelity with existing documentation.
- **Consequences:** The core repository will be initialized as a TypeScript project. External Python scripts or evaluation harnesses may be integrated as peripheral tools, but the Core Engine is strictly TypeScript.
- **Invariants:** No loose typing. No `any` types permitted in core domain models. Proprietary provider SDK types must never cross the Provider Adapter Anti-Corruption Layer (ADR-065).

---

### ADR-094: MVP Execution Work Queue Topology
- **Status:** **FINAL / RATIFIED**
- **Decision:**
  - In Phase 1 (MVP), workers directly claim executable work from the PostgreSQL table:
    ```sql
    execution.step_executions
    ```
    using atomic row-level claiming:
    ```sql
    SELECT * FROM execution.step_executions
    WHERE status = 'pending' AND available_at <= now()
    ORDER BY priority DESC, available_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;
    ```
  - The step execution table itself acts as the authoritative, durable work queue.
  - **Critical Boundary Rule:** `system.outbox_events` is **NOT** the execution work queue. It is strictly the transactional domain-event outbox for asynchronous pub/sub listeners.
  - **Topology:**
    ```text
    Task / Plan
      ↓
    execution.step_executions (Authoritative Work Queue)
      ↓ (Worker atomic claim: FOR UPDATE SKIP LOCKED)
    Worker Runtime (Dynamic lease + monotonic fencing token)
      ↓ (Outside DB transaction)
    Provider Adapter
      ↓ (Completion transaction + fencing token assertion)
    PostgreSQL State Transition (Validating / Checkpointed)
    ```
- **Context:** The audit identified ambiguity between worker queries polling `step_executions` directly vs. worker loops relying on `system.outbox_events` and calling `Queue.ack()`.
- **Options Considered:**
  1. *Option A (Direct Polling on `step_executions`):* Step state, leases, heartbeats, and fencing live in one ACID-guaranteed record.
  2. *Option B (Outbox-Mediated Queue Messages):* Outbox dispatcher copies step IDs to a separate `queue_messages` table. Adds an unnecessary polling hop and daemon for MVP.
  3. *Option C (External Broker):* Introducing Redis or Kafka for MVP.
- **Decision Rationale:** Option A delivers maximum simplicity, absolute durability, and zero dual-write overhead. PostgreSQL `FOR UPDATE SKIP LOCKED` handles thousands of concurrent worker claims without lock contention.
- **Consequences:** No external message broker required for Phase 1. `execution.step_executions` is indexed specifically for `(priority DESC, available_at ASC) WHERE status = 'pending'`.
- **Invariants:**
  1. Workers never route work; routing belongs to Resource Intelligence.
  2. Workers claim work atomically with dynamic leases.
  3. Every claim increments monotonic `fencing_token`. Stale worker commits are rejected.

---

### ADR-095: Dedicated Outbox & Consumer Deduplication Tables
- **Status:** **FINAL / RATIFIED**
- **Decision:**
  - Ratify two distinct physical tables in PostgreSQL schema `system`:
    1. `system.outbox_events`: Ephemeral transactional delivery buffer for domain events.
    2. `system.event_consumptions`: Idempotent consumer deduplication ledger.
  - **Decoupling Rule:** Do **NOT** overload `system.events` as both an immutable event history and a high-churn delivery queue.
  - **Physical Relationship:**
    ```text
    Domain Transaction
      ├── Mutate Entity (e.g. execution.step_executions)
      ├── Insert Immutable Fact Log (system.events)
      └── Insert Delivery Queue Record (system.outbox_events referencing event_id)
    COMMIT;
      │
      ▼
    Outbox Dispatcher Daemon
      ├── SELECT FROM system.outbox_events WHERE published_at IS NULL FOR UPDATE SKIP LOCKED;
      ├── Dispatch event to subscribers / audit streams / websockets
      └── UPDATE system.outbox_events SET published_at = now(); (or prune published records)
    ```
- **Context:** `DATABASE_SCHEMA.md` previously merged the outbox into `system.events` via a `published_at` column, while `EVENT_MODEL.md` specified a decoupled `system.outbox_events` table. Overloading `system.events` causes table bloat and heavy vacuum overhead on append-only event stores.
- **Options Considered:**
  1. *Option A (Dedicated Tables):* Separate `system.outbox_events` and `system.event_consumptions`.
  2. *Option B (Single Overloaded `system.events`):* Querying unpublished records via partial index on the main event table.
- **Decision Rationale:** Option A ensures the outbox remains tiny (< few thousand rows), allowing sub-millisecond polling and safe historical retention without vacuum degradation. `system.event_consumptions` enforces strict consumer-side idempotency.
- **Consequences:** Physical DDL in `DATABASE_SCHEMA.md` updated to include both tables with foreign key constraints to `system.events`.
- **Invariants:**
  1. Outbox events must be written within the exact same database transaction as the business mutation.
  2. Historical events in `system.events` are strictly immutable and never pruned.
  3. Consumers check and record `system.event_consumptions` before executing side effects.

---

### ADR-096: Idempotent Side Effect Receipts
- **Status:** **FINAL / RATIFIED**
- **Decision:**
  - Ratify physical table `execution.side_effect_receipts` in `DATABASE_SCHEMA.md`:
    ```sql
    CREATE TABLE execution.side_effect_receipts (
        id UUID PRIMARY KEY,
        effect_key TEXT NOT NULL UNIQUE,
        task_id UUID NOT NULL REFERENCES tasks.tasks(id),
        execution_id UUID NOT NULL REFERENCES execution.executions(id),
        step_execution_id UUID NOT NULL REFERENCES execution.step_executions(id),
        mutation_type TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        external_transaction_id TEXT,
        status TEXT NOT NULL,
        response_digest JSONB NOT NULL DEFAULT '{}',
        executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ```
  - Enforces a database-level unique constraint on `effect_key`.
- **Context:** Non-generative operations (sending emails, invoking third-party webhooks, charging cards) cannot be naively retried upon worker crashes without risking duplicate external actions.
- **Options Considered:**
  1. *Option A (Dedicated Table with Unique Constraint):* Guaranteed ACID duplicate prevention at the database engine level.
  2. *Option B (JSONB Column inside `step_executions`):* Risk of race conditions between recovering workers.
- **Decision Rationale:** Option A provides definitive proof that a side effect has been executed. If a recovering worker attempts to execute the same effect, the unique constraint or preflight check catches it and returns the cached receipt digest.
- **Consequences:** Any step producing an external mutation must define an `effect_key` (`${task_id}:${step_id}:${mutation_type}:${target_id}`) and persist an `EffectReceipt`.
- **Invariants:**
  1. Side effects require preflight existence check on `effect_key`.
  2. Completed receipts are immutable.

---

## 3. Repository Documentation Synchronization Log

The following 7 architecture documents were physically updated to reflect the ratification and resolve all audit discrepancies:

| Document | Nature of Updates Performed |
| :--- | :--- |
| **[`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md)** | • Added missing worker runtime columns to `execution.step_executions` (`worker_id`, `lease_token`, `lease_expires_at`, `fencing_token`, `priority`, `available_at`, `updated_at`).<br>• Added `execution.side_effect_receipts` table with unique constraint on `effect_key`.<br>• Added `system.outbox_events` and `system.event_consumptions` tables.<br>• Added queue polling and lease reaper indices to Section 5.<br>• Appended ADR-093 through ADR-096 to Section 8. |
| **[`EXECUTION_ENGINE.md`](./EXECUTION_ENGINE.md)** | • Clarified `ExecutionContext` identifiers (`planStepId`, `stepExecutionId`, `stepId`).<br>• Corrected obsolete SQL example in Section 8.1: Replaced `execution.steps` with `execution.step_executions`, and `execution.step_attempts` with `execution.execution_attempts`.<br>• Updated transaction boundaries to reflect ADR-094 (direct queue polling) and ADR-095 (domain outbox).<br>• Appended ADR-093 through ADR-096 to Section 11. |
| **[`QUEUE_WORKER_ARCHITECTURE.md`](./QUEUE_WORKER_ARCHITECTURE.md)** | • Updated Section 12 to explicitly document ADR-094 and ADR-095.<br>• Clarified that `step_executions` is the execution work queue, while `outbox_events` is the domain event buffer.<br>• Appended ADR-094, ADR-095, ADR-096 to Section 13. |
| **[`EVENT_MODEL.md`](./EVENT_MODEL.md)** | • Enshrined decoupling of `system.outbox_events` from the execution queue.<br>• Reaffirmed consumer deduplication via `system.event_consumptions`.<br>• Appended ADR-094 and ADR-095 to Section 8. |
| **[`MASTER_ARCHITECTURE.md`](./MASTER_ARCHITECTURE.md)** | • Updated Section 14 to annotate resolved technical questions (Core Runtime, Queue Backend, Event Outbox, Idempotency).<br>• Added Section 15 documenting ADR-001 through ADR-096. |
| **[`INTERNAL_DATA_MODEL.md`](./INTERNAL_DATA_MODEL.md)** | • Updated `StepExecution` entity with lease and fencing attributes.<br>• Added `SideEffectReceipt`, `OutboxEvent`, and `EventConsumption` domain entities.<br>• Added Data Invariants 8, 9, and 10 to Section 7.<br>• Updated PostgreSQL Logical Schemas in Section 6. |
| **[`00_PROJECT_STATUS.md`](./00_PROJECT_STATUS.md)** | • Added `ARCHITECTURE_RESOLUTION.md` to Document Inventory.<br>• Marked `Validation Engine` as `MISSING / REQUIRED BEFORE ARCHITECTURE FREEZE`.<br>• Recorded ADR-093 through ADR-096 in Section 3 (Total: 96 ADRs).<br>• Updated Section 4 (Audit Resolution Status) and Section 5 (Technical Decisions).<br>• Updated Current Phase and Next Action. |

---

## 4. Status of Remaining Issues & Questions

### 4.1 Remaining Blocking Issues
- **None.** All 3 blocking issues identified in `ARCHITECTURE_AUDIT.md` (`ISSUE-01`, `ISSUE-02`, `ISSUE-03`) are **100% RESOLVED**.

### 4.2 Remaining High-Priority Issues
- **None.** All high-priority issues (`ISSUE-04`, `ISSUE-05`, `ISSUE-06`, `ISSUE-07`) are **100% RESOLVED**.
- **ISSUE-07 (Validation Engine):** Formally completed and ratified in [`VALIDATION_ENGINE.md`](./VALIDATION_ENGINE.md) (**ADR-097 through ADR-104**).

### 4.3 Decisions Still Genuinely Open
- **Build & Packaging Tooling (Implementation-Level):** `pnpm` vs `npm`, TypeScript compilation target (`ES2022`), linter/formatter configurations. These are implementation details to be initialized when the project setup begins.

### 4.4 Decisions Explicitly Deferred (Post-Vertical Slice 1)
The following decisions remain intentionally deferred until after the first end-to-end slice is operational:
1. Dynamic Weighted Fair Queuing (WFQ) across tenants.
2. Multi-region credential failover.
3. Disagreement Engine and multi-model debate arbitration.
4. Bayesian reputation scoring decay parameters.
5. Automated benchmark execution engine.
6. Client streaming protocols (WebSockets / Server-Sent Events).

---

## 5. Architecture Freeze Readiness

| Milestone | Status | Notes |
| :--- | :---: | :--- |
| **Master Architecture Baseline** | ✅ COMPLETE | 15 Core Principles, 5 Layers ([`MASTER_ARCHITECTURE.md`](./MASTER_ARCHITECTURE.md)) |
| **Internal Data Contracts** | ✅ COMPLETE | 10 Domains, 10 Invariants ([`INTERNAL_DATA_MODEL.md`](./INTERNAL_DATA_MODEL.md)) |
| **PostgreSQL DDL & Schemas** | ✅ COMPLETE | 12 Logical Schemas, Outbox, Leases, Fencing ([`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md)) |
| **Domain Event Model** | ✅ COMPLETE | Envelope, Causal Streams, Deduplication ([`EVENT_MODEL.md`](./EVENT_MODEL.md)) |
| **Queue & Worker Runtime** | ✅ COMPLETE | `SKIP LOCKED`, Leases, Anti-Zombie Fencing ([`QUEUE_WORKER_ARCHITECTURE.md`](./QUEUE_WORKER_ARCHITECTURE.md)) |
| **Provider Adapter Contract** | ✅ COMPLETE | ACL Boundary, 16-Error Taxonomy ([`PROVIDER_ADAPTER_CONTRACT.md`](./PROVIDER_ADAPTER_CONTRACT.md)) |
| **Resource Intelligence Engine** | ✅ COMPLETE | Filter Pipeline, Quota Accounting, Circuit Breakers ([`RESOURCE_INTELLIGENCE.md`](./RESOURCE_INTELLIGENCE.md)) |
| **Durable Execution Engine** | ✅ COMPLETE | FSM, `HandoffPackage`, Recovery Budgets ([`EXECUTION_ENGINE.md`](./EXECUTION_ENGINE.md)) |
| **Architecture Audit** | ✅ COMPLETE | 30-Dimension Evaluation ([`ARCHITECTURE_AUDIT.md`](./ARCHITECTURE_AUDIT.md)) |
| **ADR Resolution Pass (093-096)**| ✅ COMPLETE | Runtime, Queue Topology, Outbox & Receipts Ratified ([`ARCHITECTURE_RESOLUTION.md`](./ARCHITECTURE_RESOLUTION.md)) |
| **Truth & Validation Engine** | ✅ COMPLETE | 8-Stage Pipeline, Deterministic Precedence ([`VALIDATION_ENGINE.md`](./VALIDATION_ENGINE.md)) |
| **Implementation Kickoff** | 🛑 **LOCKED** | Ready for Final Architecture Freeze Audit. |

---

## 6. Next Step

All core architectural documents (10 domains, 104 ADRs) are 100% complete on disk. The system is ready for the **Final Architecture Freeze Audit** prior to beginning Phase 1 implementation.

# ARCHITECTURE AUDIT REPORT: AI EXECUTION ENGINE

## 0. Audit Metadata
- **Audit Date:** 2026-10-07
- **Auditor:** Primary Engineering Agent (Antigravity)
- **Scope:** Complete cross-document evaluation of `/docs/` and `AGENT_RULES.md`
- **Audit Status:** **AUDIT COMPLETE — CRITICAL GAPS IDENTIFIED**
- **Architecture Implementation Readiness:** **NOT READY (Blocked on 3 Blocking Issues & 4 High-Priority Issues)**

---

## 1. Executive Summary & Verdict

The foundational vision of the **AI Execution Engine** is architecturally sound, ambitious, and differentiated. The core axiom—*«The Task is durable; the model attempt is disposable»*—is maintained with exceptional conceptual fidelity across all 9 ingested specifications. The separation of concerns between Task Intelligence, Execution Planning, Resource Intelligence, Provider Adapters, and the Execution Engine is cleanly drawn.

However, a strict cross-document engineering audit reveals that **the architecture is currently NOT READY for production code implementation**. 

While the conceptual layers and higher-order invariants (ADR-001 through ADR-092) are well-articulated, there are **critical physical schema omissions, entity naming discrepancies, and an unresolved runtime language decision** that would cause immediate compilation, migration, and runtime failure if coding began today. Specifically:
1. The PostgreSQL DDL in `DATABASE_SCHEMA.md` is **missing essential runtime columns** (`fencing_token`, `lease_token`, `lease_expires_at`, `worker_id`) and **missing essential tables** (`execution.side_effect_receipts`, `system.outbox_events`, `system.event_consumptions`).
2. There is a structural ambiguity between whether workers poll `execution.step_executions` directly or poll an outbox/queue table.
3. The technology stack / language runtime has never been ratified in an explicit ADR, despite all contracts being authored in TypeScript.
4. The `VALIDATION_ENGINE.md` specification has not yet been ingested to define the validation barrier algorithms mandated by Rule `E-007`.

Below is the exhaustive audit across all 30 evaluation dimensions.

---

## 2. Comprehensive 30-Dimension Audit Findings

### 2.1 Cross-Document Consistency — [HIGH]
- **Finding:** High philosophical alignment across documents regarding task durability, adapter anti-corruption, and resource intelligence. However, entity and table naming varies between conceptual explanations, code snippets, and physical DDL:
  - `EXECUTION_ENGINE.md` illustrative SQL snippets reference `execution.steps` and `execution.step_attempts`.
  - `DATABASE_SCHEMA.md` defines `planning.plan_steps`, `execution.step_executions`, and `execution.execution_attempts`.
  - `EVENT_MODEL.md` references `system.outbox_events`, while `DATABASE_SCHEMA.md` overloads `system.events` with `published_at`.

### 2.2 Entity Consistency — [MEDIUM]
- **Finding:** The execution hierarchy `Task` $\to$ `Plan` $\to$ `Step` $\to$ `Execution` $\to$ `Attempt` is conceptually consistent. However, the distinction between a static DAG step definition (`PlanStep`) and a runtime instance (`StepExecution`) is occasionally blurred. In `EXECUTION_ENGINE.md`, `ExecutionContext.stepId` is ambiguous—it must be explicitly clarified whether it refers to `plan_step_id` or `step_execution_id`.

### 2.3 Database ↔ Domain Consistency — [BLOCKING]
- **Finding:** Severe discrepancies exist between the domain specifications and the physical DDL in `DATABASE_SCHEMA.md`:
  - `execution.step_executions` is missing: `fencing_token`, `lease_token`, `lease_expires_at`, `worker_id`, `priority`, `available_at`, `updated_at`.
  - `execution.side_effect_receipts` table is completely missing from `DATABASE_SCHEMA.md` (mandated by ADR-048 & ADR-089).
  - `system.outbox_events` and `system.event_consumptions` are missing from `DATABASE_SCHEMA.md` (mandated by ADR-035 & ADR-036).
  - `artifacts.artifact_validations` from `INTERNAL_DATA_MODEL.md` is omitted from `DATABASE_SCHEMA.md`.

### 2.4 State-Machine Consistency — [MEDIUM]
- **Finding:** State names in `EXECUTION_ENGINE.md` are uppercase (`CREATED`, `LEASED`, `RUNNING`, `CHECKPOINTING`, `DIAGNOSING`, `COMPLETED`), whereas `DATABASE_SCHEMA.md` and `INTERNAL_DATA_MODEL.md` use lowercase strings (`pending`, `running`, `completed`). Furthermore, it must be formalized whether transient states like `LEASED`, `CHECKPOINTING`, and `DIAGNOSING` are persistent DB statuses or ephemeral in-memory worker phases.

### 2.5 Event ↔ State-Transition Consistency — [MEDIUM]
- **Finding:** `EVENT_MODEL.md` defines coarse-grained status change events (e.g., `STEP_STATUS_CHANGED`), while `EXECUTION_ENGINE.md` lists fine-grained domain events (`STEP_READY`, `STEP_STARTED`, `STEP_COMPLETED`, `CHECKPOINT_CREATED`). These must be normalized into a unified, versioned event catalog.

### 2.6 Queue ↔ Worker Consistency — [HIGH]
- **Finding:** Architectural ambiguity in work distribution:
  - `QUEUE_WORKER_ARCHITECTURE.md` Section 3 shows workers querying `execution.step_executions` directly with `FOR UPDATE SKIP LOCKED`.
  - `EVENT_MODEL.md` and `EXECUTION_ENGINE.md` Section 8 show workers inserting into `system.outbox_events` and calling `Queue.ack(messageHandle)`.
  - A definitive architectural choice is required: Is `step_executions` itself the queue, or does a dedicated queue table/broker handle delivery?

### 2.7 Provider Adapter ↔ Execution Engine Consistency — [MEDIUM]
- **Finding:** Strong interface alignment. `ProviderAdapter.execute(UnifiedRequest)` returns `UnifiedResponse`. However, `PROVIDER_ADAPTER_CONTRACT.md` classifies errors into 16 normalized codes, whereas `EXECUTION_ENGINE.md` categorizes outcomes into 8 execution states. An explicit mapping function is required.

### 2.8 Resource Intelligence ↔ Provider Adapter Consistency — [LOW]
- **Finding:** Consistent. Resource Intelligence correctly consumes `RateLimitReader` and `UsageReader` interfaces from the adapter layer to update health, circuit breakers, and quota windows.

### 2.9 Resource Intelligence ↔ Execution Engine Consistency — [LOW]
- **Finding:** Consistent. The reservation lifecycle (`RESERVED` $\to$ `CONSUMED` / `RELEASED`) and usage reconciliation logic are cleanly defined across both documents.

### 2.10 Artifact ↔ Validation Consistency — [HIGH]
- **Finding:** Artifact immutability and content addressing are well-modeled. However, `VALIDATION_ENGINE.md` is missing from disk. The Execution Engine cannot enforce Rule `E-007` (Validation Barrier) without ratified validation algorithms and score thresholds.

### 2.11 Checkpoint ↔ Migration Consistency — [LOW]
- **Finding:** Fully consistent. The 429 quota migration flow (Catch 429 $\to$ Checkpoint state $\to$ Release reservation $\to$ Select new resource $\to$ Compile `HandoffPackage` $\to$ Attempt N+1) is identical across `EVENT_MODEL.md`, `QUEUE_WORKER_ARCHITECTURE.md`, and `EXECUTION_ENGINE.md`.

### 2.12 Idempotency Consistency — [HIGH]
- **Finding:** Conceptually robust across client requests (`system.idempotency_keys`), consumers (`system.event_consumptions`), and mutations (`execution.side_effect_receipts`). However, the physical omission of the latter two tables from `DATABASE_SCHEMA.md` makes idempotency currently unimplementable.

### 2.13 Fencing & Lease Consistency — [BLOCKING]
- **Finding:** The anti-zombie worker pattern relies on monotonic fencing tokens. `QUEUE_WORKER_ARCHITECTURE.md` specifies conditional updates (`WHERE fencing_token = :token`), and `EXECUTION_ENGINE.md` specifies fencing checks during commit. Because `fencing_token` is missing from `DATABASE_SCHEMA.md`, this core concurrency guard cannot function.

### 2.14 Outbox ↔ Event-Consumption Consistency — [HIGH]
- **Finding:** Conflict between single-table event storage (`system.events` with `published_at`) in `DATABASE_SCHEMA.md` versus decoupled outbox tables (`system.outbox_events` and `system.event_consumptions`) in `EVENT_MODEL.md`.

### 2.15 Security Assumptions — [LOW]
- **Finding:** Sound. Ephemeral credential handling via KMS secret handles (`secret_reference`), zero plaintext API keys in databases/logs, and strict tool sandboxing outside adapter boundaries are upheld across all documents.

### 2.16 Multi-Tenancy Assumptions — [LOW]
- **Finding:** Sound. `tenant_id` is modeled across all primary entities, and per-tenant concurrency limits prevent cross-tenant starvation.

### 2.17 Credential Lifecycle — [LOW]
- **Finding:** Sound. Credential invalidation upon authentication failure triggers circuit breaker trips and migration without modifying model quality reputations.

### 2.18 Error Taxonomy Consistency — [MEDIUM]
- **Finding:** 16-error adapter taxonomy is well-defined. Needs formal mapping to the 8 execution outcome classes.

### 2.19 Retry & Recovery Semantics — [LOW]
- **Finding:** Sound. Exponential backoff with jitter, non-identical retry rules (Rule `E-003`), and recovery budgets prevent infinite loops.

### 2.20 Unknown-Outcome Handling — [LOW]
- **Finding:** Sound. Network timeouts during provider calls are treated as first-class `UNKNOWN_OUTCOME` states requiring reconciliation before retry.

### 2.21 Observability & Provenance Requirements — [LOW]
- **Finding:** Sound. Full cryptographic `ProvenanceGraph` linking artifacts, models, attempts, and validators is mandated.

### 2.22 API Assumptions — [MEDIUM]
- **Finding:** Developer-facing API specifications (`UNIFIED_API_SPEC.md`) are pending ingestion. While internal data models and idempotency keys exist, the public REST/RPC contracts are not yet formally documented.

### 2.23 Storage Assumptions — [LOW]
- **Finding:** Sound. Hybrid storage policy ($< 64$ KB in Postgres, $\ge 64$ KB in Object Storage) is practical and clear.

### 2.24 Concurrency Assumptions — [LOW]
- **Finding:** Sound. Multi-tenant concurrency limits, provider semaphores, and `SKIP LOCKED` prevent database lock contention.

### 2.25 Failure & Recovery Paths — [LOW]
- **Finding:** Sound. 429 quota migration, timeout retries, circuit breaker tripping, and plan versioning (`Plan V1` $\to$ `Plan V2`) are comprehensively mapped.

### 2.26 Testing Requirements — [LOW]
- **Finding:** Sound. Mandatory contract certification test suites and failure injection tests are defined in `AGENT_RULES.md` and `EXECUTION_ENGINE.md`.

### 2.27 MVP Scope Feasibility — [LOW]
- **Finding:** Feasible and disciplined. Explicit rejection of Kafka, Redis, and Temporal for Phase 1 protects the team from premature infrastructure complexity.

### 2.28 Hidden Architectural Dependencies — [MEDIUM]
- **Finding:** Execution Engine depends on Task Intelligence / Planner to generate the initial Plan DAG. For MVP Vertical Slice 1, a simple single-step plan generator must be explicitly scoped.

### 2.29 Missing Invariants — [LOW]
- **Finding:** Core invariants (Postgres source of truth, ACK last, zero DB transactions during network calls, zero silent spend) are rigorously defined.

### 2.30 Contradictions or Ambiguous Terminology — [HIGH]
- **Finding:** Specific naming contradictions identified between DDL and specifications (`execution.steps` vs `step_executions`, `system.events` vs `system.outbox_events`).

---

## 3. Detailed Analysis of BLOCKING and HIGH Issues

### ISSUE-01 [BLOCKING]: Technology Stack & Language Runtime Unratified
- **Problem:** `00_PROJECT_STATUS.md` tracks the runtime language (TypeScript vs Python vs Go vs Rust) as Open Question #1. Implementation cannot begin without package manager, tooling, and framework initialization.
- **Affected Documents:** `00_PROJECT_STATUS.md`, `AGENT_RULES.md`, `INTERNAL_DATA_MODEL.md`, `PROVIDER_ADAPTER_CONTRACT.md`, `RESOURCE_INTELLIGENCE.md`, `EXECUTION_ENGINE.md`.
- **Why It Matters:** Without a ratified runtime, developers cannot create `package.json` vs `pyproject.toml`, establish database drivers, or implement domain entities.
- **Possible Options:**
  - *Option A:* Ratify TypeScript (Node.js / Bun). All existing interface contracts in `/docs/` are authored in TypeScript. Excellent asynchronous I/O performance for concurrent provider network streaming.
  - *Option B:* Ratify Python. Dominant language for AI tooling and evaluation frameworks.
  - *Option C:* Ratify Go / Rust. High performance, but slower iteration for complex domain logic.
- **Recommended Option:** **Option A (TypeScript / Node.js with strict typing).**
- **Consequence of Choosing It:** Preserves 100% of the type signatures already written in `/docs/`, provides native JSON handling, and simplifies asynchronous streaming and event handling. Python can still be used for offline evaluation/benchmarks via SDK.

---

### ISSUE-02 [BLOCKING]: Database DDL Schema Missing Core Runtime Columns (Leases & Fencing Tokens)
- **Problem:** `DATABASE_SCHEMA.md` table `execution.step_executions` lacks `fencing_token`, `lease_token`, `lease_expires_at`, `worker_id`, `priority`, and `available_at`.
- **Affected Documents:** `DATABASE_SCHEMA.md`, `QUEUE_WORKER_ARCHITECTURE.md`, `EXECUTION_ENGINE.md`.
- **Why It Matters:** PostgreSQL will immediately reject the atomic claim query (`FOR UPDATE SKIP LOCKED`) and the fencing token commit validation query (`WHERE fencing_token = :token`), breaking the worker runtime on Day 1.
- **Possible Options:**
  - *Option A:* Alter `execution.step_executions` in `DATABASE_SCHEMA.md` to add `worker_id UUID`, `lease_token TEXT`, `lease_expires_at TIMESTAMPTZ`, `fencing_token BIGINT NOT NULL DEFAULT 0`, `priority INT NOT NULL DEFAULT 0`, `available_at TIMESTAMPTZ NOT NULL DEFAULT now()`, and `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`.
  - *Option B:* Create a separate `execution.leases` table.
- **Recommended Option:** **Option A.**
- **Consequence of Choosing It:** Keeps claim and lease renewal queries atomic in a single table update, avoiding multi-table join overhead during high-frequency worker polling.

---

### ISSUE-03 [BLOCKING]: Missing Tables in `DATABASE_SCHEMA.md` for Outbox and Idempotent Consumers
- **Problem:** `EVENT_MODEL.md` (ADR-035, ADR-036) defines `system.outbox_events` and `system.event_consumptions`. `EXECUTION_ENGINE.md` writes directly to `system.outbox_events`. However, `DATABASE_SCHEMA.md` only has `system.events` (overloaded with `published_at`) and lacks `system.event_consumptions`.
- **Affected Documents:** `DATABASE_SCHEMA.md`, `EVENT_MODEL.md`, `QUEUE_WORKER_ARCHITECTURE.md`, `EXECUTION_ENGINE.md`.
- **Why It Matters:** Without `system.event_consumptions`, consumers cannot guarantee idempotent event processing. Overloading `system.events` as both an append-only event store and a high-frequency polling outbox causes table bloat and vacuum contention.
- **Possible Options:**
  - *Option A:* Explicitly add `system.outbox_events` (for ephemeral pending event delivery) and `system.event_consumptions` (for consumer deduplication) to `DATABASE_SCHEMA.md`.
  - *Option B:* Retain `system.events` with `published_at` as the outbox, add `system.event_consumptions`, and update `EVENT_MODEL.md` and `EXECUTION_ENGINE.md` to reference `system.events`.
- **Recommended Option:** **Option A.**
- **Consequence of Choosing It:** Separates the high-churn outbox queue from the immutable historical event store. Outbox records can be pruned once published, maintaining sub-millisecond polling indices.

---

### ISSUE-04 [HIGH]: Missing Table in `DATABASE_SCHEMA.md` for Side-Effect Receipts
- **Problem:** ADR-048 and ADR-089 mandate `execution.side_effect_receipts` to guarantee idempotency for non-generative external mutations (emails, webhooks, billing). This table is completely missing from `DATABASE_SCHEMA.md`.
- **Affected Documents:** `DATABASE_SCHEMA.md`, `QUEUE_WORKER_ARCHITECTURE.md`, `EXECUTION_ENGINE.md`.
- **Why It Matters:** Retrying a step that executed an external mutation could trigger duplicate emails or double-charging.
- **Possible Options:**
  - *Option A:* Add `CREATE TABLE execution.side_effect_receipts` to `DATABASE_SCHEMA.md`.
  - *Option B:* Store side effect receipts inside JSONB metadata of `execution.step_executions`.
- **Recommended Option:** **Option A.**
- **Consequence of Choosing It:** Enforces unique constraints on `effect_key` at the database engine level, providing ironclad duplicate mutation prevention.

---

### ISSUE-05 [HIGH]: Queue Worker Ingestion Topology Ambiguity (Direct Polling vs Outbox Dispatcher)
- **Problem:** `QUEUE_WORKER_ARCHITECTURE.md` illustrates workers directly polling `execution.step_executions` using `FOR UPDATE SKIP LOCKED`. Meanwhile, `EVENT_MODEL.md` and `EXECUTION_ENGINE.md` describe inserting into `system.outbox_events` and workers calling `Queue.ack()`.
- **Affected Documents:** `QUEUE_WORKER_ARCHITECTURE.md`, `EVENT_MODEL.md`, `EXECUTION_ENGINE.md`.
- **Why It Matters:** Architectural confusion regarding who does the polling. If workers poll `step_executions` directly, `outbox_events` is not in the execution critical path. If an Outbox dispatcher transfers work to a queue, workers poll the queue.
- **Possible Options:**
  - *Option A:* **Direct Polling for Execution Work (Phase 1):** Workers directly poll `execution.step_executions` via `FOR UPDATE SKIP LOCKED`. `system.outbox_events` is used strictly for publishing asynchronous domain events to external subscribers and audit listeners.
  - *Option B:* **Outbox-Mediated Queue (Phase 1):** Step readiness writes a message to `system.queue_messages` via outbox, and workers only poll `system.queue_messages`.
- **Recommended Option:** **Option A (Direct Polling on `step_executions` for execution work; Outbox strictly for domain events).**
- **Consequence of Choosing It:** Eliminates a hop and a polling daemon for MVP execution. Step state transitions, claiming, leases, and fencing all reside cleanly in `execution.step_executions`.

---

### ISSUE-06 [HIGH]: Discrepancy in Entity and Table Naming across Code Snippets vs DDL
- **Problem:** In `EXECUTION_ENGINE.md` Section 8.1, example queries write:
  `SELECT * FROM execution.steps` and `INSERT INTO execution.step_attempts`.
  In `DATABASE_SCHEMA.md`, the actual tables are:
  `planning.plan_steps`, `execution.step_executions`, and `execution.execution_attempts`.
- **Affected Documents:** `EXECUTION_ENGINE.md`, `DATABASE_SCHEMA.md`.
- **Why It Matters:** Developers copying patterns from `EXECUTION_ENGINE.md` will write SQL queries against non-existent tables.
- **Possible Options:**
  - *Option A:* Standardize all documentation and illustrative code snippets to match `DATABASE_SCHEMA.md`:
    - `execution.step_executions`
    - `execution.execution_attempts`
    - `planning.plan_steps`
  - *Option B:* Rename the database tables in `DATABASE_SCHEMA.md` to `execution.steps` and `execution.step_attempts`.
- **Recommended Option:** **Option A.**
- **Consequence of Choosing It:** Preserves the clean domain boundary established in `INTERNAL_DATA_MODEL.md` between static plan steps (`planning.plan_steps`) and dynamic execution runs (`execution.step_executions`).

---

### ISSUE-07 [HIGH]: Validation Engine Specification Document Missing on Disk
- **Problem:** Rule `E-007` and ADR-085 mandate that no step can transition to `COMPLETED` without passing validation. However, `docs/VALIDATION_ENGINE.md` has not been ingested yet.
- **Affected Documents:** `00_PROJECT_STATUS.md`, `EXECUTION_ENGINE.md`, `INTERNAL_DATA_MODEL.md`.
- **Why It Matters:** The multi-tiered truth architecture (Schema validation $\to$ Deterministic validation $\to$ Independent model validation $\to$ Disagreement resolution) is incomplete without its formal contract.
- **Possible Options:**
  - *Option A:* Ingest `VALIDATION_ENGINE.md` prior to beginning implementation.
  - *Option B:* Implement a dummy passthrough validator for MVP Vertical Slice 1.
- **Recommended Option:** **Option A.**
- **Consequence of Choosing It:** Completes the core triad (Resource Intelligence $\to$ Execution Engine $\to$ Validation Engine) before writing code.

---

## 4. Architectural Decision Inventory & Status Classifications

### A. Decisions that are FINAL (Must NOT be Reopened)
The following 92 architectural decisions are formally ratified and must not be reopened:
- **ADR-001 through ADR-015:** Master architecture, modular monolith, task-first philosophy, anti-router doctrine.
- **ADR-016 through ADR-021:** Data contracts, UUIDv7 primary keys, immutability separation, soft deletes.
- **ADR-022 through ADR-028:** Database schemas, KMS secret isolation, two-phase network isolation, partial index on outbox.
- **ADR-029 through ADR-036:** Universal event envelope, command/event separation, quota migration choreography, outbox pattern.
- **ADR-037 through ADR-054:** Queue delivery mechanism, `FOR UPDATE SKIP LOCKED`, monotonic fencing tokens, ACK last invariant, jittered backoff.
- **ADR-055 through ADR-066:** Provider Anti-Corruption Layer, `UnifiedRequest`/`UnifiedResponse`, 16-error taxonomy, tool execution isolation, KMS handles.
- **ADR-067 through ADR-079:** Resource identity `(Provider, Model, Credential)`, logical quota reservations, actual usage reconciliation, free-first routing, empirical circuit breakers.
- **ADR-080 through ADR-092:** Task-centric durable execution, attempt isolation, artifact-first architecture, validation barrier, recovery budgets, unknown outcome first-class state, side-effect receipts, cryptographic provenance.

---

### B. Decisions that are Genuinely OPEN
The following architectural decisions are genuinely open and require explicit resolution:
1. **ADR-093 (Pending): Technology Stack & Language Runtime:** Formal ratification of TypeScript (Node.js) vs Python for core engine runtime.
2. **ADR-094 (Pending): Work Queue Claim Topology:** Explicit ratification that workers poll `execution.step_executions` directly via `SKIP LOCKED` in Phase 1, reserving `system.outbox_events` for asynchronous domain events.
3. **ADR-095 (Pending): Dedicated Outbox & Consumption Tables:** Formal adoption of `system.outbox_events` and `system.event_consumptions` in physical DDL.
4. **ADR-096 (Pending): Physical Side-Effect Receipts Table:** Formal adoption of `execution.side_effect_receipts` in physical DDL.

---

### C. Decisions that are IMPLIED / ALREADY DETERMINED
1. **TypeScript as Runtime:** *IMPLIED / ALREADY DETERMINED.* All interfaces, type definitions, and signatures in `INTERNAL_DATA_MODEL.md`, `PROVIDER_ADAPTER_CONTRACT.md`, `RESOURCE_INTELLIGENCE.md`, and `EXECUTION_ENGINE.md` are authored in TypeScript.
2. **Database Driver Strategy:** *IMPLIED / ALREADY DETERMINED.* The requirements for `UUIDv7`, `FOR UPDATE SKIP LOCKED`, monotonic fencing conditional updates, and transactional outboxes dictate a high-performance typed query builder or raw driver (`pg` + `Kysely` or `Prisma/Drizzle` with raw SQL support) rather than a heavy, restrictive ORM.
3. **In-DB Outbox for MVP:** *IMPLIED / ALREADY DETERMINED.* ADR-017 and ADR-049 explicitly reject external message brokers (Kafka/RabbitMQ/Redis) for Phase 1.

---

### D. Decisions that Should be Postponed Until After First Vertical Slice
The following decisions are non-blocking for Vertical Slice 1 and should be postponed:
1. **Dynamic Weighted Fair Queuing (WFQ) across tenants.**
2. **Automated Multi-Region Credential Failover.**
3. **Disagreement Engine & Multi-Model Debate Arbitration.**
4. **Reputation Engine Bayesian Scoring Decay Formulas.**
5. **Dynamic DAG Fan-Out to 100+ Parallel Subtasks.**
6. **WebSocket / Server-Sent Events (SSE) Client Streaming Protocols.**

---

### E. Decisions that are Unnecessary Overengineering for MVP
1. **Microservice Splitting:** Keeping the engine as a clean Modular Monolith is 100% correct.
2. **External Message Broker Infrastructure:** Deploying Kafka or Redis before validating PostgreSQL `SKIP LOCKED` throughput is premature.
3. **Temporal / Cadence Workflow Engines:** Building an external workflow orchestrator when PostgreSQL ACID transactions and checkpoints satisfy the exact requirements is wasteful.
4. **Complex Vector Search for Resource Intelligence:** Relational filters + empirical telemetry tables (`resource_health`) are completely sufficient.

---

### F. Architectural Assumptions that Cannot Realistically be Guaranteed
1. **Physical Provider-Side Cancellation:** AI providers (e.g., OpenAI, Anthropic, Google) do not guarantee that severing an HTTP socket immediately cancels remote GPU compute or avoids billing. The system can only guarantee **logical cancellation**—fencing out stale responses, refusing to commit artifacts, and releasing local reservations.
2. **Instant Vendor Quota Telemetry:** AI providers do not provide real-time, sub-second quota synchronization APIs. Logical reservations (`resource_reservations`) remain **optimistic approximations**, not vendor-guaranteed reservations.
3. **Infinite Free-Tier Availability:** Free provider tiers are subject to unannounced rate reductions and CAPTCHA walls. The system's circuit breakers must gracefully fall back to waiting or requesting policy escalation without crashing.

---

## 5. Summary & Actionable Recommendations

### 5.1 Architecture Readiness Status: **NOT READY**

### 5.2 Required Actions Prior to Coding:
1. **Synchronize `DATABASE_SCHEMA.md`:**
   - Add missing runtime columns to `execution.step_executions`: `worker_id`, `lease_token`, `lease_expires_at`, `fencing_token`, `priority`, `available_at`, `updated_at`.
   - Add missing tables: `execution.side_effect_receipts`, `system.outbox_events`, `system.event_consumptions`.
2. **Harmonize Entity Naming in `EXECUTION_ENGINE.md`:**
   - Update illustrative SQL snippets to reference `execution.step_executions` and `execution.execution_attempts`.
3. **Formally Ratify ADR-093 through ADR-096:**
   - Ratify TypeScript (Node.js) runtime.
   - Ratify direct `SKIP LOCKED` polling on `step_executions`.
   - Ratify dedicated outbox and side-effect receipt tables.
4. **Ingest `VALIDATION_ENGINE.md`:**
   - Receive and normalize the Truth & Validation specification to complete the validation barrier architecture.

---

> **Audit Enforcement:** In strict compliance with `AGENT_RULES.md`, no production code, dependencies, or migrations shall be written until these architectural corrections are approved and executed.

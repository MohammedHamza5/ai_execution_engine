# AI Execution Engine — Master Architecture Specification

**Document:** `MASTER_ARCHITECTURE.md`  
**Status:** COMPLETE (Architecture Baseline / Pre-Implementation)  
**Version:** 1.0.0  
**Authority:** Derived from Master Architecture & Product Specification Baseline  

---

## 1. Purpose

The AI Execution Engine is an **AI Execution Infrastructure and Resource Orchestration Engine** designed to completely abstract AI infrastructure from developers.

Unlike simple model routers or API wrappers, the engine eliminates the need for developers to manually manage models, providers, quotas, rate limits, HTTP 429 errors, retries, fallbacks, task decomposition, migrations, intermediate state, and output validation. The developer submits a task, and the engine determines and executes the optimal strategy using legitimate resources available at runtime.

### Core Architectural Principle
> *«We do not search for the best model. We search for the best possible execution of the task using the resources legitimately available now.»*  
> *«The model is a worker. The task is the durable unit of execution.»*  
> *«The execution engine moves artifacts, not chat messages.»*

---

## 2. Responsibilities

The Master Architecture defines and governs:
1. **Task Intelligence:** Understanding developer intent, extracting inputs/outputs, evaluating complexity, and mapping required capabilities.
2. **Execution Planning:** Formulating execution strategies (Single Model, Specialist Pipeline, Parallel Debate, Cheap-First, Progressive Escalation) and validating plans via DAG validation.
3. **Resource Intelligence:** Tracking actual runtime capacity, quotas, rate limits (RPM, RPD, TPM, TPD), latencies, health status, and credentials across provider instances.
4. **Durable Execution:** Managing the task state machine, execution hierarchy (`TASK` → `PLAN` → `STEP` → `EXECUTION` → `ATTEMPT`), checkpoints, and safe migrations across workers.
5. **Provider Abstraction:** Enforcing strict boundaries where all provider SDKs, proprietary formats, and error codes terminate at adapter boundaries.
6. **Artifact Management & Handoffs:** Managing first-class artifacts, structured claims, evidence, and formal handoff packages for multi-model collaboration.
7. **Truth & Validation:** Decoupling generation from validation (`Generation != Truth`), utilizing deterministic, execution-based, mathematical, and cross-model validators.
8. **Reputation & Evaluation Loop:** Continually updating multi-dimensional, evidence-backed provider reputations without allowing unvalidated model outputs to contaminate ground truth.
9. **Observability & Auditability:** Recording comprehensive traces across tasks, steps, attempts, resources, and decisions without leaking secrets.

---

## 3. Non-Responsibilities & Non-Goals

The system explicitly does **NOT** own or attempt to:
- Be an OpenRouter clone or simple model routing proxy.
- Provide or promise "Unlimited Free AI".
- Bypass quotas, rotate keys illicitly, create fake accounts, exploit bugs, or violate provider terms of service.
- Spend paid credits silently or without explicit developer policy permission.
- Replace AI providers or build proprietary foundation models.
- Build AGI or attempt to solve every modality in Version 1.
- Allow models to evaluate or grade themselves without independent validation.
- Treat model-to-model chat as an execution state mechanism.

---

## 4. Architectural Layers & Workflow

The architecture is structured across **5 Core Layers** with a continuous feedback loop:

```text
               DEVELOPER / CLIENT
                       ↓
         ┌───────────────────────────────┐
         │      UNIFIED API / SDK        │
         └─────────────┬─────────────────┘
                       ↓
  LAYER 1: INTELLIGENCE
  ├── Task Understanding (Intent, Input, Output)
  ├── Task Profiling
  ├── Complexity Engine (0.0 - 1.0 Multi-dimensional)
  └── Capability Graph Construction
                       ↓
  LAYER 2: PLANNING
  ├── Execution Strategy Engine (Candidate generation)
  ├── Execution Planner (DAG formation)
  └── Plan Validator (Resource feasibility & Quality Floor)
                       ↓
  LAYER 3: RESOURCE INTELLIGENCE
  ├── Model Registry & Health Monitor
  ├── Credential Vault (Encrypted)
  ├── Quota Forecasting & Capacity Tracking
  └── Resource Scoring & Logical Reservation
                       ↓
  LAYER 4: EXECUTION
  ├── Transactional Queue & Worker Pool
  ├── State Machine & Checkpointing
  ├── Provider Adapters (Gemini, Groq, Mistral, OpenRouter, etc.)
  ├── Model Handoff Protocol
  └── Checkpoint & Migration Manager (on Quota/429 failure)
                       ↓
  LAYER 5: TRUTH & VALIDATION
  ├── Deterministic Validation (Schema, Regex, Types)
  ├── Execution Validation (Compilers, Test Suites)
  ├── Mathematical Solvers
  ├── Cross-Model Disagreement Engine
  └── Critic & Self-Correction Loop
                       ↓
               VERIFIED RESULT
                       ↓
  FEEDBACK: EVALUATION & REPUTATION
  ├── Evidence-Driven Reputation Engine
  ├── Benchmark Suite (Internal & Empirical)
  └── Bayesian / Weighted Score Updating
                       ↓
         (Informs Future Layer 2 & 3 Decisions)
```

---

## 5. Execution Hierarchy & State Machine

### 5.1 Execution Hierarchy
State is organized strictly hierarchically:
```text
TASK          (The top-level durable business request)
  └── PLAN    (The active DAG execution strategy)
        └── STEP        (A distinct unit of work: Vision, OCR, Reasoning, etc.)
              └── EXECUTION    (The invocation lifecycle of a step)
                    └── ATTEMPT      (A disposable invocation against a specific Resource)
```

### 5.2 Task State Machine
```text
[PENDING] → [PLANNING] → [READY] → [RUNNING] ──→ [VALIDATING] ──→ [COMPLETED]
                             │           │             │
                             │           ↓             ↓
                             │     [CHECKPOINT]   [DIAGNOSING]
                             │           ↓             ↓
                             └─── [MIGRATING] ──→ [WAITING_FOR_CAPACITY]
                                         │
                                         ↓
                                      [FAILED] / [CANCELLED]
```

- **Transitions:**
  - `CHECKPOINT`: Triggered after critical steps, before provider migrations, and after significant artifacts are committed.
  - `MIGRATING`: Triggered when an active attempt encounters a recoverable failure (e.g., HTTP 429 / Quota Exhaustion).
  - `DIAGNOSING`: Evaluates validation failures before deciding between repair, retry, or strategy escalation.

---

## 6. Execution Strategies

The Execution Planner selects from distinct architectural strategies depending on task complexity, quality floor, and resource availability:

1. **Strategy A — Single Model:** Direct execution with a capable model followed by validation. Used for low-complexity tasks (`Complexity < 0.4`).
2. **Strategy B — Specialist Pipeline:** Sequential pipeline of specialized workers (e.g., `Vision → OCR → Reasoning → Validator`).
3. **Strategy C — Parallel Debate & Synthesis:** Multiple candidate solvers run in parallel; outputs are fed to a deterministic comparator or judge model to resolve disputes.
4. **Strategy D — Cheap-First Escalation:** Execute initially on a fast/free tier model. If confidence or validation fails, escalate to a high-capacity model.
5. **Strategy E — Progressive Multi-Level Escalation:**
   - Level 1: Fast / Free
   - Level 2: Superior / Free
   - Level 3: Multi-Model Specialist Pipeline
   - Level 4: Paid Provider (Requires explicit policy permission)

---

## 7. Artifact-Centric Multi-Model Collaboration

Models never interact via unconstrained chat history. All collaboration is governed by structured, immutable artifacts:

### 7.1 Core Collaboration Primitives
- **Artifact:** Durable output stored with hash, metadata, producer provenance, and validation status (`artifact://task_id/step_id/name.json`).
- **Claim:** An assertion made by a model (e.g., `"Question 14 = B"`).
- **Evidence:** Concrete data backing a claim (e.g., `"calculation_artifact_42"`).
- **Decision:** A deterministic choice or synthetic resolution made during planning or execution.
- **Validation Report:** Output of the independent Truth Engine confirming schema, consistency, or test passage.
- **Dispute:** Formal structure created when two independent paths disagree; resolved by evidence analysis rather than simple majority vote.
- **Handoff Package:** The exact constrained bundle passed to the next worker containing objective, completed work, input artifacts, validation rules, and output schemas.

---

## 8. Resource Intelligence & Economic Safety

### 8.1 Resource Entity Distinction
The system maintains strict boundaries between infrastructure levels:
- **Provider:** The organization/API host (e.g., Google, Groq, Mistral).
- **Model:** The foundation model architecture (e.g., Gemini 1.5 Pro, Llama 3.3 70B).
- **Credential:** The encrypted secret / API key instance.
- **Resource Instance:** The concrete tuple `(Provider, Model, Credential)` possessing runtime capacity, rate limits, and health state.

### 8.2 Free-First Resource Allocation Hierarchy
When allocating resources for a step, the engine follows this strict sequence:
1. Suitable Free Resource meeting the Quality Floor.
2. Alternative Compatible Free Resource.
3. Task Decomposition / Step Splitting into smaller free-tier units.
4. Wait for Rate-Limit / Quota Window Reset (if task latency policy permits).
5. Solicit Explicit User Policy Permission for Paid Resource.
6. Honest Failure (Return unexecutable status; never spend money silently).

### 8.3 Circuit Breaker & Health
Resources transition dynamically:
`HEALTHY` → `DEGRADED` (elevated 429s/latency) → `CIRCUIT OPEN` (temporarily excluded) → `HALF OPEN` (canary probe) → `HEALTHY`.

---

## 9. Failure Intelligence & Adaptive Recovery

External calls are inherently unreliable. Failures are classified into standardized taxonomy:

| Failure Category | Trigger Example | Recovery Behavior |
| :--- | :--- | :--- |
| **Temporary / Network** | Timeout, Socket drop, 503 Overload | Backoff retry on same or equivalent resource |
| **Quota / Rate Limit** | HTTP 429, daily quota exhausted | Checkpoint task state → Migrate step to alternative resource → Spawn Attempt N+1 → Resume |
| **Capability Mismatch** | Modality unsupported (e.g., image rejected) | Planner replans or reroutes step to multimodal-capable resource |
| **Context Length** | Token count exceeds context window | Compress, chunk, summarize, or migrate to large-context resource |
| **Output / Schema** | Malformed JSON, missing fields | Repair prompt, retry with structured schema enforcement, or alternate model |
| **Quality Failure** | Low validation confidence, critic rejection | Critic diagnosis → targeted repair step → re-validation (Max attempts capped) |
| **Unknown Outcome** | Ambiguous timeout during generation | Treated as first-class state; state queried or attempt fenced before retrying |

> **Invariant:** Never blindly retry the same prompt on the same failing model. Every retry must have a classified diagnosis and strategic adjustment.

---

## 10. Truth & Validation Engine

### 10.1 Principle
> *«Generation does not equal truth. Model agreement is not proof of correctness.»*

### 10.2 Validation Routing
Validation is strictly decoupled from generation and routed deterministically:
- **Code:** Executed against compilers, static linters, and unit/integration tests.
- **Math / Logic:** Deterministic solvers, symbolic calculators, and constraint checkers.
- **Structured Data / JSON:** JSON Schema validation, type checks, enum constraints.
- **OCR / Vision:** Cross-consistency checks against source artifacts.
- **Research / Extraction:** Source citation cross-checking and ground-truth verification.
- **Reasoning / General:** Independent solver evaluation and critic models.

---

## 11. Multi-Dimensional Reputation Engine

Reputation is never a single monolithic score. It is tracked across capability dimensions (Reasoning, Coding, Arabic, OCR, Vision, JSON Schema, etc.) and computed via:

$$\text{Reputation} = f(\text{Research Priors}, \text{Official Benchmarks}, \text{Internal Benchmarks}, \text{Production Validation}, \text{Recency}, \text{Sample Size})$$

- **Confidence Score:** Accompanies every reputation metric ($[0.0, 1.0]$) reflecting sample volume and empirical variance.
- **Feedback Contamination Prevention:** Model outputs are strictly categorized as `MODEL_CLAIM` and never converted into ground truth without independent, verified validation.

---

## 12. Architectural Decision Log (ADL)

- **ADR-001 (Not an OpenRouter Clone):** Focus is on orchestration, planning, durable execution, validation, and multi-model collaboration.
- **ADR-002 (Task Is Durable; Calls Are Disposable):** Tasks persist in PostgreSQL; individual model invocations and attempts are transient.
- **ADR-003 (Structured Multi-Model Collaboration):** Elimination of chat rooms; models interact exclusively through typed artifacts, claims, and handoff packages.
- **ADR-004 (Hybrid Reputation System):** Combines research priors with empirical production validation to avoid blind starts.
- **ADR-005 (Multi-Dimensional Reputation):** Evaluation is domain-specific; a model may excel at Arabic OCR while failing at Python refactoring.
- **ADR-006 (Free-First Allocation):** Prioritize legitimate free tiers without violating provider terms.
- **ADR-007 (Zero Silent Paid Usage):** Paid API usage strictly requires explicit developer policy configuration.
- **ADR-008 (No Quota Bypass / Hack Policy):** Zero tolerance for key rotation abuse, multi-account scraping, or TOS circumvention.
- **ADR-009 (Strict Provider Abstraction):** Engine core is completely provider-agnostic.
- **ADR-010 (Resource != Model):** Concrete execution capability is bound to a `Resource Instance` (Model + Credential + Runtime Capacity).
- **ADR-011 (Decoupled Validation):** Generation and validation operate as independent phases.
- **ADR-012 (Execution Strategy Selection):** Engine selects the optimal execution graph/strategy, not merely a model name.
- **ADR-013 (First-Class Artifacts):** Intermediate and final outputs are versioned, immutable, content-hashed artifacts.
- **ADR-014 (Checkpoint Before Migration):** State must be ACID-persisted before migrating across providers to ensure zero data loss.
- **ADR-015 (Dynamic Model Registry):** Models are discovered, benchmarked, registered, monitored, and retired dynamically.

---

## 13. System Invariants

1. **State Durability:** PostgreSQL is the single source of truth. The queue is only a message delivery mechanism.
2. **At-Least-Once Delivery & Idempotency:** Workers must be idempotent consumers capable of handling redelivered execution steps.
3. **Transaction Safety:** Database transactions must NEVER be held open across external AI network calls.
4. **Credential Isolation:** API keys and credentials are encrypted at rest and never printed in logs, artifacts, or error traces.
5. **No Task Restart on Quota Failure:** Quota exhaustion on Step $N$ must resume from Step $N$ via checkpointing, never restarting from Step 1.

---

## 14. Technical Decisions Resolution Status

The following core architectural questions have been systematically resolved:
1. **Core Runtime & Technology Stack:** **RESOLVED by ADR-093** — TypeScript (Node.js) Modular Monolith with strict mode.
2. **Queue Backend & Execution Topology:** **RESOLVED by ADR-094** — PostgreSQL `execution.step_executions` via `FOR UPDATE SKIP LOCKED`.
3. **Event Bus & Outbox Implementation:** **RESOLVED by ADR-095** — Transactional outbox buffer via `system.outbox_events` and deduplication via `system.event_consumptions`.
4. **Side-Effect Idempotency:** **RESOLVED by ADR-096** — Database-enforced uniqueness via `execution.side_effect_receipts`.
5. **Artifact Storage Strategy:** **RESOLVED by ADR-019 / ADR-084** — Hybrid (< 64 KB inline in PostgreSQL, >= 64 KB in S3-compatible Object Storage).
6. **Credential Encryption Scheme:** **RESOLVED by ADR-023 / ADR-053 / ADR-060** — Ephemeral KMS secret handles, zero plaintext secrets.
7. **Cancellation & Zombie Fencing:** **RESOLVED by ADR-039 / ADR-082** — Monotonic fencing tokens and dynamic leases.
8. **Provider Error Normalization:** **RESOLVED by ADR-058 / ADR-086** — 16-error adapter taxonomy mapped to 8 execution outcomes.

Remaining secondary questions (SLA tiers, benchmark harness, Bayesian decay formulas) are explicitly deferred until post-Vertical Slice 1.

---

## 15. Architectural Decisions Enshrined (ADR-001 through ADR-096)

- **ADR-001 to ADR-015:** Master architecture principles, anti-router doctrine, and task-first durability.
- **ADR-016 to ADR-021:** Universal UUIDv7, immutability separation, soft deletes, and relational data contracts.
- **ADR-022 to ADR-028:** PostgreSQL DDL boundaries, zero network calls inside DB transactions, and optimistic reservations.
- **ADR-029 to ADR-036:** Event model, aggregate causal ordering, and consumer deduplication.
- **ADR-037 to ADR-054:** Queue runtime, ACK last invariant, dynamic leases, and automated reaper.
- **ADR-055 to ADR-066:** Provider Anti-Corruption Layer, tool execution sandboxing, and contract test certification.
- **ADR-067 to ADR-079:** Resource identity `(Provider, Model, Credential)`, free-first hierarchy, zero silent spend, and circuit breakers.
- **ADR-080 to ADR-092:** Durable execution state machine, `HandoffPackage`, recovery budgets, unknown outcome first-class handling, and provenance graphs.
- **ADR-093:** Core Runtime: TypeScript (Node.js) with strict mode in a Modular Monolith.
- **ADR-094:** Execution Work Queue: Workers claim work directly from `execution.step_executions` via `SKIP LOCKED`.
- **ADR-095:** Dedicated Outbox & Consumer Tables: `system.outbox_events` and `system.event_consumptions` decouple delivery buffers from immutable event logs.
- **ADR-096:** Side-Effect Receipts: `execution.side_effect_receipts` enforces unique `effect_key` constraint for non-generative mutations.

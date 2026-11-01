# TRUTH & VALIDATION ENGINE SPECIFICATION

## 0. Document Status
- **Status:** Core Architecture Contract — Ratified Baseline
- **Version:** `1.1` (Reconciled Baseline)
- **Domain:** Verification, Semantic Truth, Disagreement Resolution, Confidence Scoring
- **Upstream Dependencies:** [`MASTER_ARCHITECTURE.md`](./MASTER_ARCHITECTURE.md), [`INTERNAL_DATA_MODEL.md`](./INTERNAL_DATA_MODEL.md), [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md), [`EXECUTION_ENGINE.md`](./EXECUTION_ENGINE.md), [`RESOURCE_INTELLIGENCE.md`](./RESOURCE_INTELLIGENCE.md)
- **Downstream Consumers:** Execution Engine, Reputation Engine, Audit Pipeline, Client API

---

## 1. Executive Summary & Purpose

The **Truth & Validation Engine** is the sovereign verification barrier of the AI Execution Infrastructure. Its sole responsibility is to evaluate whether outputs produced by probabilistic AI models satisfy objective correctness, syntactic schemas, deterministic logic, empirical test execution, and factual evidence grounding.

> **The Sovereign Truth Principle:**
> *«Generation is NOT truth. Model agreement is NOT proof. The AI model is an untrusted candidate worker; the Validation Engine is the independent arbiter of correctness.»*

The Validation Engine prevents the system from becoming an unconstrained hallucination amplifier. An HTTP 200 `SUCCESS` status from an external AI provider signifies only that a remote server returned tokens over a network connection; it carries zero guarantee of truth, logic, syntax, compilation, or policy compliance. 

Under **Rule `E-007`** and **ADR-085**, no execution step or task may transition to `COMPLETED` without satisfying its authoritative validation barrier.

---

## 2. Core Architectural Principles & Invariants

1. **Generation is Decoupled from Truth (ADR-097):** Generative models predict plausible token distributions; they do not verify reality. Validation is structurally, temporally, and logically decoupled from generation.
2. **Model Agreement is Not Proof (ADR-100):** If Model A and Model B generate identical incorrect answers (a common pathology resulting from shared pre-training corpora and popular web misconceptions), their consensus does not establish truth. Naive majority voting is strictly rejected.
3. **Deterministic-First Precedence (ADR-099):** Deterministic evaluators (compilers, AST type checkers, mathematical solvers, schema validators) always supersede probabilistic model critics. A language model's subjective opinion can never overturn a compiler syntax error or an arithmetic inequality.
4. **Task-Appropriate Validation Topology (ADR-098):** Validation pipelines are dynamic and task-dependent. The engine does not run every artifact through every stage; rather, it applies the exact verification methods appropriate to the work (e.g., compilers for code, formal math parsers for arithmetic, JSON schemas for structured payloads, source citations for research claims).
5. **Tri-State Validation Architecture (`ACCEPT`, `REJECT`, `UNCERTAIN` - ADR-101):** Validation never compresses ambiguous outcomes into a binary pass/fail. If confidence falls below the required floor or evidence is inconclusive, the outcome remains explicitly `UNCERTAIN`. Silent promotion of unverified outputs is prohibited.
6. **Zero Silent Spend on Validation (ADR-104):** Automated validation must prioritize free, local, deterministic checks. Secondary model critics require explicit policy authorization and must never silently deplete paid quotas.
7. **Durable, Audited Validation Records (ADR-103):** Validation runs, rule results, extracted claims, cited evidence, and dispute resolutions are persisted immutably in PostgreSQL to provide complete forensic explainability.

---

## 3. The Multi-Tiered Verification Boundary (8 Stages)

The Validation Engine defines an 8-stage verification hierarchy. Stages are engaged selectively based on task requirements:

```text
       ┌────────────────────────┐
       │ 1. GENERATION OUTPUT   │ (Raw Model Artifact)
       └───────────┬────────────┘
                   ▼
       ┌────────────────────────┐
       │ 2. SCHEMA VALIDATION   │ (Syntactic structure, JSON Schema, Zod)
       └───────────┬────────────┘
                   ▼
       ┌────────────────────────┐
       │ 3. DETERMINISTIC CHECK │ (Formal math, regex, bounds, hashes)
       └───────────┬────────────┘
                   ▼
       ┌────────────────────────┐
       │ 4. EXECUTION CHECK     │ (Sandbox compiler, test runner, linter)
       └───────────┬────────────┘
                   ▼
       ┌────────────────────────┐
       │ 5. EVIDENCE CHECK      │ (Source grounding, claim citation match)
       └───────────┬────────────┘
                   ▼
       ┌────────────────────────┐
       │ 6. INDEPENDENT CRITIC  │ (Isolated prompt, alternate model solver)
       └───────────┬────────────┘
                   ▼
       ┌────────────────────────┐
       │ 7. DISAGREEMENT ENGINE │ (Position analysis, arbitrated dispute)
       └───────────┬────────────┘
                   ▼
       ┌────────────────────────┐
       │ 8. CONFIDENCE GATE     │
       └─────┬────────────┬─────┘
             │            │
    Score >= Floor   Score < Floor or Ambiguous
             ▼            ▼
          ACCEPT       UNCERTAIN / REJECT
```

### Stage 1: Generation Output Handshake
Receives the immutable `Artifact` reference produced by an `ExecutionAttempt`. Validates content integrity via SHA-256 hash match against object storage.

### Stage 2: Schema Validation (Structural)
Enforces strict structural compliance for structured outputs (JSON, YAML, CSV). Uses deterministic JSON Schema / Zod definitions. Detects missing mandatory keys, type mismatches, unexpected fields, and truncated strings.
* *Outcome on Failure:* Immediate `REJECT` $\to$ Triggers `STRUCTURED_OUTPUT_PARSE_ERROR` recovery with targeted schema repair prompt.

### Stage 3: Deterministic Validation (Formal Rules)
Applies non-probabilistic logical assertions requiring zero AI inference:
* Mathematical formulas evaluated via deterministic symbolic math engines.
* Numeric ranges, bounds, currency rounding, and date formatting.
* Cryptographic signature checks and regex pattern verification.
* *Outcome on Failure:* Immediate `REJECT` $\to$ Model opinion disregarded.

### Stage 4: Execution Validation (Empirical Sandbox)
Applies exclusively to executable assets (TypeScript, Python, SQL, Shell, HTML/CSS):
* Code must parse successfully through formal AST parsers (e.g., `tsc --noEmit`, `py_compile`).
* Code must pass static linting and security scanners (detecting dangerous system calls).
* Unit tests or assertion suites executed within isolated, sandboxed containers.
* *Outcome on Failure:* Immediate `REJECT` $\to$ Compiler diagnostics attached to `HandoffPackage`.

### Stage 5: Evidence Validation (Source Grounding)
Applies to information extraction, document summarization, OCR, and research tasks:
* Extracts atomic propositions from the artifact and stores them as `validation.claims`.
* Verifies that each claim is explicitly substantiated by cited source text spans (`validation.evidence`).
* Computes Grounding Precision based on substantiated vs. total claims.
* *Outcome on Failure:* If Grounding Precision $<$ Policy Floor, flagged as unsupported hallucination $\to$ `REJECT`.

### Stage 6: Independent Model Validation (Critic / Dual-Solver)
Used only when deterministic and empirical checks are insufficient (e.g., nuanced reasoning, complex translation):
* **Dual-Solver Protocol:** A secondary independent model solves the objective independently from scratch without seeing Model A's output.
* **Critic Protocol:** An isolated model receives the objective and output, prompted strictly as an adversarial auditor.
* **Economic Guard:** Invoked only if the task policy explicitly authorises multi-model verification.

### Stage 7: Disagreement Resolution (Dispute Arbitration)
When two models produce conflicting answers:
1. Records a `validation.disputes` entry with `subject_type = 'step_execution'`.
2. Compiles competing `dispute_positions` detailing reasoning steps.
3. Rather than averaging scores or taking majority votes, the engine evaluates:
   - Which position satisfies more deterministic assertions?
   - Which position has stronger source grounding citations?
4. **Evidentiary Rule:** Model reasoning traces are *candidate arguments*, not independent proof. Deterministic execution and source citations possess absolute evidentiary authority over conversational explanations.

### Stage 8: Confidence Aggregation & Decision Gate
Computes the aggregate confidence score across applicable validation tiers:
$$\text{Confidence} = \sum_{i \in \text{Applicable Tiers}} w_i \cdot s_i$$
Where weights $w_i$ and thresholds are defined by **Task Policy Configuration**, not hard-coded system constants.
* **`ACCEPT`:** $\text{Confidence} \ge \text{Quality Floor}$ AND zero deterministic errors.
* **`REJECT`:** Fails mandatory deterministic checks, syntax validation, or confidence $\le \text{Rejection Threshold}$.
* **`UNCERTAIN`:** Output passes syntactic checks, but evidence is ambiguous, or disagreement remains unresolved, or confidence lies between rejection threshold and acceptance floor.

---

## 4. Task-Type Validation Topologies

The 8 stages are a comprehensive hierarchy, not a mandatory gauntlet for every task. The engine configures its active stages dynamically:

| Task Category | Active Validation Pipeline | Primary Validation Mechanism |
| :--- | :--- | :--- |
| **Structured JSON** | Stage 1 $\to$ Stage 2 $\to$ Stage 3 $\to$ Stage 8 | JSON Schema / Zod parser |
| **Software Code** | Stage 1 $\to$ Stage 2 $\to$ Stage 3 $\to$ Stage 4 $\to$ Stage 8 | Compiler, AST linter, sandboxed test runner |
| **Math & Arithmetic** | Stage 1 $\to$ Stage 2 $\to$ Stage 3 $\to$ (Stage 6 if ambiguous) $\to$ Stage 8 | Symbolic math evaluator, deterministic solver |
| **OCR & Extraction** | Stage 1 $\to$ Stage 2 $\to$ Stage 3 $\to$ Stage 5 $\to$ Stage 8 | Coordinate overlap, lexical consistency, character checks |
| **Factual Research** | Stage 1 $\to$ Stage 2 $\to$ Stage 5 $\to$ (Stage 6 if authorized) $\to$ Stage 8 | Claim extraction & source text span grounding |
| **Creative / Open-Ended**| Stage 1 $\to$ Stage 2 $\to$ Stage 3 $\to$ Stage 8 | Format constraints, length checks, safety filters |
| **Multi-Hop Reasoning**| Stage 1 $\to$ Stage 2 $\to$ Stage 3 $\to$ Stage 6 $\to$ Stage 7 $\to$ Stage 8 | Step logic assertion, independent dual solver |

---

## 5. Reconciliation with Canonical Execution State Machine

Validation outcomes are domain evaluation results, **NOT** direct state machine states. They map cleanly into the canonical execution lifecycle defined in [`EXECUTION_ENGINE.md`](./EXECUTION_ENGINE.md):

```text
               [RUNNING] (Attempt finishes)
                   │
                   ▼
            [CHECKPOINTING] (Save attempt output)
                   │
                   ▼
             [VALIDATING] (Step Execution status in DB)
                   │
         ┌─────────┼─────────┐
         │         │         │
      ACCEPT    REJECT   UNCERTAIN
         │         │         │
         ▼         ▼         ▼
    [COMPLETED] [DIAGNOSING] [WAITING]
```

### Mapping Rules:
1. **`ACCEPT`:**
   - The validation run in `validation.validations` is marked `status = 'passed'`.
   - `execution.step_executions` transitions from `'validating'` to `'completed'`.
   - `quality_score` is updated with `overallConfidence`.
   - Downstream dependent steps in the Plan DAG are unblocked.
2. **`REJECT`:**
   - The validation run in `validation.validations` is marked `status = 'failed'`.
   - `execution.step_executions` transitions from `'validating'` to `'diagnosing'`.
   - Execution Engine classifies the failure (`QUALITY_FAILURE`), decrements the recovery budget, and determines whether to retry on an alternate model, migrate resource, or replan.
3. **`UNCERTAIN`:**
   - The validation run in `validation.validations` is marked `status = 'uncertain'`.
   - `execution.step_executions` transitions from `'validating'` to `'waiting'` (with `wake_condition` set to `'approval'` or secondary verification).
   - The step execution is **never** silently marked `'completed'`.

### Semantic Boundary for `validation_level: "none"`:
If a task policy explicitly configures `validation_level = "none"` (or `not_required`):
- It does **NOT** mean: *"The AI output is trusted or verified."*
- It means: The developer's policy explicitly declares that verification is not a barrier to step completion for this specific task class (e.g., disposable scratchpad, low-stakes conversational drafting).
- The output artifact in `artifacts.artifacts` remains flagged as `status: 'active'` with **unverified provenance**. Rule `E-007` is satisfied via explicit policy exception without weakening systemic truth invariants.

---

## 6. Two-Phase Validation Transaction Isolation

In strict compliance with **ADR-024** and **ADR-088**, database transactions must never remain open across external network calls, compiler executions, container sandbox runs, or secondary model critic evaluations.

```text
[Phase 1: Validation Claim Transaction]
BEGIN;
  SELECT * FROM execution.step_executions 
  WHERE id = $step_execution_id AND fencing_token = $worker_token;

  UPDATE execution.step_executions 
  SET status = 'validating', updated_at = now() 
  WHERE id = $step_execution_id;

  INSERT INTO validation.validations (
      id, task_id, execution_id, step_execution_id, target_type, target_id, validator_type, status, started_at
  ) VALUES (
      $val_id, $task_id, $exec_id, $step_execution_id, 'artifact', $artifact_id, $validator_type, 'running', now()
  );
COMMIT;
  │
  ▼ (OUTSIDE DATABASE TRANSACTION - Duration: 500ms to 120s)
[Validation Work Execution]
  1. In-memory Schema Validation (Zod / JSON Schema)
  2. In-memory Deterministic Assertions (Math AST, regex)
  3. Sandboxed Compiler / Test Runner Execution (isolated container)
  4. Source Text Evidence Extraction & Span Matching
  5. Secondary Model Critic (if policy permits, requested via Resource Intelligence)
  │
  ▼ (OUTSIDE DATABASE TRANSACTION)
[Phase 2: Validation Completion Transaction]
BEGIN;
  -- Monotonic Fencing Token Assertion (ADR-039 / ADR-082)
  UPDATE execution.step_executions
  SET status = CASE 
        WHEN $outcome = 'ACCEPT' THEN 'completed'
        WHEN $outcome = 'UNCERTAIN' THEN 'waiting'
        ELSE 'diagnosing'
      END,
      quality_score = $confidence,
      updated_at = now()
  WHERE id = $step_execution_id AND fencing_token = $worker_token;
  -- If 0 rows affected, worker lease expired and newer worker took over: ROLLBACK!

  UPDATE validation.validations
  SET status = $val_status, confidence = $confidence, completed_at = now()
  WHERE id = $val_id;

  INSERT INTO validation.validation_results (...) VALUES (...);
  INSERT INTO validation.claims (...) VALUES (...);
  INSERT INTO validation.evidence (...) VALUES (...);
  INSERT INTO execution.checkpoints (...) VALUES (...);
  INSERT INTO system.outbox_events (
      id, event_id, event_type, aggregate_type, aggregate_id, payload
  ) VALUES (
      gen_random_uuid(), $event_id, 'VALIDATION_COMPLETED', 'step_execution', $step_execution_id, $payload
  );
COMMIT;
```

---

## 7. Resource Intelligence & Cost Boundaries

The Validation Engine evaluates outputs; it does **NOT** select providers or route API traffic.
* **Separation of Concerns:** When an independent model critic or dual-solver is required, the Validation Engine submits a structured resource request to **Resource Intelligence**:
  ```typescript
  const criticResource = await resourceIntelligence.selectResource({
    tenantId: context.tenantId,
    requiredCapabilities: ["reasoning"],
    excludeResourceId: context.primaryResourceId, // Force alternate model family
    qualityFloor: taskPolicy.criticQualityFloor,
  });
  ```
* **Zero Silent Spend Enforcement (ADR-072 / ADR-104):** If the tenant policy does not permit paid models, and no capable free resource exists, the Validation Engine does not fail silently or spend money. It marks the model evaluation tier as `SKIPPED` and computes confidence based strictly on deterministic and evidence tiers. If confidence is insufficient, it yields `UNCERTAIN`.

---

## 8. Physical Database Schema Mapping

The Validation Engine maps directly to the authoritative physical schema in [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md) (Domain 4.9):

1. **`validation.validations`:** Tracks the top-level execution run of the validator on a target artifact.
2. **`validation.validation_rules`:** Stores versioned, reusable rule definitions and severity levels (`error`, `warning`).
3. **`validation.validation_results`:** Records individual rule evaluation scores, confidence, and details.
4. **`validation.claims`:** Contains atomic extracted propositions linked to target artifacts.
5. **`validation.evidence`:** Links claims to verifiable source text locations (`excerpt_ref`, `location`).
6. **`validation.disputes`:** Captures conflicting positions between models for arbitration.

---

## 9. Safety Rules & Operational Invariants (V-001 to V-007)

* **`V-001` (Validation Barrier):** No output from an AI provider may bypass validation unless the task policy explicitly authorises `validation_level = "none"`.
* **`V-002` (Deterministic Supersedence):** A passing score from an AI model critic can never override a failed compiler, failing test, broken JSON schema, or arithmetic contradiction.
* **`V-003` (Anti-Agreement Fallacy):** Two models agreeing on an answer does not constitute empirical verification. Agreement without grounding evidence cannot resolve a dispute.
* **`V-004` (Uncertainty Preservation):** Ambiguous or borderline validation outcomes must remain `UNCERTAIN`. Silently rounding up an uncertain result to `ACCEPT` is strictly forbidden.
* **`V-005` (Zero Silent Spend):** Secondary model critics must not be engaged without pre-authorized tenant budget and policy approval.
* **`V-006` (Claim Grounding):** In informational or research domains, ungrounded claims must be flagged as unsupported and deducted from confidence scoring.
* **`V-007` (Audit Durability):** Every validation decision must leave an indelible audit trail in PostgreSQL linking the artifact, evaluated rules, score breakdown, and cited evidence.

---

## 10. Architectural Decisions Enshrined (ADR-097 to ADR-104)

### ADR-097: Generation-Truth Decoupling
* **Decision:** Treat all model outputs as untrusted candidate artifacts requiring independent verification.
* **Rationale:** Language models maximize token probability, not objective veracity.

### ADR-098: Multi-Tiered Task-Appropriate Verification Hierarchy
* **Decision:** Enforce an 8-stage verification pipeline progressing from cheap deterministic checks to empirical sandboxes and isolated critics, configured dynamically by task category.
* **Rationale:** Minimizes latency and API costs by filtering flawed generations at early deterministic stages before invoking heavy evaluation.

### ADR-099: Deterministic Precedence Rule
* **Decision:** Compilers, AST linters, symbolic math parsers, and schema validators have absolute priority over probabilistic model opinions.
* **Rationale:** Eliminates subjective hallucinated approvals of objectively broken code or inaccurate math.

### ADR-100: Rejection of Majority Voting
* **Decision:** Reject naive $N$-model consensus voting for correctness verification. Disputes are resolved via evidence grounding and deterministic arbitration.
* **Rationale:** Shared pre-training corpora cause multiple foundation models to repeat identical factual inaccuracies.

### ADR-101: Tri-State Validation Architecture
* **Decision:** Implement explicit `ACCEPT`, `REJECT`, and `UNCERTAIN` terminal validation outcomes mapped to canonical execution states (`completed`, `diagnosing`, `waiting`).
* **Rationale:** Prevents catastrophic false positives by providing a durable escalation state for ambiguous outputs.

### ADR-102: Relational Claim and Evidence Architecture
* **Decision:** Extract atomic claims into relational entities linked to cryptographic text spans (`validation.claims`, `validation.evidence`).
* **Rationale:** Enables granular fact-checking, automated provenance attribution, and precise hallucination detection.

### ADR-103: Durable Audited Validation Records
* **Decision:** Persist all validation evaluations, rule results, scores, and disputes directly into PostgreSQL.
* **Rationale:** Guarantees enterprise compliance, transparent explainability, and verifiable model provenance.

### ADR-104: Economic Guardrails for Validation
* **Decision:** Secondary model-based validation requires explicit policy opt-in; validation defaults to local, zero-cost deterministic checks.
* **Rationale:** Prevents unintended token cost inflation and quota exhaustion on automated evaluation loops.

---

## 11. Verification & Testing Contracts

1. **Deterministic Override Test:** Supply an artifact containing syntactically valid TypeScript that fails `tsc` compilation. Verify that even if an AI critic prompts positive feedback, the Validation Engine unconditionally returns `REJECT`.
2. **Schema Rejection Test:** Supply a JSON artifact missing a mandatory schema property. Verify that the engine short-circuits at Stage 2 with `REJECT` and does not invoke downstream stages.
3. **Uncertainty Escalation Test:** In a research task, supply claims with ambiguous or partially matching evidence. Verify that the engine outputs `UNCERTAIN` and places the step in `waiting` rather than `completed`.
4. **Dispute Resolution Test:** Simulate Model A asserting $X$ and Model B asserting $Y$. Verify that the engine writes a `validation.disputes` record and awards the winning position to the model whose answer is substantiated by deterministic test execution.
5. **Two-Phase Isolation Test:** Assert that during compiler execution and model critic calls, zero PostgreSQL database connections or transaction blocks are held open.

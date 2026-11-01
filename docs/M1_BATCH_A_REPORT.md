# M1 Batch A Report — Recovery Foundation

**Milestone:** M1 (Batch A: Tasks M1.2 & M1.3)  
**Status:** **BATCH A COMPLETE & VERIFIED**  
**Architecture:** FROZEN (ADR-001 through ADR-104)  
**Date:** 2026-10-07  

---

## 1. Executive Summary

Batch A establishes the foundational primitives for failure resilience in the **AI-Execution-Engine**:
1. **Durable Checkpoint Persistence (M1.2):** Implemented in [`src/engine/checkpointService.ts`](file:///c:/Users/KimoStore/StudioProjects/AI-Execution-Engine/src/engine/checkpointService.ts), enabling atomic, ordered, fenced state snapshots in PostgreSQL (`execution.checkpoints`). Any worker crash or process restart can reconstruct recovery state without relying on in-memory worker state.
2. **Alternative Resource Resolution (M1.3):** Implemented in [`src/resources/resourceIntelligence.ts`](file:///c:/Users/KimoStore/StudioProjects/AI-Execution-Engine/src/resources/resourceIntelligence.ts), enabling centralized evaluation of alternative execution targets. The failed resource is strictly excluded, paid resources are rejected unless explicitly authorized (Zero Silent Spend), and capability/quota/health constraints are enforced deterministically.

---

## 2. Implemented Components & Behavior

### 2.1 M1.2 — Durable Checkpoint Service
- **Service Contract:** [`CheckpointService`](file:///c:/Users/KimoStore/StudioProjects/AI-Execution-Engine/src/engine/checkpointService.ts) writes point-in-time recovery snapshots into `execution.checkpoints`.
- **Monotonic Ordering:** Computes `sequence_number` monotonically per execution instance (`UNIQUE (execution_id, sequence_number)`).
- **Fencing Protection:** Checks step execution row lock and rejects stale worker checkpoints with `STALE_WORKER_CHECKPOINT_REJECTED` upon `fencing_token` mismatch.
- **Idempotency:** Re-invoking `createCheckpoint` for the same execution and attempt ID returns the existing checkpoint record without duplicating rows.
- **Normalized Error Persistence:** Simultaneously records structured failure details in `execution.execution_errors` and updates attempt status to `failed`.
- **State Reconstruction:** `reconstructRecoveryState(executionId)` retrieves the latest sequence snapshot and reconstitutes attempt identity, error classification, partial artifacts, and recovery decision (`canResume`).
- **Transactional Outbox:** Publishes `CHECKPOINT_CREATED` events to `system.outbox_events` in the same PostgreSQL transaction.
- **Two-Phase Isolation:** Database transactions are strictly scoped; zero provider network calls occur within transactions.

### 2.2 M1.3 — Alternative Resource Resolution
- **Resolution Contract:** `resourceIntelligence.selectAlternativeResource(request)` centrally resolves alternative resources.
- **Failed Resource Exclusion:** Excludes `request.currentResourceId` and `request.excludedResourceIds`. The failed resource cannot accidentally be chosen as its own migration target.
- **Paid Safety (Zero Silent Spend):** Rejects any resource where `model_metadata.is_paid === true`, `tier === 'paid'`, or credential is `paid` unless `requirements.allowPaid === true`.
- **Capability Matching:** Verifies that required capabilities (e.g. `['vision']`) are supported by candidate model metadata.
- **Quota & Circuit Health:** Discards instances with zero remaining quota (`remaining_value <= 0`) or unhealthy circuit states (`health_status IN ('unhealthy', 'down', 'dead')`).
- **Deterministic Prioritization:** Orders candidates by `r.priority DESC, r.created_at ASC`. Returns `{ success: false, reason: "NO_ELIGIBLE_RESOURCE" }` if no candidates qualify.
- **Worker Isolation:** The worker never selects providers directly; Resource Intelligence remains the sole strategic authority.

---

## 3. Test Verification Matrix

All tests execute against local PostgreSQL 18.1.

| Suite | Tests | Status | Scope |
| :--- | :---: | :---: | :--- |
| [`tests/checkpoint.test.ts`](file:///c:/Users/KimoStore/StudioProjects/AI-Execution-Engine/tests/checkpoint.test.ts) | 6 | **PASSED** | Checkpoint creation, ordering (1, 2), idempotency, failure error recording, stale fencing rejection, recovery state reconstruction |
| [`tests/resource_alternative.test.ts`](file:///c:/Users/KimoStore/StudioProjects/AI-Execution-Engine/tests/resource_alternative.test.ts) | 7 | **PASSED** | Failed resource exclusion, quota exhausted rejection, down/unhealthy rejection, paid resource safety, capability matching, `NO_ELIGIBLE_RESOURCE` |
| [`tests/recoveryPolicy.test.ts`](file:///c:/Users/KimoStore/StudioProjects/AI-Execution-Engine/tests/recoveryPolicy.test.ts) | 12 | **PASSED** | M1.1 error classification matrix & explainability |
| [`tests/e2e.test.ts`](file:///c:/Users/KimoStore/StudioProjects/AI-Execution-Engine/tests/e2e.test.ts) | 1 | **PASSED** | End-to-end execution vertical slice |
| [`tests/api.test.ts`](file:///c:/Users/KimoStore/StudioProjects/AI-Execution-Engine/tests/api.test.ts) | 3 | **PASSED** | API 202 Accepted, task retrieval, idempotency |
| [`tests/queue_worker.test.ts`](file:///c:/Users/KimoStore/StudioProjects/AI-Execution-Engine/tests/queue_worker.test.ts) | 2 | **PASSED** | PostgreSQL SKIP LOCKED claiming & lease extension |
| [`tests/fencing.test.ts`](file:///c:/Users/KimoStore/StudioProjects/AI-Execution-Engine/tests/fencing.test.ts) | 1 | **PASSED** | Anti-zombie monotonic fencing barrier |
| [`tests/persistence.test.ts`](file:///c:/Users/KimoStore/StudioProjects/AI-Execution-Engine/tests/persistence.test.ts) | 1 | **PASSED** | Cross-schema relational persistence |
| [`tests/validation.test.ts`](file:///c:/Users/KimoStore/StudioProjects/AI-Execution-Engine/tests/validation.test.ts) | 5 | **PASSED** | Validation barrier & Rule E-007 compliance |
| [`tests/artifact.test.ts`](file:///c:/Users/KimoStore/StudioProjects/AI-Execution-Engine/tests/artifact.test.ts) | 1 | **PASSED** | SHA-256 immutable content-addressed storage |
| [`tests/provider_adapter.test.ts`](file:///c:/Users/KimoStore/StudioProjects/AI-Execution-Engine/tests/provider_adapter.test.ts) | 4 | **PASSED** | Canonical envelopes, 16-error taxonomy, secret safety |
| **Total** | **43** | **100% PASS** | **11 Test Files Passed** |

---

## 4. Build & Compilation Verification

- **`npm test`:** 11 passed (11 total), 43 passed (43 total).
- **`npx tsc --noEmit`:** Exited with code `0` (TypeScript strict mode, zero errors).
- **`npm run build`:** Exited with code `0` (compiled cleanly to `dist/`).

---

## 5. Files Changed

### Created
- [`src/engine/checkpointService.ts`](file:///c:/Users/KimoStore/StudioProjects/AI-Execution-Engine/src/engine/checkpointService.ts) (M1.2 Checkpoint service)
- [`tests/checkpoint.test.ts`](file:///c:/Users/KimoStore/StudioProjects/AI-Execution-Engine/tests/checkpoint.test.ts) (M1.2 Checkpoint unit & integration tests)
- [`tests/resource_alternative.test.ts`](file:///c:/Users/KimoStore/StudioProjects/AI-Execution-Engine/tests/resource_alternative.test.ts) (M1.3 Alternative resource tests)
- [`docs/M1_BATCH_A_REPORT.md`](file:///c:/Users/KimoStore/StudioProjects/AI-Execution-Engine/docs/M1_BATCH_A_REPORT.md) (This report)

### Modified
- [`src/resources/resourceIntelligence.ts`](file:///c:/Users/KimoStore/StudioProjects/AI-Execution-Engine/src/resources/resourceIntelligence.ts) (Added `selectAlternativeResource` and `registerResource` test helper)

---

## 6. Architecture Invariants Preserved

1. **Architecture Freeze:** Zero new queues, brokers, or databases. Zero modifications to frozen ADRs.
2. **PostgreSQL as Single Source of Truth:** Checkpoints and resource states are ACID-persisted in PostgreSQL.
3. **Fencing Integrity:** Stale workers are rejected by conditional transactional row locks before creating checkpoints.
4. **Zero Silent Paid Spend:** Paid resources are strictly filtered out unless `allowPaid === true`.
5. **No Provider Calls in Transactions:** Checkpoint transactions are sub-millisecond database writes; network I/O remains strictly outside transactions.
6. **Worker Decoupling:** Workers do not perform provider routing; Resource Intelligence maintains exclusive ownership of resource resolution.

---

## 7. Next Steps

**Batch B has NOT started.**  
Awaiting human approval to proceed with **Batch B — Failure Execution** (M1.4 Deterministic Fault Injection, M1.5 Multi-Attempt Worker Lifecycle, M1.6 Migration Integration).

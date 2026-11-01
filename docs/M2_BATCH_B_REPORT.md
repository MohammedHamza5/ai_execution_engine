# M2 BATCH B IMPLEMENTATION REPORT

## Validation-Driven Recovery

**Milestone:** M2  
**Batch:** Batch B (M2.4 → M2.5 → M2.6)  
**Status:** COMPLETED & VERIFIED  
**Architecture:** FROZEN  

---

## 1. Executive Summary

Batch B operationalizes Validation-Driven Recovery for Milestone M2. In this batch, output validation results are elevated to first-class execution signals that actively drive the engine's attempt lifecycle.

When an AI provider successfully returns HTTP 200 but produces invalid, non-conforming, or unverified outputs:
1. The deterministic validation barrier rejects the output (`commitAttemptSuccess` flags `validationPassed: false`).
2. The failure is diagnosed into a canonical failure class (`SCHEMA_FAILURE`, `DETERMINISTIC_FAILURE`, `EVIDENCE_FAILURE`, `UNCERTAIN`).
3. An explicit recovery decision (`RETRY_SAME`, `MIGRATE_RESOURCE`, `WAIT`, `FAIL`) is computed via `RecoveryPolicy.evaluateValidation`.
4. A durable checkpoint containing full validation diagnostic context is persisted in PostgreSQL.
5. The worker executes recovery: either re-attempting with schema guidance on the same resource, migrating to an alternative resource via Resource Intelligence (respecting `allowPaid = false`), yielding to `WAIT` for uncertain outcomes, or failing deterministically when retries are exhausted.

---

## 2. Completed Scope

### Task M2.4 — Recovery Policy for Invalid Output
- **Module:** `src/engine/recoveryPolicy.ts`
- **Key Invariants:**
  - Added `RecoveryPolicy.evaluateValidation(diagnosis, options)`.
  - Added `"WAIT"` to `RecoveryAction` for inconclusive / uncertain outputs.
  - Zero Silent Paid Spend: strictly enforces `allowPaid` flag when evaluating migration decisions.
  - Distinct from provider error evaluation: preserves the separation between network/provider faults and output verification defects.

### Task M2.5 — Worker Multi-Attempt Validation Lifecycle
- **Module:** `src/engine/worker.ts`
- **Key Invariants:**
  - Multi-attempt execution loop now handles validation rejection alongside provider exceptions.
  - Invariant: Attempt failure is NOT execution failure. Attempt 1 is marked as `failed` in `execution.execution_attempts`, while the step/execution continues into Attempt 2.
  - Durable checkpoints are saved with `executionState: "validation_failed"`.
  - Fencing tokens are monotonically incremented upon retry or migration, preventing zombie workers from corrupting subsequent attempts.

### Task M2.6 — End-to-End Validation Recovery Integration Tests
- **Test Suite:** `tests/m2_validation_recovery.test.ts` (3 tests)
- **Verified Flows:**
  1. *Canonical Retry-Same Flow:* Attempt 1 returns non-JSON -> Validation REJECT -> Checkpoint -> Retry Same -> Attempt 2 returns valid JSON -> Validation ACCEPT -> Task COMPLETED.
  2. *Validation Migration Flow:* Attempt 1 & Attempt 2 fail schema checks -> `MIGRATE_RESOURCE` triggered -> Alternative resource chosen -> Attempt 3 succeeds -> Task COMPLETED -> `RESOURCE_MIGRATED` outbox event emitted.
  3. *Retries Exhausted:* Continuous output failures exceed retry limits -> Task transitions to `failed` deterministically.

---

## 3. Verification & Metrics

- **Vitest Suite:** 92 passing tests across 19 test files (100% pass rate).
- **TypeScript Static Verification:** Clean build (`npx tsc --noEmit` exited with code 0).
- **Distribution Build:** Clean compilation (`npm run build` exited with code 0).
- **Architecture Invariance:** 0 architectural changes; PostgreSQL schema unchanged; no external queues or state stores added.

---

## 4. Next Batch

**Batch C: Hardening & Final M2 Acceptance Audit**
- Task M2.7: Comprehensive Validation Failure Matrix
- Task M2.8: Adversarial & Edge Case Validation Hardening
- Task M2.9: Full Regression Audit
- Task M2.10: Final M2 Acceptance Audit & Certified Implementation Report

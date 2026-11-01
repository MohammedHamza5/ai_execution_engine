# M1 Execution Plan: Failure Recovery & Resource Migration

**Document Status:** Milestone Complete & Accepted  
**Architecture Status:** FROZEN (ADR-001 through ADR-104)  
**Milestone:** M1 — Failure Recovery & Resource Migration  
**Milestone Verdict:** **ACCEPTED**  
**Last Updated:** 2026-10-07  

---

## 1. Milestone Objective

Prove that a provider/resource failure does not terminate the logical task:
- `Attempt failure is not execution failure.`
- `Resource migration preserves the logical step/execution identity while creating a new attempt.`

---

## 2. Batch Execution Structure

```text
┌──────────────────────────────────────────────────────────────┐
│ BATCH A: RECOVERY FOUNDATION                                 │
│ ├── M1.0 Preflight Audit                          [COMPLETE] │
│ ├── M1.1 Recovery Policy & Error Classifier       [COMPLETE] │
│ ├── M1.2 Durable Checkpoint Persistence           [COMPLETE] │
│ └── M1.3 Alternative Resource Resolution          [COMPLETE] │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ BATCH B: FAILURE EXECUTION                                   │
│ ├── M1.4 Deterministic Provider Fault Injection   [COMPLETE] │
│ ├── M1.5 Multi-Attempt Worker Lifecycle           [COMPLETE] │
│ └── M1.6 Migration Integration                    [COMPLETE] │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ BATCH C: HARDENING & FINAL ACCEPTANCE                        │
│ ├── M1.7 Comprehensive Failure Matrix             [COMPLETE] │
│ ├── M1.8 Crash, Idempotency & Fencing Hardening   [COMPLETE] │
│ ├── M1.9 Full Verification & Operational Audit    [COMPLETE] │
│ └── M1.10 Final Acceptance Audit & Reports        [COMPLETE] │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Task Checklist & Progress

- [x] **M1.0 Preflight Audit:** Verified frozen architecture, schema, existing primitives (`docs/M1_PREFLIGHT_REPORT`).
- [x] **M1.1 Recovery Policy & Error Classifier:** Implemented `src/engine/recoveryPolicy.ts` & `tests/recoveryPolicy.test.ts`. 12 unit tests passing (`docs/M1_SLICE_1_REPORT.md`).
- [x] **M1.2 Durable Checkpoint Persistence:** Implemented `src/engine/checkpointService.ts` & `tests/checkpoint.test.ts`. 6 tests passing. Monotonic ordering, idempotency, stale worker fencing, recovery state reconstruction.
- [x] **M1.3 Alternative Resource Resolution:** Extended `src/resources/resourceIntelligence.ts` & `tests/resource_alternative.test.ts`. 7 tests passing. Failed resource exclusion, paid safety (Zero Silent Spend), capability matching, quota/circuit health filtering.
- [x] **M1.4 Deterministic Provider Fault Injection:** Implemented in `src/adapters/geminiAdapter.ts` & `tests/provider_fault_injection.test.ts`. 7 tests passing. Configurable persistent faults, sequence queue, resource-targeted faults, canonical error synthesis.
- [x] **M1.5 Multi-Attempt Worker Lifecycle:** Upgraded `src/engine/worker.ts`. Step continuity, monotonic attempt numbering (`1, 2, ...`), and unique database constraints verified.
- [x] **M1.6 Migration Integration:** Implemented in `tests/m1_migration.test.ts`. 4 tests passing. Complete end-to-end flow verified: Attempt 1 fails -> Checkpoint saved -> Alternative resource selected -> Attempt 2 succeeds -> Artifact created -> Validation passes -> Task completed.
- [x] **M1.7 Comprehensive Failure Matrix:** Implemented in `tests/m1_failure_matrix.test.ts`. 17 tests passing covering all canonical error categories across policy and worker runtime.
- [x] **M1.8 Crash, Idempotency & Fencing Hardening:** Implemented in `tests/m1_crash_fencing.test.ts`. 4 tests passing covering worker crashes before call, crash after checkpoint, anti-zombie fencing rejection, and duplicate checkpoint idempotency.
- [x] **M1.9 Full Verification & Operational Audit:** 75 tests passing across 15 test suites with 100% success rate on PostgreSQL 18.1. TypeScript clean, build clean.
- [x] **M1.10 Final Acceptance Audit:** Completed and ratified in `docs/M1_ACCEPTANCE_AUDIT.md`.

---

## 4. Current State

- **Milestone Status:** **M1 ACCEPTED**
- **Tests Passing:** 75 / 75 tests passing across 15 test suites (100%)
- **Build Status:** TypeScript strict mode clean (0 errors), `npm run build` passing
- **Documentation:**
  - `docs/M1_BATCH_A_REPORT.md` (Batch A)
  - `docs/M1_BATCH_B_REPORT.md` (Batch B)
  - `docs/M1_BATCH_C_REPORT.md` (Batch C)
  - `docs/M1_ACCEPTANCE_AUDIT.md` (Final Acceptance Audit)
- **Next Milestone:** Milestone M2 (Invalid Output Recovery & Validation-Driven Execution)

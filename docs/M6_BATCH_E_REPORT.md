# AI-Execution-Engine — Milestone M6 Batch E Report
## Fault Tolerance, Crash Recovery & Subgraph Replanning (M6.8 & M6.9)

**Status:** COMPLETE & VERIFIED  
**Date:** October 18, 2026  
**TypeScript Build:** Clean (0 compiler errors)  
**Test Suite:** 27 / 27 M6 Tests Passing (100%)  
**Architecture Baseline:** ADR-001 through ADR-104 Preserved  
**Anti-Monolith File Law:** Enforced (All touched files <= 175 lines)  

---

## 1. Executive Summary

In continuation of the Milestone M6 implementation directive, **Batch E — Fault Tolerance, Checkpointing & Re-Planning** delivers durable crash recovery, zombie lease reclamation with anti-zombie fencing enforcement, and controlled subgraph replanning with plan versioning and infinite loop protection.

Batch E delivers:
- **M6.8:** Worker Crash Recovery & Zombie Lease Reaper (`src/engine/dagRecoveryManager.ts` — 95 lines).
- **M6.9:** Dynamic Subgraph Re-Planning (`src/engine/dagReplanner.ts` — 175 lines).
- **Batch E Verification Suite:** (`tests/m6_dag_recovery_replanning.test.ts` — 154 lines).

---

## 2. Implemented Architecture & Components

### 2.1. DAG Recovery Manager (`src/engine/dagRecoveryManager.ts` — 95 lines)
- **Expired Lease Reclamation (`reapExpiredLeases`):**
  Scans active steps where `status = 'running' AND lease_expires_at <= now() FOR UPDATE SKIP LOCKED`.
- **Anti-Zombie Fencing Token Increment:**
  Resets reaped steps to `pending`, clears `worker_id` and `lease_token`, and increments `fencing_token`. Any late commit attempt from a zombie worker is unconditionally rejected with `FENCING_TOKEN_MISMATCH`.
- **Transactional Outbox Events:**
  Emits `WORKER_LEASE_REAPED` events in `system.outbox_events`.
- **Orchestration Resume (`resumeExecution`):**
  Combines lease reaping with ready-step unblocking to allow execution to resume smoothly without restarting the entire DAG.

### 2.2. Controlled Subgraph Replanner (`src/engine/dagReplanner.ts` — 175 lines)
- **Affected Subgraph Identification (`identifyAffectedSubgraph`):**
  Recursively isolates the failed step and all direct/indirect downstream dependents using SQL `WITH RECURSIVE`, preserving all independent parallel branches and previous successful outputs intact.
- **Plan Version Progression (`replanSubgraph`):**
  Creates an incremented version in `planning.execution_plans`, updates the execution's active plan pointer, and inserts replacement steps and dependencies.
- **Structural Validation Gate:**
  Passes all replacement nodes through `DAGValidator` before activating the new plan version.
- **Anti-Loop Protection:**
  Limits replanning cycles to `MAX_REPLANNING_CYCLES = 3` per execution, throwing `REPLANNING_LIMIT_EXCEEDED` if exceeded.

---

## 3. Verification & Test Evidence

### 3.1. Batch E Verification Suite (`tests/m6_dag_recovery_replanning.test.ts`)
4 focused integration test cases:
1. `reaps expired zombie worker leases and increments fencing tokens`: Verifies lease reset, worker clearing, fencing token increment, and rejection of late zombie commits.
2. `accurately identifies affected subgraphs while preserving independent branches`: Confirms diamond DAG isolation (`left` + `join` affected, `right` preserved).
3. `executes controlled subgraph replanning with incremented plan version`: Verifies plan version 1 -> 2 progression, replacement step insertion, and `SUBGRAPH_REPLANNED` outbox event.
4. `prevents infinite replanning loops when MAX_REPLANNING_CYCLES is reached`: Confirms rejection of 4th replanning cycle with `REPLANNING_LIMIT_EXCEEDED`.

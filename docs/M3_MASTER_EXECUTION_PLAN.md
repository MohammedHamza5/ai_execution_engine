# M3 MASTER EXECUTION PLAN
## Multi-Model Execution & Collaboration

**Project:** AI-Execution-Engine  
**Milestone:** M3  
**Status:** ACCEPTED & CLOSED  
**Architecture:** FROZEN (ADR-001 through ADR-104)  
**Preconditions:** M0 ACCEPTED, M1 ACCEPTED, M2 ACCEPTED  
**Execution Style:** Batch-Based, Architecture-Preserving

---

# 1. M3 Mission

M3 introduces controlled multi-model execution.

The system must be able to solve a logical task using multiple AI resources when doing so produces a better expected execution than relying on one resource.

The core principle is:

> **Multi-model execution is not model-to-model chat. It is coordinated execution over shared durable artifacts.**

---

# 2. M3 Core Invariants

1. **INV-M3-001:** Model agreement is not proof; consensus is not truth.
2. **INV-M3-002:** Models collaborate strictly via durable, immutable, content-addressed artifacts.
3. **INV-M3-003:** Synthesis is an untrusted generator step, never an automatic completion authority.
4. **INV-M3-004:** Final completion requires independent deterministic validation.
5. **INV-M3-005:** Branch failure isolation: a branch failure does not automatically destroy the collaboration run.
6. **INV-M3-006:** Collaboration runs must possess a deterministic finite state machine and completion policy.
7. **INV-M3-007:** No infinite debate or round-robin model chat loops.
8. **INV-M3-008:** Zero silent paid spend: paid resources require explicit `allowPaid: true`.
9. **INV-M3-009:** Resource selection remains strictly owned by Resource Intelligence.
10. **INV-M3-010:** Two-phase execution: provider calls strictly outside database transactions.
11. **INV-M3-011:** Existing M1 (resource recovery) and M2 (invalid output recovery) mechanisms are composed, not duplicated.
12. **INV-M3-012:** Monotonic fencing tokens and idempotency protect every branch and step.
13. **INV-M3-013:** Work queue remains PostgreSQL `execution.step_executions` with `FOR UPDATE SKIP LOCKED`. No new message brokers.

---

# 3. Batch Roadmap

```text
BATCH A: Collaboration Foundation (M3.1 → M3.2 → M3.3)
BATCH B: Multi-Model Execution & Artifact Dispatch (M3.4 → M3.5 → M3.6)
BATCH C: Disagreement, Claims & Synthesis Engine (M3.7 → M3.8 → M3.9 → M3.10)
BATCH D: Adversarial Verification & Acceptance Audit (M3.11 → M3.12 → M3.13 → M3.14)
```

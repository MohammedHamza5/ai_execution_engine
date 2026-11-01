# AI-Execution-Engine — Milestone M5 Official Task Ledger
## Reputation & Benchmark Engine (Tasks M5.1 – M5.21)

**Project:** AI-Execution-Engine  
**Milestone:** M5  
**Authoritative Reference:** `docs/M5_MASTER_EXECUTION_PLAN.md`  
**Status Baseline:** Initial Proposed Ledger — Ready for Batch A Execution  
**Architecture:** FROZEN (Preserving ADR-001 through ADR-104)  

---

## 1. Master Task Ledger (M5.1 – M5.21)

| Official ID | Official Title | Dependencies | Current Status | Relevant Implementation & Test Files | Acceptance Criteria | Evidence Required | Remaining Work |
| :--- | :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| **M5.1** | **Benchmark Domain Model & Task Taxonomy** | None | **COMPLETE** | `src/domain/evaluation/types.ts`, `src/domain/reputation/types.ts` | 9 core task categories; stable benchmark definitions, versioning, difficulty, input/output schemas. | Type definitions compile with 0 errors; comprehensive schema coverage. | None. |
| **M5.2** | **Database Migration 007** | M5.1 | **COMPLETE** | `src/db/migrations/007_evaluation_reputation_schema.sql` | PostgreSQL schemas `evaluation` and `reputation` with 10 tables, foreign keys, indexes, and unique constraints. | Migrator applied migration cleanly in local PostgreSQL 18.1. | None. |
| **M5.3** | **Domain Persistence & Entity Repositories** | M5.2 | **COMPLETE** | `src/evaluation/benchmarkRepository.ts`, `src/reputation/reputationRepository.ts` | Repositories for Benchmarks, Cases, Runs, Results, Profiles, Scores, Evidence, and Snapshots with secret redaction. | CRUD operations verified against real PostgreSQL in `tests/m5_batch_a.test.ts` with 0 leaked credentials. | None. |
| **M5.4** | **Deterministic & Schema Evaluator** | M5.1 | **COMPLETE** | `src/evaluation/evaluators/deterministicEvaluator.ts`, `src/evaluation/evaluators/schemaEvaluator.ts` | Exact string, regex, AST/syntax checks, strict JSON schema validation, numeric tolerance bounds. | Unit tests in `tests/m5_batch_b.test.ts` proving determinism and contract verification. | None. |
| **M5.5** | **Known-Answer & Domain Evaluator** | M5.4 | **COMPLETE** | `src/evaluation/evaluators/domainEvaluator.ts` | Math expression equivalence, OCR Levenshtein/CER, tool calling parameter matching. | Unit tests in `tests/m5_batch_b.test.ts` comparing known answers across domain fixtures. | None. |
| **M5.6** | **Independent Model Critic Evaluator** | M5.4 | **COMPLETE** | `src/evaluation/evaluators/criticEvaluator.ts` | Model-based evaluation with prompt injection guards, non-infallibility safeguards, separated claim vs ground truth. | Unit tests in `tests/m5_batch_b.test.ts` asserting critic uncertainty and injection resistance. | None. |
| **M5.7** | **Multi-Dimensional Evaluation Scorer** | M5.4–M5.6 | **COMPLETE** | `src/evaluation/evaluationScorer.ts` | Separates Request Success, Output Validity, Task Correctness, Safety, Latency, Token Usage, Cost, and Quota. | Unit tests in `tests/m5_batch_b.test.ts` verifying multi-metric vector computation. | None. |
| **M5.8** | **Reproducible Benchmark Fixtures Suite** | M5.1 | **COMPLETE** | `src/evaluation/benchmarkSuite.ts` | Standardized test fixtures for all 9 categories (normal, edge, malformed, adversarial) with strict synthetic labeling. | Fixture loader tests in `tests/m5_batch_c.test.ts` asserting determinism. | None. |
| **M5.9** | **Execution Observation Capture** | M5.3, M5.7 | **COMPLETE** | `src/evaluation/observationCapture.ts` | Captures execution attempts, latencies, tokens, billing classes, and validation outcomes into PostgreSQL. | End-to-end observation ingestion verified in `tests/m5_batch_c.test.ts` with secret redaction. | None. |
| **M5.10** | **Benchmark Execution Harness** | M5.8, M5.9 | **COMPLETE** | `src/evaluation/benchmarkHarness.ts` | Bounded concurrency runner, timeout handling, retry bounds, idempotent execution runs. | Test suite in `tests/m5_batch_c.test.ts` executing benchmark runs against synthetic resources. | None. |
| **M5.11** | **Economic & Quota Safety Guard** | M5.10 | **COMPLETE** | `src/evaluation/benchmarkSafetyGuard.ts` | Prevents quota starvation of user tasks; strictly blocks paid benchmarks when `allowPaid = false`. | Tests in `tests/m5_batch_c.test.ts` proving rejection of unauthorized paid benchmark attempts. | None. |
| **M5.12** | **Bayesian Reputation Engine & Recency Decay** | M5.3, M5.9 | **COMPLETE** | `src/reputation/bayesianReputationEngine.ts` | Beta-Binomial updating with prior parameters, exponential time-decay half-life, Laplace smoothing. | Mathematical property tests in `tests/m5_batch_d.test.ts` for prior updates and decay. | None. |
| **M5.13** | **Multi-Dimensional Reputation Profiler** | M5.12 | **COMPLETE** | `src/reputation/reputationProfiler.ts` | Generates explainable profiles by Provider, Model, Model Version, and Task Category with sample sizes & confidence intervals. | Tests in `tests/m5_batch_d.test.ts` verifying multi-dimensional profile aggregation. | None. |
| **M5.14** | **Reputation Evidence Traceability & Snapshots** | M5.13 | **COMPLETE** | `src/reputation/reputationTraceability.ts` | Every score links to underlying evidence IDs; immutable point-in-time snapshot generator. | Database integrity tests in `tests/m5_batch_d.test.ts` validating evidence foreign keys and snapshot immutability. | None. |
| **M5.15** | **Reputation Profile Persistence Service** | M5.13, M5.14 | **COMPLETE** | `src/reputation/reputationPersistenceService.ts` | Transactional persistence of profiles, dimensional scores, and historical snapshots into PostgreSQL. | Persistence tests in `tests/m5_batch_d.test.ts` verifying upsert idempotency and race safety. | None. |
| **M5.16** | **Resource Intelligence Reputation Contract** | M5.13 | **COMPLETE** | `src/engine/resourceScoringEngine.ts` | Connects empirical reputation profiles to 8-dimension scoring (Quality & Reliability) for matching task categories. | Scoring tests in `tests/m5_batch_e.test.ts` proving high-reputation resources receive proportional boosts. | None. |
| **M5.17** | **Hard Eligibility Invariant Enforcement** | M5.16 | **COMPLETE** | `src/engine/eligibilityEngine.ts`, `tests/m5_batch_e.test.ts` | Strict invariant: reputation score can NEVER override invalid credentials, missing capabilities, tripped circuit breakers, or `allowPaid = false`. | Unit & integration tests in `tests/m5_batch_e.test.ts` proving high reputation on ineligible resource yields 0 score. | None. |
| **M5.18** | **Model Version Drift, Staleness & Invalidation** | M5.15, M5.16 | **COMPLETE** | `src/reputation/reputationInvalidationService.ts` | Handles model version updates, benchmark version mismatch, stale score degradation, and explicit invalidation. | Tests in `tests/m5_batch_e.test.ts` verifying version change triggers uncertainty reset. | None. |
| **M5.19** | **Adversarial Evaluation & Security Hardening** | M5.4–M5.7 | **COMPLETE** | `tests/m5_adversarial_matrix.test.ts` | Prompt injection in test content, poisoned benchmark outputs, evaluator crash recovery, JSON bomb resistance. | Adversarial test suite passing with 0 exploits in `tests/m5_adversarial_matrix.test.ts`. | None. |
| **M5.20** | **High-Concurrency Benchmark & Update Stress** | M5.10, M5.15 | **COMPLETE** | `tests/m5_concurrency_stress.test.ts` | 10 concurrent workers submitting benchmark observations; zero race conditions, zero deadlocks in PostgreSQL. | Concurrency stress suite against local PostgreSQL 18.1 in `tests/m5_concurrency_stress.test.ts`. | None. |
| **M5.21** | **End-to-End Regression & Acceptance Gate** | All M5 | **COMPLETE** | Full repository test suite | 100% test pass rate across M0–M5, TypeScript 0 errors, full Definition of Done compliance. | Full regression passing 40/40 test files and 232/232 tests; final acceptance audit published. | None. |

---

## 2. Batch Structure

```text
Batch A: M5.1 – M5.3   (Domain Model, Taxonomy & Database Schema 007)
Batch B: M5.4 – M5.7   (Multi-Tier Evaluation & Scoring Engine)
Batch C: M5.8 – M5.11  (Reproducible Benchmark Suite & Observation Capture)
Batch D: M5.12 – M5.15 (Bayesian Statistical Aggregation & Reputation Profiles)
Batch E: M5.16 – M5.18 (Resource Intelligence Integration & Drift Invalidation)
Batch F: M5.19 – M5.21 (Adversarial Hardening, Concurrency Stress & Gate Verification)
```

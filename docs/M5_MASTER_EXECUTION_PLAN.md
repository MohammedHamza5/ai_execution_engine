# M5 — MASTER EXECUTION PLAN
## Reputation & Benchmark Engine

**Project:** AI-Execution-Engine  
**Milestone:** M5  
**Status:** PROPOSED — Pending Architecture Alignment & Consultation  
**Architecture:** FROZEN (Preserving ADR-001 through ADR-104)  
**Primary Objective:** Collect trustworthy, reproducible empirical evidence about AI resource and model performance across task categories, evaluate that evidence under reproducible conditions, and expose defensible, uncertainty-aware performance estimates to Resource Intelligence without ever compromising hard eligibility constraints or security boundaries.

---

# 1. Mission & Philosophy

The engine does not search for the most famous model. It searches for the best possible execution of the task using the resources currently available.

The core principles of Milestone M5:

> **Reputation is not a popularity contest or a static leaderboard. It is a verifiable, evidence-backed, multi-dimensional probability distribution of performance across specific task domains.**

> **A model is an unverified worker. Model outputs are strictly `MODEL_CLAIM` and never converted into ground truth without independent, verified validation (Rule E-007).**

> **Hard eligibility constraints (valid credentials, capabilities, health, quota, explicit paid spend authorization) always take absolute precedence over reputation scores.**

M5 answers:
> Given this resource and this specific task category (Reasoning, Coding, JSON Schema, Arabic, Vision, Math), what is our statistically grounded expectation of success, quality, latency, and cost, how confident are we in that expectation, and is that evidence fresh or stale?

---

# 2. Scope & Boundaries

### In Scope:
1. **Benchmark Domain & Task Taxonomy (M5-A):**
   - 9 core task categories: General Text, Structured JSON, Coding, Reasoning, Mathematics, Vision/Image Understanding, OCR/Document Extraction, Long-Context, Tool Calling.
   - Stable benchmark definitions, versioning, difficulty levels, and input/output contracts.
2. **Reproducible Benchmark Suite (M5-B):**
   - Deterministic test fixtures, normal cases, edge cases, malformed inputs, adversarial inputs.
   - Strict distinction between synthetic simulation fixtures and real-world empirical observations.
3. **Multi-Tier Evaluation & Scoring (M5-C):**
   - Evaluation hierarchy: Deterministic checks → Schema validation → Known-answer comparison → Domain metrics → Independent model critics → Human review.
   - Separation of Request Success, Output Validity, Task Correctness, Safety, Latency, Token Consumption, Cost, Quota.
4. **Real Observation Capture (M5-D):**
   - Capturing execution outcomes, latencies, token usages, and validation outcomes into PostgreSQL.
   - Complete secret redaction (API keys, tokens, and credentials stripped).
5. **Statistical Aggregation & Uncertainty (M5-E):**
   - Empirical Bayes / Beta-Binomial updating combining domain priors with empirical observations.
   - Sample sufficiency thresholds, uncertainty intervals, Laplace smoothing, and exponential recency decay.
6. **Multi-Dimensional Reputation Profiles (M5-F):**
   - Profiles by Provider, Model, Model Version, and Task Category.
   - Explainable metrics, sample size, observation window, uncertainty bounds.
7. **Resource Intelligence Integration (M5-G):**
   - Feeding domain-specific reputation and confidence into `ResourceScoringEngine`'s quality and reliability dimensions.
   - Preservation of hard constraint eligibility (ineligible candidates can never be rescued by high reputation).
8. **Persistence & Migration 007 (M5-H):**
   - Implementing PostgreSQL schemas `evaluation` and `reputation` according to `docs/DATABASE_SCHEMA.md` Section 4.10 and `docs/INTERNAL_DATA_MODEL.md` Section 4.9.
9. **Freshness, Drift & Invalidation (M5-I):**
   - Staleness policies for model version bumps, prompt format changes, and benchmark version increments.
10. **Economic & Quota Safety Guards (M5-J):**
    - Strict enforcement of `allowPaid = false` during benchmark runs.
    - Quota protection preventing benchmarking from starving user execution quota.

### Out of Scope:
- Public web dashboard / front-end UI (engine capability only).
- Introducing external infrastructure (Redis, Kafka, Temporal, Python runtimes).
- Live billing credit card charging.
- Silently changing M4 scoring weights or bypassing ADR-007 (Zero Silent Paid Spend).

---

# 3. Mathematical Model for Reputation & Uncertainty

### 3.1 Empirical Bayes / Beta-Binomial Formulation
For any resource $R$ and task category $C$, the success rate $\theta_{R,C} \in [0, 1]$ is modeled as a Beta distribution:

$$\theta_{R,C} \sim \text{Beta}(\alpha, \beta)$$

Where:
- $\alpha = \alpha_0 + \sum_{i=1}^n w_i \cdot s_i$ (effective successes)
- $\beta = \beta_0 + \sum_{i=1}^n w_i \cdot (1 - s_i)$ (effective failures)
- $\alpha_0, \beta_0$: Prior parameters derived from provider tier/specs (e.g. uninformative prior $\alpha_0 = 2, \beta_0 = 2$ yielding mean $0.50$).
- $s_i \in [0, 1]$: Outcome score of observation $i$ (1 for valid/correct, 0 for failure/invalid).
- $w_i = e^{-\lambda (t_{\text{now}} - t_i)}$: Exponential recency decay weight ($\lambda = \frac{\ln(2)}{T_{1/2}}$, half-life $T_{1/2} = 7 \text{ days}$).

### 3.2 Expected Value and Uncertainty Confidence
- **Reputation Score (Mean):**
  $$\hat{\mu}_{R,C} = \frac{\alpha}{\alpha + \beta}$$
- **Variance (Uncertainty):**
  $$\sigma^2_{R,C} = \frac{\alpha \beta}{(\alpha + \beta)^2 (\alpha + \beta + 1)}$$
- **Confidence Metric ($C_{R,C} \in [0, 1]$):**
  $$C_{R,C} = 1 - \min\left(1.0, \frac{\sqrt{\sigma^2}}{\sqrt{\sigma^2_{\text{prior}}}}\right) = \min\left(1.0, \frac{N_{\text{eff}}}{N_{\text{threshold}}}\right)$$
  Where $N_{\text{eff}} = \alpha + \beta - (\alpha_0 + \beta_0)$ and $N_{\text{threshold}} = 30$ samples.

---

# 4. Dependency-Ordered Task Batches (M5.1 – M5.21)

```text
┌─────────────────────────────────────────────────────────────────┐
│ BATCH A: Benchmark Domain, Taxonomy & Migration 007 (M5.1–M5.3) │
│ • M5.1: Benchmark Domain Model & Task Taxonomy                  │
│ • M5.2: Database Migration 007 (evaluation & reputation schemas)│
│ • M5.3: Domain Persistence & Entity Repositories                │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ BATCH B: Multi-Tier Evaluation & Scoring Engine (M5.4–M5.7)     │
│ • M5.4: Deterministic & Schema Evaluator                        │
│ • M5.5: Known-Answer & Domain-Specific Evaluator                │
│ • M5.6: Independent Model-Based Critic Evaluator (with guards)  │
│ • M5.7: Multi-Dimensional Evaluation Scorer                     │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ BATCH C: Benchmark Suite Harness & Observation Capture (M5.8–11)│
│ • M5.8: Reproducible Benchmark Fixtures Suite                   │
│ • M5.9: Execution Observation Capture (Real & Synthetic)        │
│ • M5.10: Benchmark Execution Harness (Bounded & Idempotent)     │
│ • M5.11: Economic & Quota Safety Guard                          │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ BATCH D: Statistical Aggregation & Reputation Profiles (M5.12–15│
│ • M5.12: Bayesian Reputation Engine & Recency Decay             │
│ • M5.13: Multi-Dimensional Reputation Profiler                  │
│ • M5.14: Reputation Evidence Traceability & Snapshots           │
│ • M5.15: Reputation Profile Persistence Service                 │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ BATCH E: Resource Intelligence Integration & Drift (M5.16–M5.18)│
│ • M5.16: Resource Intelligence Reputation Contract              │
│ • M5.17: Hard Eligibility Invariant Enforcement                 │
│ • M5.18: Model Version Drift, Staleness & Invalidation Policies │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ BATCH F: Adversarial Hardening, Concurrency & Gate (M5.19–M5.21)│
│ • M5.19: Adversarial Evaluation & Security Hardening            │
│ • M5.20: High-Concurrency Benchmark & Update Stress             │
│ • M5.21: End-to-End Regression Verification & Final Acceptance  │
└─────────────────────────────────────────────────────────────────┘
```

---

# 5. Database Schema & Migration 007 Specifications

Migration `007_evaluation_reputation_schema.sql` creates:

1. **Schemas:**
   ```sql
   CREATE SCHEMA IF NOT EXISTS evaluation;
   CREATE SCHEMA IF NOT EXISTS reputation;
   ```
2. **Tables in `evaluation`:**
   - `evaluation.evaluations`: Task/Execution evaluation records.
   - `evaluation.evaluation_metrics`: Multi-metric breakdowns with evidence refs.
   - `evaluation.benchmarks`: Named benchmark definitions, slugs, and versions.
   - `evaluation.benchmark_cases`: Cases with difficulty, inputs, expected outputs, strategies.
   - `evaluation.benchmark_runs`: Run sessions binding benchmark to resource/model.
   - `evaluation.benchmark_results`: Individual case results with scores, latencies, tokens.
3. **Tables in `reputation`:**
   - `reputation.reputation_profiles`: Aggregated profile per subject (`resource`, `model`).
   - `reputation.reputation_scores`: Dimension and task subtype scores with decay factor.
   - `reputation.reputation_evidence`: Evidence provenance linking scores to benchmark runs or production validations.
   - `reputation.reputation_snapshots`: Point-in-time immutable score snapshots.
4. **Indexes & Constraints:**
   - Unique constraints: `(slug, version)` on benchmarks, `(subject_type, subject_id)` on profiles, `(profile_id, dimension, task_subtype)` on scores.
   - Foreign keys with cascading cleanup on child runs/cases where appropriate.

---

# 6. Definition of Done Gate (DoD) for Milestone M5

Milestone M5 is NOT complete until:
1. All 21 tasks (M5.1 through M5.21) have explicit passing statuses in `docs/M5_TASK_LEDGER.md`.
2. Full test suite passes: `npx vitest run` with 100% pass rate.
3. TypeScript build passes: `npm run build` with 0 errors and 0 warnings.
4. Anti-Monolith File Law is strictly honored: zero code files exceeding 150–200 lines.
5. Zero secrets or credentials logged or persisted.
6. Zero silent paid spend: paid benchmarks strictly rejected when `allowPaid = false`.
7. Evidence-based reports completed: `docs/M5_FINAL_ACCEPTANCE_REPORT.md` and updated `docs/00_PROJECT_STATUS.md`.

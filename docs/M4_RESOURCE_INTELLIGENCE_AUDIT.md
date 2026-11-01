# M4.1 — RESOURCE INTELLIGENCE AUDIT REPORT

**Project:** AI-Execution-Engine  
**Milestone:** M4 (Resource Intelligence & Free Resource Optimization)  
**Task:** M4.1 (Audit Existing Resource Intelligence)  
**Status:** COMPLETE — READY FOR IMPLEMENTATION  
**Audit Target:** `src/resources/resourceIntelligence.ts`, `src/domain/resource/types.ts`, `docs/RESOURCE_INTELLIGENCE.md`, and PostgreSQL schema `001_initial_schema.sql`  

---

# 1. Executive Summary

In accordance with the M4 Master Execution Plan, this independent audit inspects the current codebase against `docs/RESOURCE_INTELLIGENCE.md` prior to any code modifications.

### Key Finding:
The database DDL (`001_initial_schema.sql`) provides robust foundational tables (`resources.resources`, `ai.providers`, `ai.models`, `resources.credentials`, `resources.resource_quotas`, `resources.resource_reservations`, `resources.resource_health`). 

However, **there is substantial implementation drift** in `src/resources/resourceIntelligence.ts`:
1. `selectResource(_requirements)` completely ignores requirements, capabilities, quotas, and health—relying on a simplistic SQL `ORDER BY priority DESC`.
2. Hard-constraint filtering is implemented partially in `selectAlternativeResource`, but completely bypassed in initial selection.
3. Multi-dimensional soft scoring, logical reservations, usage reconciliation, explainable decision records, and circuit breakers exist only in documentation and DDL schemas, not in runtime code.

---

# 2. Detailed Audit Matrix

| Architectural Dimension | Specification (`docs/RESOURCE_INTELLIGENCE.md`) | Current Implementation Status | Assessment |
| :--- | :--- | :--- | :--- |
| **Resource Identity** | Tuple `(Provider, Model, Credential)` (ADR-067) | Relational columns `provider_id`, `model_id`, `credential_id` in `resources.resources` | **IMPLEMENTED** |
| **Database Schema** | 7 dedicated relational tables across `ai` and `resources` | Migrated in `001_initial_schema.sql` | **IMPLEMENTED** |
| **Base Resource Seeding** | Seeds Gemini 1.5 Flash default platform resource | `ensureBaseResource()` provisions platform entities | **IMPLEMENTED** |
| **Initial Selection** | Filter-First: hard constraints on capability, quota, health, policy (ADR-068) | `selectResource(_requirements)` ignores input, queries `status = 'active'`, orders by `priority DESC` | **CONTRADICTORY / DEFICIENT** |
| **Alternative Selection** | Excludes failed resources, checks `allowPaid`, capabilities, quota > 0, health not dead | `selectAlternativeResource()` filters `currentResourceId`, `allowPaid`, capabilities | **PARTIAL** |
| **Resource Classification** | Explicit classes: `FREE`, `PAID`, `BYOK`, `INTERNAL` (Section 7) | Implicit `is_paid` boolean in `model.metadata` and `credential_type` string | **PARTIAL** |
| **Capability Intelligence** | Normalized capabilities enum: `TEXT_GENERATION`, `STRUCTURED_OUTPUT`, `JSON`, `VISION`, `OCR`, `CODE`, `REASONING`, `MATH`, etc. | Raw strings in JSON array (`capabilities: ["text", "code"]`) | **PARTIAL** |
| **Normalized State Model** | Full runtime snapshot: availability, health, quota, rate limits, freshness, confidence | Types contain only relational DB fields; no normalized runtime state model | **MISSING** |
| **Eligibility Engine** | Deterministic hard constraint pipeline (Task $\to$ Policy $\to$ Capability $\to$ Availability $\to$ Quota $\to$ Concurrency $\to$ Cost $\to$ Health) | Fragmented in SQL `WHERE` clause; no dedicated pipeline engine | **MISSING** |
| **Multi-Dimensional Scoring** | Formula: Quality (0.30), Reliability (0.20), Capability (0.15), Latency (0.10), Capacity (0.10), Health (0.05), Cost (0.05), Freshness (0.05) | Not implemented; ordering is hardcoded SQL `priority DESC` | **MISSING** |
| **Free-First Objective** | Rank eligible free tiers first, penalize cost, require explicit authorization for paid | Basic boolean guard on `allowPaid`, no soft free-first ranking | **PARTIAL** |
| **Quota Reservations** | Pre-dispatch logical reservation in `resources.resource_reservations` (ADR-069) | Table exists; engine never writes reservations before dispatch | **MISSING** |
| **Usage Reconciliation** | Post-execution token reconciliation and reservation release (ADR-070) | Engine never updates quotas or reconciles reported tokens | **MISSING** |
| **Circuit Breaker** | FSM: `HEALTHY` $\to$ `DEGRADED` $\to$ `COOLDOWN` $\to$ `PROBE` $\to$ `HEALTHY` (ADR-074) | Static string check (`NOT IN ('unhealthy', 'down', 'dead')`); no dynamic state transitions | **MISSING** |
| **Wait vs Migrate Engine** | Distinguishes `EXECUTE_NOW`, `WAIT`, `MIGRATE`, `FAIL`, `REQUEST_APPROVAL` (ADR-075) | Returns only `{ success: false, reason: "NO_ELIGIBLE_RESOURCE" }` | **MISSING** |
| **Explainable Decisions** | Structured decision record: candidates, exclusions, scores, reasons, policy context (ADR-076) | No decision records emitted or persisted | **MISSING** |

---

# 3. Categorized Gap Analysis

### 3.1 Implemented
- **Relational Domain Identity:** Clean database entities separating `ai.providers`, `ai.models`, `resources.credentials`, and `resources.resources`.
- **Fault Injection & Alternative Selection Hook:** M1/M2/M3 recovery relies on `selectAlternativeResource` correctly identifying alternative resources when quota or capabilities fail.
- **Economic Safety Guard:** Strict enforcement of `allowPaid = false` blocking paid models from silent selection.

### 3.2 Partial
- **Resource Categorization:** Lacks first-class `ResourceBillingClass` (`FREE`, `PAID`, `BYOK`, `INTERNAL`).
- **Capability Taxonomy:** Currently string arrays without validation or formal enum mappings.
- **Alternative Selection:** Selection logic exists only in recovery, not in initial step planning.

### 3.3 Missing
- **Task M4.2 Normalized Resource State:** Structured representation of runtime resource state (health status, remaining quota by dimension, rate limit windows, freshness timestamp, confidence score).
- **Task M4.3 Hard-Constraint Eligibility Engine:** Dedicated filter pipeline that takes $N$ candidate resources, applies non-negotiable gates, and produces eligible candidates with explicit rejection reasons for excluded ones.
- **Task M4.4 Explainable Scoring & Free-First Ranking:** Mathematical scoring formula that ranks free and high-quality resources without mixing hard constraints into soft ranking.
- **Task M4.5 Wait / Migrate / Approval Engine:** Tactical decisions when resources are temporarily rate-limited vs permanently exhausted.
- **Task M4.6 Decision Persistence:** Traceable audit logging of every routing choice.
- **Task M4.7 Dynamic Circuit Breaker:** Automated health degradation and recovery loop.
- **Task M4.8 Logical Reservations & Reconciliation:** Accurate token tracking preventing concurrency overcommit.

### 3.4 Contradictory / Code Drift
- **Critical Drift in Initial Selection:** `resourceIntelligence.selectResource` takes `_requirements` as an unused argument, completely failing to check task capabilities, privacy, or health. It must be unified with the eligibility pipeline.
- **Sorting Contradiction:** Architecture specifies multi-dimensional objective scoring, but implementation relies on a static integer `r.priority` column.

---

# 4. Remediation Plan for Batch A (Tasks M4.2 & M4.3)

To resolve the audited gaps without breaking M0–M3 regression suites:

1. **Task M4.2 (Normalized Resource State):**
   - Create `src/domain/resource/stateTypes.ts`:
     - Define `ResourceCapability` enum: `TEXT_GENERATION`, `STRUCTURED_OUTPUT`, `JSON`, `VISION`, `OCR`, `CODE`, `REASONING`, `MATH`, `LONG_CONTEXT`, `TOOL_CALLING`, `STREAMING`, `EMBEDDING`.
     - Define `ResourceBillingClass`: `FREE`, `PAID`, `BYOK`, `INTERNAL`.
     - Define `ResourceHealthState`: `HEALTHY`, `DEGRADED`, `COOLDOWN`, `PROBE`, `UNAVAILABLE`.
     - Define `NormalizedResourceState`: complete operational snapshot with quota headroom, rate limits, latency statistics, confidence, and freshness.

2. **Task M4.3 (Deterministic Eligibility Engine):**
   - Create `src/engine/eligibilityEngine.ts`:
     - Implement pure, deterministic hard-constraint filtering:
       1. Provider & Credential Active Check
       2. Capability Matching (all required capabilities must be supported)
       3. Policy Compliance (economic `allowPaid`, max cost, privacy)
       4. Availability & Health (reject `UNAVAILABLE` or `COOLDOWN`)
       5. Quota & Concurrency (reject remaining quota $\le 0$)
       6. Explicit Exclusion List (reject current or failed resource IDs)
     - Return `{ eligible: ResourceCandidate[], excluded: ExcludedResource[] }` where each excluded resource includes an explicit machine-readable rejection code and explanation.
   - Unify both `selectResource` and `selectAlternativeResource` to use this canonical engine.

3. **Batch A Verification Gate:**
   - Test with 10 diverse candidate resources (free, paid, exhausted, unhealthy, missing capability, rate-limited, etc.) proving deterministic filtering and zero silent spend.

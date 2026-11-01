# AI Execution Engine — Resource Intelligence Specification

**Document:** `RESOURCE_INTELLIGENCE.md`  
**Status:** COMPLETE (Dynamic Resource Orchestration & Economic Routing Baseline)  
**Version:** 1.0.0  
**Authority:** Derived from Resource Intelligence Engine v1.0 Material  

---

## 1. Purpose

The Resource Intelligence Engine is the decision-making brain answering the central question:
> **«What is the best Resource to execute this step right now, under current constraints and available capacity, to maximize expected task completion?»**

The system does not search for an abstract "best model". It dynamically selects and reserves the optimal concrete **Resource Instance** based on real-time quota sufficiency, concurrency limits, health signals, latency profiles, privacy boundaries, and economic policies.

### Core Architectural Principle
> **«Model Quality is only one dimension of execution quality.»**  
> A theoretically superior foundation model is practically unusable if its daily quota is exhausted, its p95 latency exceeds the SLA, its provider is experiencing elevated HTTP 429 cascades, or its data retention policy violates tenant privacy constraints.

---

## 2. Responsibilities & Non-Responsibilities

### 2.1 Responsibilities
1. **Resource Distinction:** Manages concrete execution units representing the tuple `(Provider, Model, Credential)`.
2. **Hard-Constraint Filtering:** Evaluates non-negotiable feasibility gates (modality, privacy, quality floor, budget, data residency, context length) before ranking.
3. **Quota Forecasting & Capacity Tracking:** Assesses multi-dimensional limits (RPM, RPD, TPM, TPD, audio seconds, concurrency) with confidence scores.
4. **Logical Quota Reservations:** Transactionally reserves capacity prior to dispatch to prevent internal overcommit across concurrent workers.
5. **Economic Guardrails & Free-First Routing:** Enforces zero silent paid spend; prioritizes legitimate free resources when compliant with quality floors.
6. **Multi-Dimensional Resource Scoring:** Computes expected task success using multiplicative capability, reliability, quality, and health metrics.
7. **Circuit Breakers & Dynamic Health:** Monitors p50/p95/p99 latencies, error spikes, and circuit transitions (`HEALTHY`, `DEGRADED`, `OPEN`, `HALF_OPEN`).
8. **Fallback Diversity & Correlated Failure Protection:** Formulates compatible, multi-provider fallback chains for seamless failover.
9. **Explainable Selection:** Emits transparent, structured decision rationale traces for every routing choice.
10. **Actual Usage Reconciliation:** Reconciles estimated/reserved capacity with actual reported token usage post-execution.

### 2.2 Non-Responsibilities
- Does **NOT** formulate the DAG plan or decompose tasks (Owned by Planner).
- Does **NOT** execute network calls (Owned by Provider Adapters).
- Does **NOT** judge output truthfulness or correctness (Owned by Validation Engine).
- Does **NOT** compute long-term Bayesian reputation (Owned by Evaluation Engine).

---

## 3. Resource Identity & Domain Model (ADR-067)

```typescript
export interface Resource {
  resourceId: string;
  providerId: string;
  modelId: string;
  credentialId?: string; // Tenant-owned or platform-owned
  status: ResourceStatus;
  availability: AvailabilityState;
  capabilityProfile: CapabilityProfile;
  quotaProfile: QuotaProfile;
  healthProfile: HealthProfile;
  performanceProfile: PerformanceProfile;
  economicProfile: EconomicProfile;
  privacyProfile: PrivacyProfile;
  reputationProfile: ReputationProfile;
  concurrencyProfile: ConcurrencyProfile;
  metadata: Record<string, unknown>;
}

export enum ResourceStatus {
  ACTIVE,       // Fully operational and eligible
  DEGRADED,     // Elevated latencies or 429 rates; reduced assignment weight
  DISABLED,     // Manually blocked via kill switch
  MAINTENANCE,  // Temporarily excluded for scheduled maintenance
  EXHAUSTED,    // Quota zeroed; awaiting reset window
  UNAVAILABLE,  // Circuit breaker open due to upstream outages
  RETIRED       // Deprecated by provider
}
```

### 3.1 Availability vs. Capacity vs. Suitability
- **Available:** API is responsive and credentials are valid (`status == ACTIVE`).
- **Sufficient:** Remaining capacity exceeds estimated step requirements plus safety margin.
- **Suitable:** Capabilities, privacy level, and quality score satisfy task constraints.
A resource must satisfy all three criteria to be eligible for assignment.

---

## 4. Hard-Constraint Filtering vs. Multi-Dimensional Scoring (ADR-068)

Resource selection follows a strict two-stage pipeline: **Filter First, Score Second**.

```text
                        ALL RESOURCES
                             │
                             ▼
 ┌─────────────────────────────────────────────────────────┐
 │ STAGE 1: HARD CONSTRAINT FILTER (Non-Negotiable Gates)   │
 │ ├── Provider Active & Credential Valid?                 │
 │ ├── Required Modalities & Tools Supported?              │
 │ ├── Privacy Level & Data Residency Compliant?           │
 │ ├── Context Window >= Estimated Prompt Tokens?          │
 │ ├── Quality Target >= Task Quality Floor?               │
 │ ├── Budget Policy Allows Spend (Free-Only vs Paid)?     │
 │ └── Concurrency Slots & Safe Quota Available?           │
 └───────────────────────────┬─────────────────────────────┘
                             │
                             ▼
                     ELIGIBLE RESOURCES
                             │
                             ▼
 ┌─────────────────────────────────────────────────────────┐
 │ STAGE 2: MULTI-DIMENSIONAL SCORING & POLICY RANKING      │
 │ ├── Quality Fit (Domain & Modality-Specific)            │
 │ ├── Historical Reliability & Success Rate               │
 │ ├── Capacity Confidence & Quota Sufficiency             │
 │ ├── Latency Score (p95 & Queue Wait)                    │
 │ ├── Economic Score (Free preference / Cost penalty)     │
 │ └── Current Load & Utilization Balancing                │
 └───────────────────────────┬─────────────────────────────┘
                             │
                             ▼
               PRIMARY RESOURCE + DIVERSE FALLBACKS
```

---

## 5. Quota Forecasting, Reservations & Overcommit Prevention

### 5.1 Multi-Dimensional Quotas
Quotas are tracked across concrete operational dimensions:
```typescript
export interface QuotaDimension {
  type: "RPM" | "RPD" | "TPM" | "TPD" | "AUDIO_SECONDS" | "IMAGE_REQUESTS" | "CONCURRENCY";
  limit?: number;
  used?: number;
  remaining?: number;
  resetAt?: Date;
  confidence: number;
}
```

### 5.2 Logical Quota Reservations (ADR-069)
To prevent concurrent workers from overcommitting quota:
1. **Estimate:** Compute estimated usage:
   $$\text{ReservedTokens} = (\text{EstimatedInput} + \text{EstimatedOutput}) \times (1 + \text{SafetyMargin})$$
   where $\text{SafetyMargin}$ scales dynamically ($0.10$ to $0.50$) based on estimate confidence and task complexity.
2. **Reserve:** Insert active reservation into `resources.resource_reservations` within the pre-dispatch transaction.
3. **Execute:** Worker executes attempt via Provider Adapter outside database transaction.
4. **Reconcile (ADR-070):** Actual token usage reported in `UnifiedResponse` updates the resource quota, releasing unused reservations:
   $$\text{ReleasedTokens} = \text{ReservedTokens} - \text{ActualTokens}$$

### 5.3 Invariant: Zero Indefinite Reservations
Every reservation carries an explicit `expiresAt` timestamp (default: lease duration + 30s). Expired reservations are automatically released by the Lease Reaper.

---

## 6. Economic Guardrails & Free-First Hierarchy (ADR-071 & ADR-072)

The engine enforces a strict economic hierarchy:
```text
1. Eligible Free Resource meeting Quality Floor
        ↓ (Exhausted / Unavailable)
2. Alternative Compatible Free Resource
        ↓ (Unavailable)
3. Wait for Quota Reset (if task deadline allows)
        ↓ (Unacceptable latency)
4. Step Decomposition into smaller free-tier units
        ↓ (Non-decomposable)
5. Multi-Model Collaboration / Free Specialist Pipeline
        ↓ (Insufficient quality)
6. Paid Resource (STRICTLY requires allowPaid == true AND cost <= maxCost)
        ↓ (Unauthorized)
7. Honest Failure (Zero Silent Spend)
```

> **Mandatory Invariant (ADR-072):** Under no circumstances may the engine transition from free to paid execution without explicit, pre-authorized developer policy permission.

---

## 7. Multi-Dimensional Objective Function & Policy Profiles

### 7.1 Objective Function: Maximize Expected Task Success
The selection engine maximizes:
$$\text{ExpectedSuccess} = \text{CapabilityFit} \times \text{QualityFit} \times \text{Reliability} \times \text{CapacityFit} \times \text{Health} \times \text{PolicyAlignment}$$
Multiplicative composition guarantees that a resource with catastrophic capacity ($0.05$) or degraded health cannot win merely due to high benchmark quality.

### 7.2 Deterministic MVP Scoring Formula
```text
Score = (0.30 * Quality) + (0.20 * Reliability) + (0.15 * CapabilityFit)
      + (0.10 * LatencyScore) + (0.10 * CapacityScore) + (0.05 * Health)
      + (0.05 * CostScore) + (0.05 * Freshness)
```

### 7.3 Configurable Policy Profiles
- **Quality-First:** Maximizes domain capability and benchmark priors ($w_{\text{quality}} \ge 0.50$); enforces strict quality floor ($0.95+$).
- **Speed-First:** Prioritizes p50/p95 latency and low queue congestion ($w_{\text{latency}} \ge 0.40$).
- **Free-First:** Filters paid resources; selects highest expected success among compliant free tiers.
- **Cost-First:** Minimizes token expense while satisfying minimum quality floor.
- **Balanced:** Standard proportional distribution across all dimensions.
- **Privacy-First:** Strict data residency constraints; zero third-party model training allowed.

---

## 8. Fallback Planning & Provider Diversity (ADR-073)

To prevent correlated upstream outages from causing catastrophic task failure:
1. Every selection returns a primary resource and an ordered list of compatible fallbacks:
   ```typescript
   export interface ResourceSelection {
     primary: ResourceCandidate;
     fallbacks: ResourceCandidate[];
     reasoning: SelectionReason[];
     reservation?: ResourceReservation;
   }
   ```
2. **Provider Diversity Heuristic:** For critical tasks, fallbacks must prioritize distinct provider backends:
   - Primary: Google Gemini
   - Fallback 1: Groq (Llama 3.3)
   - Fallback 2: Mistral AI
   If Provider A suffers an infrastructure outage, failover transitions immediately to an uncorrupted external platform.

---

## 9. Dynamic Health Monitoring & Circuit Breakers (ADR-074)

Health is computed from empirical execution observations, not static provider status pages:

```text
[HEALTHY] ──(429/5xx spike > 20%)──→ [DEGRADED] ──(Continuous failure)──→ [OPEN]
    ▲                                                                        │
    │                                                                  (Cooldown elapsed)
    │                                                                        ↓
    └──────────────(Canary probe succeeds)────────────── [HALF_OPEN] ◄───────┘
```

- **DEGRADED:** Traffic assignment probability reduced by 50–80%; Scheduler routes to alternate resources.
- **OPEN:** Resource completely excluded from candidate generation for the duration of the cooldown window (e.g. 60s).
- **HALF_OPEN:** A single canary probe attempt is assigned; success restores status to `HEALTHY`, failure re-opens the circuit with exponential backoff.

---

## 10. Wait vs. Migrate Decision Engine (ADR-075)

When a primary resource encounters a temporary rate limit or quota exhaustion:
The engine evaluates the trade-off between waiting for a window reset and migrating to an alternate provider:

$$\text{Decision} = \begin{cases} 
\text{WAIT}, & \text{if } \text{ResetAt} - \text{Now} \le \text{MaxTolerableWait} \text{ and } \text{FallbackQuality} < \text{PrimaryQuality} - \Delta \\
\text{MIGRATE}, & \text{otherwise}
\end{cases}$$

- Interactive tasks ($\text{SLA} < 5\text{s}$) migrate immediately.
- Batch tasks with impending quota resets ($\le 20\text{s}$) pause and resume on the superior primary resource.

---

## 11. Core Interface Contract

```typescript
export interface ResourceIntelligence {
  findCandidates(requirement: ResourceRequirement): Promise<ResourceCandidate[]>;
  selectResource(requirement: ResourceRequirement): Promise<ResourceSelection>;
  reserve(selection: ResourceSelection): Promise<ResourceReservation>;
  release(reservationId: string): Promise<void>;
  reconcile(reservationId: string, actualUsage: Usage): Promise<void>;
  recordObservation(observation: ResourceObservation): Promise<void>;
  getResourceState(resourceId: string): Promise<Resource>;
  refresh(resourceId: string): Promise<void>;
}
```

---

## 12. Architectural Decision Log (ADR-067 to ADR-079)

- **ADR-067 (Concrete Resource Identity):** A resource is uniquely identified as `(Provider, Model, Credential)`, maintaining isolated quotas per credential instance.
- **ADR-068 (Filter-First Pipeline):** Hard constraints eliminate ineligible resources prior to scoring to prevent selecting high-scoring but unexecutable models.
- **ADR-069 (Logical Quota Reservations):** Pre-allocates estimated capacity internally to eliminate overcommit across concurrent workers.
- **ADR-070 (Usage Reconciliation Loop):** Reconciles reserved capacity against actual reported token consumption post-execution.
- **ADR-071 (Free-First Hierarchy):** Maximizes legitimate free AI utilization without compromising task quality floors.
- **ADR-072 (Zero Silent Spend):** Paid API usage strictly requires explicit developer policy authorization.
- **ADR-073 (Provider Fallback Diversity):** Fallback chains prioritize distinct provider backends to eliminate correlated outage risks.
- **ADR-074 (Empirical Circuit Breaker):** Resource health is calculated from actual runtime observations rather than provider status claims.
- **ADR-075 (Wait vs. Migrate Evaluation):** Compares reset latency against fallback quality loss to determine whether to wait or failover.
- **ADR-076 (Explainable Routing Traces):** Every selection records structured decision logs detailing why candidates were chosen or rejected.
- **ADR-077 (Conservative Capacity Estimations):** Unknown quotas or missing headers are treated with conservative confidence factors, never assumed infinite.
- **ADR-078 (Dynamic Concurrency Semaphores):** Enforces global provider and per-tenant concurrency limits to prevent upstream account flooding.
- **ADR-079 (Tail-Latency Awareness):** Performance routing prioritizes p95 and p99 statistics over misleading average latencies.

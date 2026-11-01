# M4 — MASTER EXECUTION PLAN
## Resource Intelligence & Free Resource Optimization

**Project:** AI-Execution-Engine  
**Milestone:** M4  
**Status:** IN_PROGRESS (Batch A Started)  
**Architecture:** FROZEN  
**Primary Objective:** Turn the available AI resource pool into an intelligent, measurable, free-first execution resource system.

---

# 1. Mission

M4 is NOT about adding hundreds of model integrations.

M4 is about making the engine intelligent about the resources it already has and the resources that can be onboarded.

The core principle is:

> We do not search for the best model. We search for the best possible execution of the task using the resources currently available.

M4 must answer:

> Given this task, these requirements, these currently available resources, their quotas, capabilities, health, latency, reliability, policy and cost constraints — what is the best resource and execution strategy right now?

---

# 2. Critical Product Direction

The product is explicitly **free-first**.

The engine should be able to exploit a pool such as:

```text
Provider APIs
Aggregators
OpenRouter
Other legitimate AI API sources
Free-tier resources
Free model access
BYOK resources
Paid resources when explicitly authorized
```

OpenRouter and other aggregators are valid resource sources.

However:

> AI-Execution-Engine is NOT an OpenRouter clone.

OpenRouter is one possible source of resources.

The engine's value is the intelligence above those sources.

---

# 3. M4 Scope

M4 focuses on:

1. Resource discovery representation.
2. Resource capability intelligence.
3. Free quota intelligence.
4. Rate-limit intelligence.
5. Resource health.
6. Availability.
7. Latency.
8. Reliability.
9. Resource freshness/confidence.
10. Cost/free-first optimization.
11. Dynamic resource scoring.
12. Resource selection.
13. Wait vs alternate-resource decisions.
14. Explainable routing decisions.
15. Resource reservations.
16. Resource degradation.
17. Resource cooldown/circuit breaking.
18. Safe resource onboarding.

M4 does NOT yet attempt to build the full Benchmark/Reputation learning system.

That is M5.

---

# 4. Existing Architecture Must Be Reused

Before implementing anything, inspect:

```text
docs/MASTER_ARCHITECTURE.md
docs/RESOURCE_INTELLIGENCE.md
docs/EXECUTION_ENGINE.md
docs/PROVIDER_ADAPTER_CONTRACT.md
docs/QUEUE_WORKER_ARCHITECTURE.md
docs/VALIDATION_ENGINE.md
docs/00_PROJECT_STATUS.md
all M0/M1/M2/M3 reports
```

Also inspect the current implementation.

Do not assume the previous architecture documents perfectly describe the current code.

Resolve documentation/code drift before modifying architecture.

---

# 5. Resource Intelligence Boundary

The architecture must remain:

```text
Task
 ↓
Execution Engine
 ↓
Resource Intelligence
 ↓
Selected Resource
 ↓
Provider Adapter
 ↓
Provider
```

Resource Intelligence owns:

- eligibility;
- capability filtering;
- quota awareness;
- health;
- availability;
- latency;
- cost;
- policy;
- free-first strategy;
- resource scoring;
- resource reservation;
- resource selection.

Provider adapters own:

- provider API communication;
- provider authentication;
- provider-specific errors;
- provider-specific request mapping;
- provider-specific response normalization;
- provider-specific usage/rate-limit extraction.

The adapter must NOT become a strategic router.

---

# 6. Resource Identity

The canonical resource identity remains:

```text
Provider + Model + Credential
```

Examples:

```text
Google + Gemini + Credential-A
Google + Gemini + Credential-B
OpenRouter + Model-X + Credential-A
Groq + Model-Y + Credential-A
```

Different credentials represent different resource capacity when the upstream quota is isolated.

Do not collapse isolated credentials into one quota bucket.

---

# 7. Free Resource Pool

M4 must support explicit resource classes:

```text
FREE
PAID
BYOK
INTERNAL
```

The important initial priority is:

```text
FREE
 ↓
FREE alternative
 ↓
Wait for free reset
 ↓
Explicitly authorized paid resource
```

Paid execution must never happen silently.

---

# 8. No Per-User Provider Quotas

Preserve the existing principle.

If a provider resource has:

```text
Quota = 100
```

and eligible users consume:

```text
A = 20
B = 30
C = 50
```

the resource is exhausted.

The system must report:

```text
RESOURCE_QUOTA_EXHAUSTED
```

not:

```text
USER_C_QUOTA_EXHAUSTED
```

Resource Intelligence manages actual resource capacity.

Any future user-level commercial budgets remain a separate policy concern.

---

# 9. Capability Intelligence

Resources must be represented by capabilities.

Examples:

```text
TEXT_GENERATION
STRUCTURED_OUTPUT
JSON
VISION
OCR
CODE
REASONING
MATH
LONG_CONTEXT
TOOL_CALLING
STREAMING
EMBEDDING
```

Do not invent unsupported capabilities.

Capabilities should come from:

1. provider/model metadata;
2. verified adapter declarations;
3. deterministic tests;
4. later benchmarks.

M5 will improve empirical capability confidence.

---

# 10. Resource Eligibility Pipeline

Resource selection should follow:

```text
Task
 ↓
Policy Filter
 ↓
Capability Filter
 ↓
Availability Filter
 ↓
Quota Filter
 ↓
Concurrency Filter
 ↓
Cost Filter
 ↓
Health Filter
 ↓
Quality/Freshness signals
 ↓
Scoring
 ↓
Reservation
 ↓
Selected Resource
```

A resource failing a hard constraint must not win through scoring.

---

# 11. Hard Constraints vs Soft Signals

This distinction is mandatory.

## Hard constraints

Examples:

```text
required capability unavailable
paid execution forbidden
resource unavailable
quota exhausted
concurrency unavailable
policy violation
credential invalid
model unavailable
```

Resource is excluded.

## Soft signals

Examples:

```text
latency
historical reliability
quality estimate
freshness
load
preference
cost
```

These influence ranking.

Do not mix hard eligibility with soft scoring.

---

# 12. Resource Scoring

Implement an explainable scoring mechanism.

Conceptually:

```text
score(resource, task)
=
capability_fit
+
quality_estimate
+
reliability
+
availability
+
latency
+
quota_headroom
+
cost_preference
+
policy_fit
```

However:

> Do not use arbitrary weights merely because they look sophisticated.

Weights must be documented and configurable.

M5 will later replace simplistic quality estimates with benchmark/reputation evidence.

---

# 13. Free-First Objective

The optimization objective should prioritize:

```text
1. Task success probability
2. Policy compliance
3. Free execution preference
4. Resource reliability
5. Quality
6. Latency
7. Cost
```

But free must not mean:

> Always use the cheapest resource regardless of task success.

Example:

```text
Free Resource A
quality estimate = poor

Free Resource B
quality estimate = high

Paid Resource C
quality estimate = high
```

If B is available:

```text
B wins.
```

If only C can satisfy the task:

```text
C may be considered
ONLY if paid execution is explicitly authorized.
```

---

# 14. Quota Intelligence

M4 must track more intelligently:

```text
remaining quota
quota type
reset time
consumption
reservation
estimated consumption
actual consumption
quota confidence
last observed
```

Different providers expose quota differently.

The adapter normalizes provider observations.

Core Resource Intelligence works with normalized values.

---

# 15. Logical Reservation

Preserve the existing reservation model.

Before execution:

```text
Resource
 ↓
Check capacity
 ↓
Reserve logical capacity
 ↓
Execute
 ↓
Reconcile actual usage
```

Reservation is an estimate.

It is NOT a claim that upstream quota is perfectly known.

Provider truth remains authoritative.

If actual usage differs:

```text
Reservation
 ↓
Actual Usage
 ↓
Reconciliation
```

---

# 16. Unknown Capacity

Unknown capacity must be represented explicitly.

Do not assume:

```text
unknown = unlimited
```

Do not assume:

```text
unknown = zero
```

Use conservative behavior.

Example:

```text
capacity = UNKNOWN
confidence = LOW
```

The resource may be used only according to a documented policy.

---

# 17. Rate Limits

Normalize:

```text
RPM
TPM
RPD
concurrency
cooldown
retry-after
```

A resource can be:

```text
quota_available
but
temporarily_rate_limited
```

These are different states.

Do not collapse them.

---

# 18. Resource Health

Resource health should be observable.

Example:

```text
HEALTHY
DEGRADED
UNAVAILABLE
COOLDOWN
DISABLED
UNKNOWN
```

Health should consider:

```text
recent failures
timeouts
rate limits
server errors
authentication failures
latency
successful executions
```

Do not allow one transient failure to permanently poison a resource.

---

# 19. Circuit Breaker / Cooldown

Implement a simple bounded circuit-breaker mechanism.

Example:

```text
HEALTHY
 ↓ repeated failures
DEGRADED
 ↓ threshold
COOLDOWN
 ↓ cooldown expires
PROBE
 ↓ success
HEALTHY
```

No permanent blacklisting based on temporary failure.

Provider-specific semantics remain inside adapters.

---

# 20. Wait vs Migrate vs Execute

Resource Intelligence must be able to distinguish:

```text
EXECUTE_NOW
WAIT
MIGRATE
FAIL
REQUEST_APPROVAL
```

Example:

```text
Resource A
quota exhausted
reset in 30 seconds

Resource B
available

→ MIGRATE
```

Another:

```text
Resource A
quota exhausted
reset in 10 seconds

Resource B
unavailable
Paid Resource C
not authorized

→ WAIT
```

Another:

```text
Only paid resource can satisfy capability
Paid execution unauthorized

→ REQUEST_APPROVAL
```

---

# 21. Explainable Decisions

Every strategic resource decision should be explainable.

Example:

```text
Decision:
SELECT_RESOURCE

Selected:
Resource-B

Reasons:
- required capability supported
- free execution allowed
- Resource-A quota exhausted
- Resource-C currently rate limited
- Resource-B healthy
- Resource-B has sufficient estimated capacity
```

Do not log secrets.

Do not log API keys.

Do not require raw prompts in the decision record.

---

# 22. Resource Decision Artifact / Record

Use the existing execution decision infrastructure where possible.

A decision should contain:

```text
decisionId
taskId
executionId
stepExecutionId
candidateResources
excludedResources
selectedResource
decisionType
reasons
policyContext
timestamp
```

This is critical for debugging and future reputation learning.

---

# 23. Candidate Ranking

The engine should be able to produce:

```text
Candidate #1 → Resource B
Candidate #2 → Resource A
Candidate #3 → Resource C
```

along with why candidates were excluded or ranked lower.

This allows us later to answer:

> Why did the engine choose this model?

---

# 24. Resource Discovery Registry

M4 should prepare the system for the broader free-resource ecosystem.

Do NOT manually hardcode a massive catalog.

Define a normalized onboarding representation:

```text
Provider
Model
Model Version
Credential
Resource
Capabilities
Free/Paid classification
Quota
Rate Limits
Pricing
Availability
Health
```

Potential sources include:

```text
Direct Provider APIs
OpenRouter
Other legitimate aggregators
Other legitimate free AI API providers
```

The engine must not assume all sources have the same semantics.

---

# 25. Provider Onboarding Contract

Create/document an onboarding checklist:

```text
1. Provider identity
2. Official API documentation
3. Authentication method
4. Available models
5. Model capabilities
6. Free availability
7. Free quota
8. Rate limits
9. Context limits
10. Output limits
11. Pricing
12. Usage reporting
13. Error taxonomy mapping
14. Health behavior
15. Adapter implementation
16. Contract tests
17. Real-provider verification
18. Resource registration
```

A resource does not become production-eligible merely because its API responds once.

---

# 26. OpenRouter

OpenRouter must be treated as a valid aggregation source.

But the architecture remains:

```text
Our Engine
 ↓
OpenRouter Adapter
 ↓
OpenRouter
 ↓
Available Models
```

OpenRouter does not own our:

- task state;
- validation;
- execution recovery;
- resource intelligence;
- reputation;
- collaboration;
- artifact lineage.

Our engine remains authoritative.

Do not create an OpenRouter-specific routing brain inside the core.

---

# 27. M4 Provider Initial Set

Do not attempt to integrate the entire market during M4.

First inspect the current repository and existing adapters.

Then prioritize a small representative set that gives diversity across:

```text
Direct provider
Aggregator
Free-tier provider
Different model families
Different capability profiles
```

OpenRouter should be considered in this initial set.

The exact provider list must be based on current API availability and legitimate free access at implementation time, not assumptions from this document.

If current free-tier conditions have changed, document the change.

---

# 28. Dynamic Resource State

Resource Intelligence must react to changing conditions.

Example:

```text
09:00
Resource A → healthy / free quota available

09:05
Resource A → quota exhausted

09:06
Resource B → selected

09:30
Resource A → quota reset

09:31
Resource A → eligible again
```

The engine must not permanently remove A.

---

# 29. Resource Freshness

Every observed resource fact should have freshness metadata where applicable.

Examples:

```text
quota observed at T
health observed at T
pricing observed at T
capability verified at T
```

Stale information should reduce confidence.

---

# 30. M4 BATCHES

# BATCH A — Resource Intelligence Foundation

### M4.1 Audit Existing Resource Intelligence

Inspect current implementation against:

```text
docs/RESOURCE_INTELLIGENCE.md
```

Document:

- implemented;
- partial;
- missing;
- contradictory.

No code changes until this audit is complete.

---

### M4.2 Normalized Resource State

Implement/complete:

```text
availability
health
quota state
rate limits
capacity
freshness
confidence
billing class
```

Reuse existing schema whenever possible.

---

### M4.3 Eligibility Engine

Implement deterministic hard filtering:

```text
capability
policy
quota
availability
concurrency
billing
```

Tests required.

### Batch A Gate

Must demonstrate:

```text
10 candidate resources
 ↓
hard constraints
 ↓
eligible subset
```

with deterministic results.

---

# BATCH B — Intelligent Selection

### M4.4 Resource Scoring

Implement explainable ranking.

Tests:

- capability fit;
- free-first;
- healthy vs degraded;
- latency;
- quota headroom;
- cost policy;
- deterministic tie breaking.

---

### M4.5 Wait/Migrate Decision

Implement:

```text
EXECUTE_NOW
WAIT
MIGRATE
FAIL
REQUEST_APPROVAL
```

Tests for quota reset and alternative-resource scenarios.

---

### M4.6 Decision Persistence

Persist the resource-selection decision through existing execution decision infrastructure.

Ensure:

- idempotency;
- traceability;
- no secrets;
- correlation.

### Batch B Gate

Demonstrate:

```text
Resource A → free but exhausted
Resource B → free and healthy
Resource C → paid
        ↓
Resource B selected
```

and:

```text
A exhausted
B unavailable
C paid + unauthorized
        ↓
WAIT / APPROVAL
```

---

# BATCH C — Health / Quota Intelligence

### M4.7 Health Tracking

Implement:

- success/failure observations;
- degradation;
- cooldown;
- recovery;
- probe behavior.

---

### M4.8 Quota Reconciliation

Compare:

```text
estimated usage
vs
actual provider usage
```

Update resource state safely.

---

### M4.9 Rate-Limit Intelligence

Handle:

```text
rate limit
retry-after
cooldown
temporary capacity
```

without confusing rate limits with permanent quota exhaustion.

### Batch C Gate

Demonstrate a resource becoming unavailable and later becoming eligible again.

---

# BATCH D — Resource Discovery / Onboarding

### M4.10 Resource Registry

Implement the normalized registry needed to support:

```text
Direct providers
Aggregators
OpenRouter
Other legitimate free sources
```

Do not build mass integrations yet.

---

### M4.11 Provider Onboarding Specification

Create:

```text
docs/PROVIDER_ONBOARDING.md
```

It must define:

- discovery;
- verification;
- free-tier verification;
- capabilities;
- limits;
- adapter;
- tests;
- registration;
- production eligibility.

---

### M4.12 Initial Free Resource Inventory

Create a structured inventory of the first selected resources.

For every resource record:

```text
Provider
Source type
Model
Access method
Free/paid
Free limits
Capabilities
Known restrictions
Last verification
Confidence
```

Important:

Current free-tier facts must be verified against current official provider documentation or reliable current evidence before being recorded.

Do not fabricate free quotas.

### Batch D Gate

At least one direct provider and one aggregator path must be represented correctly if technically available.

---

# BATCH E — Adversarial Resource Intelligence

### M4.13 Resource Failure Matrix

Test:

```text
quota exhausted
rate limit
network failure
server failure
authentication failure
unknown capacity
stale quota
stale health
concurrency exhausted
paid resource unauthorized
free resource unavailable
provider recovery
```

---

### M4.14 Concurrency Stress

Test multiple tasks competing for the same resource.

Verify:

```text
no over-reservation
no duplicate reservation
no lost capacity
no negative capacity
```

---

### M4.15 Decision Determinism

Given identical:

```text
task
policy
resource state
```

the selection result should be deterministic.

Except where intentionally modeled otherwise.

---

# BATCH F — Integration With M0–M3

### M4.16 Execution Integration

Run:

```text
Task
 ↓
Execution
 ↓
Resource Intelligence
 ↓
Selected Resource
 ↓
Provider Adapter
 ↓
Artifact
 ↓
Validation
```

---

### M4.17 M1 Integration

Test:

```text
Resource A
 ↓
QUOTA_EXHAUSTED
 ↓
Resource Intelligence
 ↓
Resource B
 ↓
New Attempt
```

---

### M4.18 M2 Integration

Test:

```text
Resource A
 ↓
Provider success
 ↓
Invalid output
 ↓
Validation
 ↓
Recovery
 ↓
Resource Intelligence
 ↓
Resource B
```

---

### M4.19 M3 Integration

Test:

```text
Task
 ↓
Multiple branches
 ↓
Resource Intelligence selects resources
 ↓
Independent execution
 ↓
Artifacts
 ↓
Synthesis
 ↓
Validation
```

Resource Intelligence must remain the strategic selector.

---

# 31. M4 Safety Rules

Never:

```text
silently spend money
```

Never:

```text
pretend unknown quota is unlimited
```

Never:

```text
route based only on model popularity
```

Never:

```text
hardcode provider-specific logic into core
```

Never:

```text
use benchmark claims that have not been verified
```

Never:

```text
treat free API as unlimited API
```

Never:

```text
make one provider failure permanently eliminate the resource
```

Never:

```text
let worker choose the resource strategically
```

Never:

```text
create a second router inside M4
```

---

# 32. M4 Metrics

Introduce/prepare:

```text
resource_selection_success_rate
resource_selection_latency
resource_failover_rate
quota_exhaustion_rate
free_execution_rate
paid_execution_rate
paid_execution_block_rate
resource_utilization
reservation_accuracy
quota_prediction_accuracy
resource_health_recovery_rate
selection_determinism
```

M5 will add model-quality and reputation metrics.

---

# 33. M4 Definition of Done

M4 is complete only when:

```text
Task
 ↓
Resource Intelligence
 ↓
Candidate discovery
 ↓
Hard eligibility filtering
 ↓
Free-first ranking
 ↓
Resource selection
 ↓
Logical reservation
 ↓
Execution
 ↓
Actual usage reconciliation
 ↓
Resource state update
```

works correctly under:

```text
quota exhaustion
rate limits
health degradation
alternative resources
free-resource competition
paid-resource restrictions
concurrency
provider recovery
```

and every important selection is explainable.

---

# 34. M4 Final Architecture

After M4:

```text
                         TASK
                           │
                           ▼
                     EXECUTION PLAN
                           │
                           ▼
                    RESOURCE INTELLIGENCE
                           │
          ┌────────────────┼────────────────┐
          │                │                │
      Eligibility       Ranking          Policy
          │                │                │
          └────────────────┼────────────────┘
                           ▼
                    Resource Decision
                           │
                           ▼
                  Logical Reservation
                           │
                           ▼
                  Provider Adapter
                           │
                           ▼
                       PROVIDER
                           │
                           ▼
                       ARTIFACT
                           │
                           ▼
                     VALIDATION
                           │
                           ▼
                        RESULT
```

And the resource pool may look like:

```text
                  RESOURCE POOL
                       │
       ┌───────────────┼────────────────┐
       ↓               ↓                ↓
 Direct Providers   Aggregators      Other Sources
       │               │                │
    Gemini         OpenRouter          ...
    Groq           ...
    DeepSeek
    Qwen
       └───────────────┼────────────────┘
                       ↓
              RESOURCE INTELLIGENCE
                       ↓
               Best Available
                 Execution
```

---

# 35. Relationship With M5

M4 must NOT pretend to know which model is objectively "best".

M4 establishes:

```text
resource state
+
capabilities
+
availability
+
quota
+
health
+
latency
+
cost
```

M5 adds:

```text
Benchmark
+
Production outcomes
+
Validation outcomes
+
Reputation
+
Confidence
+
Task-specific performance
```

Then the engine becomes significantly smarter.

---

# 36. Final M4 Principle

> **M4 does not make the engine collect more models. It makes the engine understand the resources it has.**

The product evolution is:

```text
M0
Can execute.

M1
Can recover from resource failure.

M2
Can recover from invalid output.

M3
Can coordinate multiple AI resources.

M4
Knows which available resources should be used.

M5
Learns which resources actually perform best for each kind of task.

M6
Can orchestrate sophisticated multi-model collaboration.
```

The final objective remains:

> **Use the maximum amount of legitimate available free AI capacity intelligently, safely, and efficiently — while never silently spending money — and produce the best validated execution possible for the task.**

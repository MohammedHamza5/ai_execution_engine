# M2 MASTER EXECUTION PLAN

## Invalid Output Recovery & Validation-Driven Execution

**Project:** AI-Execution-Engine  
**Milestone:** M2  
**Architecture:** FROZEN  
**Status:** COMPLETED & ACCEPTED (Batch A, Batch B, and Batch C fully verified; Audit Report: docs/M2_ACCEPTANCE_AUDIT.md)  

---

# 1. M2 PURPOSE

M2 extends the execution engine from recovering primarily from:

```text
RESOURCE / PROVIDER FAILURE
```

to recovering from:

```text
VALID PROVIDER RESPONSE
        ↓
INVALID / UNSAFE / UNVERIFIED OUTPUT
```

The provider may successfully return:

```text
HTTP 200
```

and still produce:

* malformed JSON
* schema-invalid output
* incomplete output
* invalid tool arguments
* invalid code
* mathematically incorrect answer
* unsupported claims
* missing evidence
* contradictory claims
* output that fails task requirements
* output that cannot pass deterministic validation
* output that is uncertain and requires further verification

Therefore:

> **Provider success is not execution success.**

M2 must make validation results first-class recovery signals.

---

# 2. M2 CORE PRINCIPLE

M1:

```text
Provider failure
        ↓
Recovery
```

M2:

```text
Provider success
        ↓
Validation
        ↓
Output invalid
        ↓
Diagnosis
        ↓
Recovery
```

The complete architecture becomes:

```text
Task
 ↓
Plan
 ↓
Step
 ↓
Execution
 ↓
Attempt
 ↓
Resource
 ↓
Provider
 ↓
Artifact
 ↓
Validation
 │
 ├── ACCEPT
 │      ↓
 │   COMPLETED
 │
 ├── REJECT
 │      ↓
 │   DIAGNOSIS
 │      ↓
 │   RECOVERY
 │      ↓
 │   NEW ATTEMPT
 │
 └── UNCERTAIN
        ↓
   WAIT / SECONDARY VALIDATION
```

---

# 3. ARCHITECTURAL BASELINE

The following remain authoritative:

```text
docs/MASTER_ARCHITECTURE.md
docs/INTERNAL_DATA_MODEL.md
docs/DATABASE_SCHEMA.md
docs/EVENT_MODEL.md
docs/QUEUE_WORKER_ARCHITECTURE.md
docs/PROVIDER_ADAPTER_CONTRACT.md
docs/RESOURCE_INTELLIGENCE.md
docs/EXECUTION_ENGINE.md
docs/VALIDATION_ENGINE.md
docs/FINAL_ARCHITECTURE_AUDIT.md
docs/AGENT_RULES.md
docs/M0_IMPLEMENTATION_REPORT.md
M1 implementation and reports
```

Architecture remains:

```text
FROZEN
```

M2 MUST NOT introduce:

* another validation engine
* another task state machine
* another resource router
* another queue
* Redis
* Kafka
* RabbitMQ
* Temporal
* another database
* hidden paid validation
* model majority voting as truth
* validation logic inside provider adapters

---

# 4. M2 RELATIONSHIP WITH M1

M1 owns:

```text
Provider/resource failure
```

Examples:

```text
QUOTA_EXHAUSTED
RATE_LIMIT
TIMEOUT
NETWORK_ERROR
SERVER_ERROR
SERVICE_UNAVAILABLE
```

M2 owns:

```text
Output/validation failure
```

Examples:

```text
SCHEMA_INVALID
MISSING_REQUIRED_OUTPUT
INVALID_TOOL_ARGUMENTS
DETERMINISTIC_CHECK_FAILED
CODE_TEST_FAILED
CLAIM_UNSUPPORTED
EVIDENCE_MISSING
OUTPUT_INCOMPLETE
VALIDATION_REJECTED
VALIDATION_UNCERTAIN
```

Do not duplicate M1 recovery logic.

M2 should reuse the existing:

```text
Recovery Policy
Checkpointing
Attempt lifecycle
Resource Intelligence
Fencing
Idempotency
Validation Engine
Artifact system
```

---

# 5. M2 TARGET

M2 must demonstrate:

```text
Attempt 1
 ↓
Provider succeeds
 ↓
Artifact generated
 ↓
Validation
 ↓
REJECT
 ↓
Diagnosis
 ↓
Recovery decision
 ↓
Attempt 2
 ↓
possibly same or different resource
 ↓
new artifact
 ↓
Validation
 ↓
ACCEPT
 ↓
COMPLETED
```

The logical execution remains the same.

The failed output becomes part of execution history.

---

# 6. M2 EXECUTION MODEL

The core distinction must remain:

```text
Task
 ↓
Step
 ↓
Execution
 ├── Attempt 1
 │     ├── Provider output
 │     └── Invalid artifact
 │
 └── Attempt 2
       ├── Provider output
       └── Valid artifact
```

Never create:

```text
Task 2
```

just because the first generated output was invalid.

Never create a duplicate logical execution.

---

# 7. BATCH STRUCTURE

M2 is divided into three implementation batches:

```text
BATCH A
Validation Failure Foundation
M2.1 → M2.2 → M2.3

        ↓

BATCH B
Validation-Driven Recovery
M2.4 → M2.5 → M2.6

        ↓

BATCH C
Hardening & Acceptance
M2.7 → M2.8 → M2.9 → M2.10
```

The same accelerated workflow used in M1 applies.

Antigravity may execute all tasks within a batch sequentially.

Do NOT stop after every micro-task.

STOP at the end of each batch.

Immediately STOP if an architectural conflict is discovered.

---

# 8. M2.1 — VALIDATION OUTCOME NORMALIZATION

## Objective

Create a single deterministic interpretation layer for Validation Engine outcomes.

The existing Validation Engine already defines:

```text
ACCEPT
REJECT
UNCERTAIN
```

M2 must connect those outcomes to execution behavior.

---

## Required principle

Do NOT create another validation taxonomy.

Reuse existing validation contracts:

```text
ValidationRequest
ValidationSummary
TierResult
ClaimRecord
EvidenceReference
DisputeRecord
```

and existing validation result structures.

---

## Execution interpretation

Conceptually:

```text
ACCEPT
 ↓
output eligible for completion
```

```text
REJECT
 ↓
output cannot complete execution
 ↓
diagnose/recover
```

```text
UNCERTAIN
 ↓
output cannot silently become completed
 ↓
wait / secondary validation / approval
```

---

## Required implementation

Inspect existing:

```text
src/validation/*
src/engine/*
```

before creating anything.

Create the smallest appropriate execution-side normalization module.

Possible location:

```text
src/engine/validationOutcome.ts
```

Use project conventions if an equivalent module already exists.

---

## Requirements

The normalization layer must:

* be deterministic
* contain no provider-specific logic
* contain no resource selection
* contain no external API calls
* preserve validation evidence
* preserve failure reasons
* preserve uncertainty
* never convert `UNCERTAIN` into `ACCEPT`
* never convert `REJECT` into `ACCEPT`

---

## Tests

At minimum:

1. ACCEPT mapping
2. REJECT mapping
3. UNCERTAIN mapping
4. validation reason preserved
5. validation tier preserved
6. evidence references preserved
7. deterministic mapping
8. no silent acceptance

---

# 9. M2.2 — VALIDATION FAILURE DIAGNOSIS

## Objective

Determine why an output failed validation.

The engine must distinguish:

```text
invalid structure
```

from:

```text
invalid content
```

from:

```text
insufficient evidence
```

from:

```text
uncertainty
```

without creating an uncontrolled second validation engine.

---

## Diagnosis should consume existing validation results

Examples:

```text
SCHEMA
 ↓
STRUCTURAL_FAILURE
```

```text
DETERMINISTIC
 ↓
VALUE_FAILURE
```

```text
EXECUTION
 ↓
CODE_EXECUTION_FAILURE
```

```text
EVIDENCE
 ↓
GROUNDING_FAILURE
```

```text
UNCERTAIN
 ↓
INSUFFICIENT_VERIFICATION
```

The exact categories must be derived from the existing Validation Engine contracts.

Do not invent arbitrary categories that duplicate validation semantics.

---

## Required diagnosis information

At minimum:

```text
validation_id
artifact_id
validation outcome
failed tiers
failure reasons
affected claims where applicable
evidence state
deterministic check state
recoverability
recommended recovery class
```

---

## Critical principle

Diagnosis answers:

> "Why did this output fail?"

It does NOT decide:

> "Which provider should I use?"

Resource selection remains Resource Intelligence's responsibility.

---

## Tests

At minimum:

1. schema failure diagnosis
2. deterministic failure diagnosis
3. execution failure diagnosis
4. evidence failure diagnosis
5. uncertain diagnosis
6. multi-tier failure
7. recoverable failure
8. non-recoverable failure
9. diagnosis preserves evidence
10. deterministic classification

---

# 10. M2.3 — VALIDATION FAILURE PERSISTENCE

## Objective

Make validation failures durable and traceable within the execution history.

The system must be able to answer:

```text
What artifact failed?
Why did it fail?
Which validation run rejected it?
Which attempt produced it?
What recovery happened afterward?
Which artifact eventually succeeded?
```

---

## Reuse existing validation schema

Existing authoritative structures include:

```text
validation.validations
validation.validation_results
validation.claims
validation.evidence
validation.disputes
```

Do NOT create duplicate validation tables.

---

## Execution linkage

Ensure the execution history can correlate:

```text
Task
 ↓
Step
 ↓
Execution
 ↓
Attempt
 ↓
Artifact
 ↓
Validation
 ↓
Diagnosis
 ↓
Recovery
 ↓
Next Attempt
```

Use existing IDs and relationships wherever possible.

---

## Tests

Verify:

1. failed artifact linked to validation
2. validation linked to attempt
3. rejection reason persisted
4. validation remains immutable/auditable
5. subsequent attempt does not overwrite previous validation
6. artifact lineage preserved

---

# BATCH A ACCEPTANCE GATE

Run:

```text
npm test
npx tsc --noEmit
npm run build
```

Verify:

* no duplicate validation system
* no duplicate taxonomy
* no architectural changes
* validation outcomes remain tri-state
* failed artifacts remain traceable
* evidence is preserved

Create:

```text
docs/M2_BATCH_A_REPORT.md
```

Update:

```text
docs/M2_MASTER_EXECUTION_PLAN.md
docs/00_PROJECT_STATUS.md
```

Then:

```text
STOP
```

---

# BATCH B — VALIDATION-DRIVEN RECOVERY

# M2.4 — RECOVERY POLICY FOR INVALID OUTPUT

## Objective

Extend recovery policy so invalid outputs can trigger safe recovery.

Do NOT replace M1 recovery policy.

Extend it through composition.

---

## Important distinction

M1:

```text
Provider error
```

M2:

```text
Validation result
```

The system must not confuse them.

---

## Example

```text
Provider
 ↓
SUCCESS
 ↓
Validation
 ↓
REJECT
```

This is NOT:

```text
SERVER_ERROR
```

It is:

```text
OUTPUT_VALIDATION_FAILURE
```

---

## Possible recovery decisions

Depending on diagnosis:

```text
RETRY_SAME
MIGRATE_RESOURCE
REPLAN
WAIT
FAIL
```

Only use decisions already compatible with the execution architecture.

Do not introduce unnecessary state transitions.

---

## Recovery examples

### Schema failure

Potentially:

```text
RETRY_SAME
```

with corrected generation constraints.

---

### Capability-related output failure

Potentially:

```text
MIGRATE_RESOURCE
```

if another resource has better capability.

---

### Deterministic calculation failure

Potentially:

```text
RETRY
```

or:

```text
REPLAN
```

depending on task strategy.

---

### Missing evidence

Potentially:

```text
REPLAN
```

or a validation-specific follow-up step.

---

### Uncertain

Usually:

```text
WAIT
```

or secondary verification.

Do NOT automatically retry until something eventually says ACCEPT.

---

# ZERO SILENT SPEND

If recovery requires another model/resource:

```text
allowPaid = false
```

must prevent paid execution.

No validation failure may silently cause paid generation.

---

# Tests

At minimum:

1. schema rejection → recovery
2. deterministic rejection → recovery
3. execution rejection → recovery
4. evidence rejection → recovery
5. uncertainty → wait/secondary validation
6. non-recoverable rejection → fail
7. paid resource blocked
8. deterministic recovery decision

---

# M2.5 — VALIDATION-DRIVEN NEW ATTEMPT

## Objective

Connect validation rejection to the existing M1 attempt lifecycle.

Example:

```text
Attempt 1
 ↓
Provider success
 ↓
Artifact A
 ↓
Validation REJECT
 ↓
Checkpoint
 ↓
Recovery
 ↓
Attempt 2
 ↓
Artifact B
 ↓
Validation ACCEPT
```

---

## Critical requirements

Attempt 1 remains immutable history.

Do NOT overwrite:

```text
Attempt 1
Artifact A
Validation A
```

Attempt 2 creates:

```text
Attempt 2
Artifact B
Validation B
```

---

## Checkpoint

Before recovery:

```text
validation result
+
diagnosis
+
recovery decision
```

must be durable.

---

## Fencing

Attempt 1 cannot later commit completion after Attempt 2 becomes authoritative.

---

## Tests

At minimum:

1. rejected artifact → new attempt
2. previous artifact preserved
3. previous validation preserved
4. new attempt receives unique ID
5. stale worker rejected
6. successful second artifact becomes authoritative
7. validation gates completion

---

# M2.6 — END-TO-END VALIDATION RECOVERY

## Objective

Integrate M2 completely.

Canonical flow:

```text
Task
 ↓
Step
 ↓
Execution
 ↓
Attempt 1
 ↓
Resource A
 ↓
Provider SUCCESS
 ↓
Artifact A
 ↓
Validation REJECT
 ↓
Diagnosis
 ↓
Checkpoint
 ↓
Recovery Policy
 ↓
Resource Intelligence if required
 ↓
Attempt 2
 ↓
Resource B or A
 ↓
Provider SUCCESS
 ↓
Artifact B
 ↓
Validation ACCEPT
 ↓
COMPLETED
```

---

# IMPORTANT RESOURCE DECISION

Validation failure does NOT automatically mean migrate resource.

The system must first understand the failure.

Examples:

```text
bad prompt/format
→ same resource may retry
```

```text
capability deficiency
→ alternative resource may be required
```

```text
unsupported evidence
→ replan may be required
```

```text
uncertainty
→ wait/secondary verification
```

Resource Intelligence still owns the resource decision.

---

# M2.6 ACCEPTANCE

The complete validation-driven recovery flow must work using:

```text
Artifact
Validation
Diagnosis
Checkpoint
Recovery
Attempt
Resource Intelligence
Validation
```

without introducing another orchestration system.

---

# BATCH B ACCEPTANCE GATE

Run:

```text
npm test
npx tsc --noEmit
npm run build
```

Mandatory E2E:

```text
Attempt 1
 ↓
valid provider response
 ↓
invalid output
 ↓
validation reject
 ↓
checkpoint
 ↓
recovery
 ↓
Attempt 2
 ↓
valid output
 ↓
validation accept
 ↓
completed
```

Also verify:

* previous artifact preserved
* previous validation preserved
* attempt identity preserved
* fencing works
* no hidden paid path
* no provider transaction
* no duplicate task
* no duplicate execution

Create:

```text
docs/M2_BATCH_B_REPORT.md
```

Update:

```text
docs/M2_MASTER_EXECUTION_PLAN.md
docs/00_PROJECT_STATUS.md
```

Then:

```text
STOP
```

---

# BATCH C — HARDENING & ACCEPTANCE

# M2.7 — VALIDATION FAILURE MATRIX

Test all important validation failure classes.

At minimum:

```text
SCHEMA_FAILURE
DETERMINISTIC_FAILURE
EXECUTION_FAILURE
EVIDENCE_FAILURE
CLAIM_GROUNDING_FAILURE
OUTPUT_INCOMPLETE
INVALID_TOOL_ARGUMENTS
QUALITY_REJECTION
UNCERTAIN
```

The exact names must follow the existing Validation Engine rather than creating an incompatible taxonomy.

---

## Required verification

For each class verify:

```text
validation
 ↓
diagnosis
 ↓
recovery
 ↓
attempt
 ↓
validation
```

Where recovery is not safe:

```text
FAIL
```

Where verification is incomplete:

```text
UNCERTAIN
```

Never convert uncertainty to success for convenience.

---

# M2.8 — ADVERSARIAL VALIDATION & RECOVERY HARDENING

## Objective

Test cases where the model output looks convincing but is wrong.

This is critical.

---

## Required cases

### Case 1 — Schema-valid but semantically wrong

```text
JSON valid
 ↓
Schema ACCEPT
 ↓
Deterministic/semantic validation REJECT
```

Expected:

```text
NOT COMPLETED
```

---

### Case 2 — Two models agree but both are wrong

```text
Generator A → answer X
Generator B → answer X
```

Agreement is NOT proof.

Validation must determine truth using appropriate validation methods.

---

### Case 3 — Correct-looking unsupported claim

```text
Claim
 ↓
No sufficient evidence
```

Expected:

```text
REJECT / UNCERTAIN
```

according to validation result.

---

### Case 4 — Malformed structured output

Provider returns:

```text
invalid JSON
```

Expected:

```text
validation failure
```

and recovery path.

---

### Case 5 — Partial output

Provider returns incomplete required fields.

Expected:

```text
NOT COMPLETED
```

---

### Case 6 — Valid code that fails tests

```text
code parses
 ↓
tests fail
```

Expected:

```text
REJECT
```

and recovery.

---

### Case 7 — False confidence

A model claims certainty while validation is uncertain.

Expected:

```text
UNCERTAIN
```

The model's confidence cannot override the Validation Engine.

---

# M2.9 — FULL VERIFICATION & RECOVERY AUDIT

Run:

```text
npm test
npx tsc --noEmit
npm run build
```

Run all M0 + M1 + M2 tests.

---

# Mandatory end-to-end scenarios

## E2E 1 — Normal success

```text
Provider
 ↓
Artifact
 ↓
Validation ACCEPT
 ↓
Completed
```

---

## E2E 2 — Invalid output recovery

```text
Provider success
 ↓
Artifact
 ↓
Validation REJECT
 ↓
Recovery
 ↓
New attempt
 ↓
Artifact
 ↓
Validation ACCEPT
 ↓
Completed
```

---

## E2E 3 — Resource failure + invalid output

This combines M1 and M2.

```text
Attempt 1
 ↓
Resource A
 ↓
QUOTA_EXHAUSTED
 ↓
M1 migration
 ↓
Resource B
 ↓
Attempt 2
 ↓
Provider success
 ↓
Artifact
 ↓
Validation REJECT
 ↓
M2 recovery
 ↓
Attempt 3
 ↓
Artifact
 ↓
Validation ACCEPT
 ↓
Completed
```

This is an extremely important integration test.

---

## E2E 4 — Invalid output followed by resource failure

```text
Attempt 1
 ↓
Provider success
 ↓
Validation REJECT
 ↓
Recovery
 ↓
Attempt 2
 ↓
Resource failure
 ↓
M1 recovery
 ↓
Attempt 3
 ↓
Validation ACCEPT
```

M1 and M2 must compose correctly.

---

## E2E 5 — Validation uncertainty

```text
Artifact
 ↓
Validation UNCERTAIN
 ↓
WAIT / secondary verification
```

Expected:

```text
NOT COMPLETED
```

until the required verification condition is satisfied.

---

# M2.10 — FINAL ACCEPTANCE AUDIT

M2 is accepted only if all of the following are true.

---

## Validation

* [ ] provider success does not imply task success
* [ ] artifact always passes through validation
* [ ] ACCEPT remains explicit
* [ ] REJECT remains explicit
* [ ] UNCERTAIN remains explicit
* [ ] uncertainty is never silently accepted

---

## Diagnosis

* [ ] validation failure is diagnosable
* [ ] failed tier is identifiable
* [ ] reason is preserved
* [ ] evidence is preserved
* [ ] artifact linkage is preserved

---

## Recovery

* [ ] validation failure can trigger recovery
* [ ] recovery decision is deterministic
* [ ] recovery is bounded
* [ ] no infinite retry loop
* [ ] no blind migration
* [ ] no hidden paid execution

---

## Attempts

* [ ] failed output remains traceable
* [ ] new attempt has unique identity
* [ ] previous attempt is not overwritten
* [ ] new artifact has lineage
* [ ] successful attempt becomes authoritative

---

## M1 Integration

* [ ] provider failure still uses M1 recovery
* [ ] validation failure uses M2 recovery
* [ ] both can compose
* [ ] resource selection remains centralized
* [ ] fencing remains valid
* [ ] checkpoints remain durable

---

## Validation Independence

* [ ] provider cannot declare its own output valid
* [ ] generator cannot bypass validation
* [ ] model agreement is not proof
* [ ] deterministic checks take precedence where applicable
* [ ] evidence requirements remain enforceable

---

## Security / Cost

* [ ] no secret leakage
* [ ] no hidden paid validation
* [ ] paid fallback requires explicit authorization
* [ ] provider calls outside DB transactions

---

## Verification

* [ ] unit tests pass
* [ ] integration tests pass
* [ ] E2E tests pass
* [ ] typecheck passes
* [ ] build passes
* [ ] crash/recovery tests pass
* [ ] fencing tests pass

---

# 9. M2 INVARIANTS

These MUST remain true.

## Invariant 1

Provider success ≠ execution success.

## Invariant 2

Artifact creation ≠ completion.

## Invariant 3

Validation ACCEPT is required for normal completion.

## Invariant 4

REJECT cannot become ACCEPT through retry convenience.

## Invariant 5

UNCERTAIN cannot silently become ACCEPT.

## Invariant 6

Failed artifacts remain traceable.

## Invariant 7

Validation history is immutable/auditable.

## Invariant 8

Validation does not choose providers.

## Invariant 9

Resource Intelligence remains responsible for resource selection.

## Invariant 10

A validation failure creates a new attempt when recovery is appropriate.

## Invariant 11

A new attempt does not create a new task.

## Invariant 12

A new attempt does not create a duplicate logical execution.

## Invariant 13

Fencing prevents stale workers from corrupting authoritative state.

## Invariant 14

Provider calls remain outside DB transactions.

## Invariant 15

No silent paid execution.

## Invariant 16

No infinite retry.

---

# 10. M2 RETRY SAFETY

M2 must never implement:

```text
REJECT
 ↓
RETRY
 ↓
REJECT
 ↓
RETRY
 ↓
REJECT
...
```

without bounded recovery.

Every recovery should consider:

```text
attempt count
recovery count
elapsed time
task deadline
failure reason
resource diversity
previous strategy
```

A retry should normally change something meaningful:

```text
prompt constraints
generation strategy
resource
model
tool strategy
plan
validation method
```

Do not repeatedly ask the same resource for the same invalid output indefinitely.

---

# 11. RESOURCE DIVERSITY

When repeated validation failures indicate a capability problem, the engine may request Resource Intelligence to find another resource.

Example:

```text
Resource A
 ↓
Output repeatedly fails capability validation
 ↓
Diagnosis
 ↓
Capability concern
 ↓
Resource Intelligence
 ↓
Resource B
```

However:

> Validation Engine diagnoses. Resource Intelligence selects.

Do not merge their responsibilities.

---

# 12. ARTIFACT LINEAGE

M2 must preserve artifact lineage.

Example:

```text
Artifact A
produced by Attempt 1
validation = REJECT
        │
        ▼
Artifact B
produced by Attempt 2
validation = ACCEPT
```

The system must be able to identify:

```text
original artifact
derived artifact
attempt
validation
recovery reason
final artifact
```

Never overwrite Artifact A merely because Artifact B succeeded.

---

# 13. OBSERVABILITY

An engineer must be able to reconstruct:

```text
Task
 ↓
Step
 ↓
Execution
 ↓
Attempt 1
 ↓
Artifact A
 ↓
Validation A
 ↓
REJECT
 ↓
Diagnosis
 ↓
Recovery
 ↓
Attempt 2
 ↓
Artifact B
 ↓
Validation B
 ↓
ACCEPT
 ↓
Completed
```

Logs/events should expose identifiers and state transitions.

Never expose:

* API keys
* provider credentials
* authorization headers
* sensitive secrets

---

# 14. DOCUMENTATION

Maintain:

```text
docs/M2_MASTER_EXECUTION_PLAN.md
docs/M2_BATCH_A_REPORT.md
docs/M2_BATCH_B_REPORT.md
docs/M2_IMPLEMENTATION_REPORT.md
```

Continuously update:

```text
docs/00_PROJECT_STATUS.md
```

---

# 15. STATUS TRACKING

At M2 start:

```text
Architecture: FROZEN
M0: ACCEPTED
M1: ACCEPTED / current verified status
M2: IN PROGRESS

Current Batch: A
Current Task: M2.1
```

After each completed task, update status.

After each batch, update status.

Never claim work that has not been verified.

---

# 16. M2 EXECUTION DISCIPLINE

For each task:

```text
READ
 ↓
INSPECT EXISTING IMPLEMENTATION
 ↓
PLAN
 ↓
IMPLEMENT
 ↓
TARGETED TESTS
 ↓
FULL TESTS
 ↓
TYPECHECK
 ↓
BUILD
 ↓
DIFF REVIEW
 ↓
DOCUMENT
 ↓
MARK COMPLETE
```

Do not weaken tests to obtain green results.

Do not delete failing tests.

Do not hide failures.

Do not fabricate external verification.

---

# 17. SPEED MODE

M2 should use the same accelerated workflow:

```text
Batch A
M2.1 → M2.2 → M2.3
 ↓
Verification
 ↓
STOP

Batch B
M2.4 → M2.5 → M2.6
 ↓
Verification
 ↓
STOP

Batch C
M2.7 → M2.8 → M2.9 → M2.10
 ↓
Final Acceptance
```

Do NOT stop after every micro-task.

But do immediately stop on:

```text
architecture conflict
security risk
data corruption risk
validation bypass
fencing failure
silent paid execution
provider transaction violation
fundamental state-machine contradiction
```

---

# 18. FINAL M2 TARGET

The completed M2 system must demonstrate:

```text
                     TASK
                       │
                       ▼
                      STEP
                       │
                       ▼
                   EXECUTION
                       │
                       ▼
                   ATTEMPT #1
                       │
                       ▼
                    RESOURCE
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
              ┌────────┼────────┐
              │        │        │
           ACCEPT    REJECT   UNCERTAIN
              │        │        │
              │        │        ▼
              │        │      WAIT /
              │        │    VERIFY MORE
              │        │
              │        ▼
              │     DIAGNOSIS
              │        │
              │        ▼
              │     CHECKPOINT
              │        │
              │        ▼
              │     RECOVERY
              │        │
              │        ▼
              │   NEW ATTEMPT
              │        │
              │        ▼
              │     ARTIFACT
              │        │
              │        ▼
              │    VALIDATION
              │        │
              └────────┘
                       │
                       ▼
                   COMPLETED
```

The fundamental M2 achievement is:

> **The engine can detect that a successful AI call produced an invalid result, preserve the failed artifact and validation evidence, diagnose the failure, recover through a new attempt or appropriate strategy, and only complete the logical execution after independent validation accepts the resulting artifact.**

---

# 19. M2 + M1 COMBINED CAPABILITY

At the end of M2 the engine must be able to handle both:

```text
                    EXECUTION
                        │
                        ▼
                     ATTEMPT
                        │
                 ┌──────┴──────┐
                 │             │
          PROVIDER FAILURE   PROVIDER SUCCESS
                 │             │
                 ▼             ▼
              M1 RECOVERY    ARTIFACT
                 │             │
                 ▼             ▼
              CHECKPOINT    VALIDATION
                 │          │    │    │
                 │       ACCEPT REJECT UNCERTAIN
                 │          │    │    │
                 │          │    │    ▼
                 │          │    │   WAIT
                 │          │    │
                 │          │    ▼
                 │          │  M2 RECOVERY
                 │          │    │
                 │          └────┘
                 │               │
                 └───────────────┘
                         │
                         ▼
                    NEW ATTEMPT
                         │
                         ▼
                     ARTIFACT
                         │
                         ▼
                    VALIDATION
                         │
                         ▼
                      ACCEPT
                         │
                         ▼
                    COMPLETED
```

This composition is mandatory.

M1 and M2 must not become isolated systems.

---

# 20. FINAL M2 ACCEPTANCE VERDICT

Only M2.10 may issue the final verdict.

Allowed:

```text
M2 ACCEPTED
```

or:

```text
M2 ACCEPTED WITH DOCUMENTED LIMITATIONS
```

or:

```text
M2 NOT ACCEPTED
```

The verdict must be evidence-based.

---

# 21. FINAL M2 REPORT

Create:

```text
docs/M2_IMPLEMENTATION_REPORT.md
```

It must contain:

1. Executive summary
2. M2 objectives
3. M2.1 result
4. M2.2 result
5. M2.3 result
6. M2.4 result
7. M2.5 result
8. M2.6 result
9. M2.7 result
10. M2.8 result
11. M2.9 result
12. M2.10 audit
13. Files changed
14. Database changes
15. Validation integration
16. Recovery integration
17. Artifact lineage
18. Attempt lifecycle
19. Resource migration integration
20. Fencing verification
21. Crash verification
22. Test results
23. Build/typecheck results
24. E2E results
25. Known limitations
26. Deferred work
27. Final acceptance verdict

---

# 22. START CONDITION

M2 MUST NOT start until:

```text
M0 = ACCEPTED
M1 = ACCEPTED
Architecture = FROZEN
```

If M1 is still incomplete:

```text
STOP
```

and complete M1 first.

Once M1 is accepted:

```text
START M2.1
```

Then execute Batch A sequentially.

---

# 23. MASTER RULE

The project repository is the durable source of truth.

Maintain:

```text
docs/M2_MASTER_EXECUTION_PLAN.md
docs/00_PROJECT_STATUS.md
```

The chat is not the project memory.

The repository must contain enough information to reconstruct:

* what was completed
* what was not completed
* current batch
* current task
* test status
* limitations
* acceptance status

without relying on previous conversation context.

---

# END OF M2 MASTER EXECUTION PLAN

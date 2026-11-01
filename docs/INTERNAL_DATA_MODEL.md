# AI Execution Engine — Internal Data Model Specification

**Document:** `INTERNAL_DATA_MODEL.md`  
**Status:** COMPLETE (Domain Specification Baseline)  
**Version:** 1.0.0  
**Authority:** Derived from Internal Data Model v1.0 Material  

---

## 1. Purpose

The Internal Data Model serves as the formal **Data Contract** across all core engines of the system:
`Task Intelligence` ↔ `Planner` ↔ `Execution Engine` ↔ `Resource Intelligence` ↔ `Truth Engine` ↔ `Reputation Engine`.

It defines strict domain boundaries, entity schemas, lifecycle states, relationships, and invariants. The design guarantees full traceability, durability, and recovery without coupling the core engine to any single AI provider or execution technology.

---

## 2. Core Architectural Principles

1. **Entity Separation:**
   `Task != Step != Attempt != Resource != Model != Provider != Artifact != Validation != Decision != Event`.
   These entities represent fundamentally distinct lifecycles and must never be merged into overloaded tables.
2. **Execution Hierarchy:**
   ```text
   Tenant → Project → Task → ExecutionPlan → PlanStep → StepExecution → ExecutionAttempt → Artifact → Validation
   ```
3. **Resource Hierarchy:**
   ```text
   Provider → Model → ModelVersion → Credential → Resource → (Capability, Quota, Health)
   ```
4. **Immutable History:**
   Historical records (`ExecutionAttempt`, `ValidationResult`, `ResourceHealthEvent`, `PlanDecision`, `Checkpoint`, `Event`) are strictly append-only. State changes generate new records rather than mutating or erasing execution history.
5. **Universal ID Strategy (ADR-016):**
   All entity IDs use **UUIDv7** (time-sortable, globally unique, distributed-friendly, and optimal for B-Tree indexing).
6. **Data Storage Hybrid (ADR-019):**
   - **Structured Relational Columns:** Stable, indexed, queried fields (`status`, `ids`, `scores`, `timestamps`, `quotas`).
   - **JSONB Flexible Storage:** Variable extension metadata, schemas, and provider-specific parameters. Dumping entire entities into unstructured JSON is strictly prohibited.
7. **Single Source of Truth vs. Derived State:**
   - **Source of Truth:** Immutable events, execution attempts, validated artifacts, and checkpoints.
   - **Derived/Cached State:** Snapshots (`TaskState`, `ResourceHealth.status`, `ResourceQuota.remaining`). If derived state is corrupted, it can be deterministically replayed and reconstructed from history.

---

## 3. Domain Entity Inventory

The model is partitioned across **10 Logical Domains**:

```text
1. IDENTITY & TENANCY    : Tenant, User, Project, APIKey
2. TASK SYSTEM           : Task, TaskInput, TaskOutput, TaskRequirement, TaskPolicy, TaskState, TaskDependency, TaskTag
3. PLANNING              : ExecutionPlan, PlanRevision, PlanStep, StepDependency, Strategy, PlanDecision
4. EXECUTION             : Execution, StepExecution, ExecutionAttempt, ExecutionError, Checkpoint, Handoff
5. ARTIFACTS             : Artifact, ArtifactVersion, ArtifactRelation, ArtifactValidation
6. AI ECOSYSTEM          : Provider, Model, ModelVersion, Capability, ModelCapability
7. RESOURCE INTELLIGENCE : Resource, Credential, ResourceCapability, ResourceQuota, ResourceUsage, ResourceHealth, ResourceHealthEvent, ResourceReservation
8. VALIDATION & TRUTH    : Validation, ValidationRule, ValidationResult, Claim, Evidence, Dispute, DisputePosition, Resolution
9. EVALUATION & BENCHMARK: Evaluation, EvaluationMetric, Benchmark, BenchmarkCase, BenchmarkRun, BenchmarkResult
10. REPUTATION           : ReputationProfile, ReputationScore, ReputationEvidence, ReputationSnapshot
11. SYSTEM & POLICIES    : Event, AuditLog, Policy, FeatureFlag
```

---

## 4. Entity Specifications

### 4.1 Tenancy & Identity

#### Tenant
Represents a customer account, billing boundary, or organization.
- **Fields:** `id` (UUIDv7, PK), `name` (varchar), `slug` (varchar, unique), `status` (`active`, `suspended`, `deleted`), `plan` (`free`, `pro`, `team`, `enterprise`), `settings` (jsonb), `created_at` (timestamptz), `updated_at` (timestamptz), `deleted_at` (timestamptz, nullable).

#### User
Represents a human operator within a tenant.
- **Fields:** `id` (UUIDv7, PK), `tenant_id` (FK -> Tenant), `email` (varchar, unique), `name` (varchar), `status` (`active`, `suspended`, `deleted`), `role` (`owner`, `admin`, `developer`, `viewer`), `preferences` (jsonb), `created_at` (timestamptz), `updated_at` (timestamptz).

#### Project
Namespace isolating applications, environments, or workloads within a tenant.
- **Fields:** `id` (UUIDv7, PK), `tenant_id` (FK -> Tenant), `name` (varchar), `slug` (varchar), `description` (text), `settings` (jsonb), `status` (`active`, `archived`), `created_at` (timestamptz), `updated_at` (timestamptz).

#### APIKey
Developer authentication token for unified API ingestion. Raw tokens are never stored.
- **Fields:** `id` (UUIDv7, PK), `tenant_id` (FK -> Tenant), `project_id` (FK -> Project), `name` (varchar), `key_hash` (varchar, unique), `prefix` (varchar, 8 chars for identification), `status` (`active`, `revoked`, `expired`), `scopes` (jsonb array), `last_used_at` (timestamptz), `expires_at` (timestamptz, nullable), `created_at` (timestamptz), `revoked_at` (timestamptz, nullable).

---

### 4.2 Task System

#### Task
The authoritative, durable business request submitted by a client.
- **Fields:**
  - `id` (UUIDv7, PK)
  - `tenant_id` (FK -> Tenant)
  - `project_id` (FK -> Project)
  - `external_id` (varchar, nullable, client idempotency/tracking reference)
  - `title` (varchar)
  - `description` (text)
  - `intent` (varchar)
  - `task_type` (varchar: `generation`, `reasoning`, `coding`, `vision`, `audio`, `documents`, `rag`, `agentic`)
  - `status` (`pending`, `analyzing`, `planning`, `ready`, `running`, `waiting`, `validating`, `completed`, `failed`, `cancelled`, `paused`)
  - `priority` (integer, default 0)
  - `complexity_score` (numeric(3,2), range 0.00-1.00)
  - `quality_floor` (numeric(3,2), range 0.00-1.00)
  - `parent_task_id` (FK -> Task, nullable, for sub-tasks)
  - `current_plan_id` (UUIDv7, nullable)
  - `current_step_id` (UUIDv7, nullable)
  - `created_by` (varchar / User ID)
  - `metadata` (jsonb)
  - `created_at`, `started_at`, `completed_at`, `failed_at`, `deleted_at` (timestamptz)

#### TaskInput
References large payloads and external files via content hashes and artifacts.
- **Fields:** `id` (UUIDv7, PK), `task_id` (FK -> Task), `type` (varchar: `document`, `image`, `text`, `audio`, `structured`), `name` (varchar), `content_ref` (varchar, URI/pointer), `artifact_id` (UUIDv7, nullable), `mime_type` (varchar), `size_bytes` (bigint), `hash` (varchar, SHA-256), `metadata` (jsonb), `created_at` (timestamptz).

#### TaskOutput
Formal expected output definition and completion references.
- **Fields:** `id` (UUIDv7, PK), `task_id` (FK -> Task), `type` (varchar: `text`, `json`, `code`, `artifact`), `name` (varchar), `artifact_id` (UUIDv7, nullable), `schema` (jsonb, JSON Schema if structured), `status` (`pending`, `produced`, `verified`, `failed`), `created_at` (timestamptz).

#### TaskRequirement
Decomposed technical capabilities and constraints extracted during Task Understanding.
- **Fields:** `id` (UUIDv7, PK), `task_id` (FK -> Task), `category` (varchar: `capability`, `language`, `context_length`, `modality`), `key` (varchar: e.g. `OCR`, `ar-EG`, `math_solver`), `value` (jsonb), `required` (boolean, default true), `priority` (integer), `source` (`client`, `inferred`), `confidence` (numeric(3,2)), `created_at` (timestamptz).

#### TaskPolicy
Execution boundary rules and economic constraints for the task.
- **Fields:**
  - `id` (UUIDv7, PK)
  - `task_id` (FK -> Task, unique)
  - `budget_mode` (`free_only`, `capped_paid`, `unconstrained`)
  - `max_cost` (numeric(10,4), micro-cent precision, default 0)
  - `quality_target` (numeric(3,2))
  - `latency_target` (`fast`, `medium`, `batch`)
  - `allow_paid` (boolean, default false - ADR-007)
  - `allow_multi_model` (boolean, default true)
  - `allow_parallel` (boolean, default true)
  - `privacy_level` (`public`, `internal`, `confidential`, `air_gapped`)
  - `preferred_providers` (jsonb array)
  - `blocked_providers` (jsonb array)
  - `max_attempts` (integer, default 3)
  - `max_duration_seconds` (integer)
  - `data_retention_policy` (jsonb)
  - `created_at` (timestamptz)

#### TaskState
Fast-path operational snapshot cache of the active task.
- **Fields:** `task_id` (UUIDv7, PK, FK -> Task), `status` (varchar), `current_step_id` (UUIDv7), `progress` (numeric(3,2)), `completed_steps` (integer), `pending_steps` (integer), `failed_steps` (integer), `active_attempts` (integer), `last_checkpoint_id` (UUIDv7), `updated_at` (timestamptz).

#### TaskDependency
Relational dependencies between top-level tasks.
- **Fields:** `id` (UUIDv7, PK), `task_id` (FK -> Task), `depends_on_task_id` (FK -> Task), `dependency_type` (`blocks`, `relies_on_output`), `created_at` (timestamptz).

---

### 4.3 Planning Domain

#### ExecutionPlan
The generated Directed Acyclic Graph (DAG) strategy for solving the task.
- **Fields:** `id` (UUIDv7, PK), `task_id` (FK -> Task), `version` (integer), `status` (`draft`, `validated`, `active`, `superseded`, `aborted`), `strategy_id` (FK -> Strategy), `planner_version` (varchar), `input_snapshot` (jsonb), `quality_estimate` (numeric(3,2)), `latency_estimate_ms` (integer), `cost_estimate` (numeric(10,4)), `created_at`, `validated_at`, `activated_at` (timestamptz).

#### PlanRevision
Immutable audit record whenever a plan is superseded (e.g. replanning on failure).
- **Fields:** `id` (UUIDv7, PK), `plan_id` (FK -> ExecutionPlan), `revision_number` (integer), `reason` (text: e.g. `provider_exhausted`, `validation_failure`), `previous_plan_id` (UUIDv7), `created_by` (varchar), `created_at` (timestamptz).

#### PlanStep
An individual node in the execution DAG.
- **Fields:**
  - `id` (UUIDv7, PK)
  - `plan_id` (FK -> ExecutionPlan)
  - `step_key` (varchar, unique within plan, e.g. `ocr_step`, `solve_step`)
  - `name` (varchar)
  - `description` (text)
  - `step_type` (`model_inference`, `tool_call`, `retrieval`, `transcription`, `embedding`, `validation`, `aggregation`, `synthesis`, `human_review`, `transform`, `wait`)
  - `status` (`pending`, `ready`, `running`, `completed`, `failed`, `skipped`)
  - `order_index` (integer)
  - `required_capability` (varchar)
  - `input_schema` (jsonb)
  - `output_schema` (jsonb)
  - `assigned_resource_id` (UUIDv7, nullable)
  - `assigned_model_id` (UUIDv7, nullable)
  - `parallel_group` (varchar, nullable)
  - `retry_policy` (jsonb)
  - `timeout_ms` (integer)
  - `quality_target` (numeric(3,2))
  - `created_at` (timestamptz)

#### StepDependency
Edges of the DAG defining sequential and data flow constraints.
- **Fields:** `id` (UUIDv7, PK), `plan_step_id` (FK -> PlanStep), `depends_on_step_id` (FK -> PlanStep), `dependency_type` (`completion`, `data_artifact`, `conditional`), `condition` (jsonb, nullable), `created_at` (timestamptz).

#### Strategy
The archetype used to formulate the plan.
- **Fields:** `id` (UUIDv7, PK), `name` (varchar: `single_model`, `specialist_pipeline`, `parallel_consensus`, `progressive_escalation`, `cheap_then_verify`, `multi_agent`), `version` (integer), `description` (text), `constraints` (jsonb), `parameters` (jsonb), `status` (`active`, `deprecated`), `created_at` (timestamptz).

#### PlanDecision
Structured log of planner choices providing explainability and auditability.
- **Fields:** `id` (UUIDv7, PK), `plan_id` (FK -> ExecutionPlan), `decision_type` (varchar: `strategy_selection`, `resource_assignment`, `fallback_choice`), `selected_option` (varchar), `alternatives` (jsonb array), `reasons` (jsonb array), `constraints_considered` (jsonb), `confidence` (numeric(3,2)), `created_at` (timestamptz).

---

### 4.4 Execution Domain

#### Execution
Represents an instance of executing an ExecutionPlan.
- **Fields:** `id` (UUIDv7, PK), `task_id` (FK -> Task), `plan_id` (FK -> ExecutionPlan), `status` (`running`, `completed`, `failed`, `cancelled`), `started_at`, `completed_at` (timestamptz), `current_step_id` (UUIDv7), `total_cost` (numeric(10,4)), `total_input_tokens` (integer), `total_output_tokens` (integer), `failure_count` (integer), `retry_count` (integer), `created_at`, `updated_at` (timestamptz).

#### StepExecution
Tracks the operational execution lifecycle of a single `PlanStep` (authoritative work queue item - ADR-094).
- **Fields:** `id` (UUIDv7, PK), `execution_id` (FK -> Execution), `plan_step_id` (FK -> PlanStep), `status` (`pending`, `running`, `validating`, `completed`, `failed`, `migrating`), `resource_id` (UUIDv7), `model_id` (UUIDv7), `worker_id` (UUIDv7, nullable), `lease_token` (varchar, nullable), `lease_expires_at` (timestamptz, nullable), `fencing_token` (bigint, monotonic, default 0), `priority` (integer, default 0), `available_at` (timestamptz), `started_at`, `completed_at` (timestamptz), `input_tokens` (integer), `output_tokens` (integer), `latency_ms` (integer), `quality_score` (numeric(3,2)), `created_at`, `updated_at` (timestamptz).

#### ExecutionAttempt
The transient, disposable invocation of an external worker or model instance.
- **Fields:**
  - `id` (UUIDv7, PK)
  - `step_execution_id` (FK -> StepExecution)
  - `attempt_number` (integer, starts at 1)
  - `resource_id` (FK -> Resource)
  - `provider_id` (FK -> Provider)
  - `model_id` (FK -> Model)
  - `status` (`running`, `success`, `failed`, `timeout`, `unknown`, `quota_exhausted`)
  - `request_ref` (varchar, pointer to sanitized input payload)
  - `response_ref` (varchar, pointer to raw response storage)
  - `input_tokens` (integer)
  - `output_tokens` (integer)
  - `latency_ms` (integer)
  - `error_id` (UUIDv7, nullable)
  - `started_at`, `completed_at` (timestamptz)

#### ExecutionError
Normalized error capture terminating provider idiosyncrasies at the adapter boundary.
- **Fields:** `id` (UUIDv7, PK), `execution_id` (FK -> Execution), `step_execution_id` (FK -> StepExecution), `attempt_id` (FK -> ExecutionAttempt), `category` (`authentication`, `rate_limit`, `quota`, `timeout`, `network`, `context`, `capability`, `invalid_output`, `provider_error`, `validation`, `unknown`), `code` (varchar), `provider_code` (varchar, native code e.g. `RESOURCE_EXHAUSTED`), `message` (text), `retryable` (boolean), `migratable` (boolean), `details` (jsonb), `occurred_at` (timestamptz).

#### Checkpoint
Durable state freeze enabling zero-loss resume upon failure or migration.
- **Fields:** `id` (UUIDv7, PK), `task_id` (FK -> Task), `execution_id` (FK -> Execution), `step_execution_id` (FK -> StepExecution), `sequence` (integer), `state_snapshot` (jsonb), `completed_steps` (jsonb array), `pending_steps` (jsonb array), `artifact_refs` (jsonb array), `resource_state` (jsonb), `created_at` (timestamptz).

#### Handoff
Structured handoff record between models.
- **Fields:** `id` (UUIDv7, PK), `task_id` (FK -> Task), `execution_id` (FK -> Execution), `step_execution_id` (FK -> StepExecution), `from_resource_id` (UUIDv7), `to_resource_id` (UUIDv7), `reason` (varchar: `quota_migration`, `specialist_pipeline`, `escalation`), `handoff_package_artifact_id` (UUIDv7, FK -> Artifact), `created_at` (timestamptz).

#### SideEffectReceipt (ADR-096)
Durable idempotency receipt guaranteeing non-generative external mutations (emails, webhooks, payments) are never executed twice.
- **Fields:** `id` (UUIDv7, PK), `effect_key` (varchar, unique), `task_id` (FK -> Task), `execution_id` (FK -> Execution), `step_execution_id` (FK -> StepExecution), `mutation_type` (varchar), `payload_hash` (varchar), `external_transaction_id` (varchar, nullable), `status` (`executed`, `confirmed_duplicate`, `failed`), `response_digest` (jsonb), `executed_at`, `created_at` (timestamptz).

---

### 4.5 Artifact System

#### Artifact
First-class, immutable, content-addressed output or input.
- **Fields:**
  - `id` (UUIDv7, PK)
  - `tenant_id` (FK -> Tenant)
  - `project_id` (FK -> Project)
  - `task_id` (FK -> Task)
  - `type` (varchar: `document`, `image`, `json`, `text`, `code`, `audio`, `video`, `validation_report`, `handoff_package`)
  - `name` (varchar)
  - `storage_uri` (varchar, e.g. `artifact://task/uuid/name.json` or `s3://...`)
  - `mime_type` (varchar)
  - `size_bytes` (bigint)
  - `hash` (varchar, SHA-256 content hash)
  - `schema` (jsonb, nullable)
  - `producer_type` (`task_input`, `model_attempt`, `tool`, `validator`, `human`)
  - `producer_id` (varchar / UUIDv7)
  - `status` (`pending`, `persisted`, `verified`, `corrupted`, `archived`)
  - `created_at` (timestamptz)

#### ArtifactVersion
Immutable version tracking for mutated artifacts.
- **Fields:** `id` (UUIDv7, PK), `artifact_id` (FK -> Artifact), `version` (integer), `storage_uri` (varchar), `hash` (varchar), `size_bytes` (bigint), `created_by` (varchar), `created_at` (timestamptz).

#### ArtifactRelation
Graph of artifact lineage and dependencies.
- **Fields:** `id` (UUIDv7, PK), `source_artifact_id` (FK -> Artifact), `target_artifact_id` (FK -> Artifact), `relation_type` (`derived_from`, `validated_by`, `contains`, `references`, `supersedes`, `generated_from`), `created_at` (timestamptz).

#### ArtifactValidation
Links an artifact directly to a verified validation outcome.
- **Fields:** `id` (UUIDv7, PK), `artifact_id` (FK -> Artifact), `validation_id` (UUIDv7), `status` (`verified`, `failed`), `confidence` (numeric(3,2)), `created_at` (timestamptz).

---

### 4.6 AI Ecosystem & Catalog

#### Provider
External AI company or execution platform.
- **Fields:** `id` (UUIDv7, PK), `name` (varchar), `slug` (varchar, unique, e.g. `google`, `groq`, `mistral`, `openrouter`), `type` (`direct`, `aggregator`, `local`, `self_hosted`), `api_base_url` (varchar), `documentation_url` (varchar), `status` (`active`, `degraded`, `inactive`), `metadata` (jsonb), `created_at`, `updated_at` (timestamptz).

#### Model
Canonical logical foundation model.
- **Fields:** `id` (UUIDv7, PK), `provider_id` (FK -> Provider), `name` (varchar, e.g. `gemini-1.5-flash`), `slug` (varchar, unique), `family` (varchar: `gemini`, `llama`, `mistral`), `description` (text), `status` (`active`, `deprecated`, `retired`), `model_metadata` (jsonb), `created_at`, `updated_at` (timestamptz).

#### ModelVersion
Tracks backend revisions and lifecycle dates.
- **Fields:** `id` (UUIDv7, PK), `model_id` (FK -> Model), `version_identifier` (varchar: e.g. `001`, `002`), `released_at`, `deprecated_at` (timestamptz, nullable), `context_limit` (integer), `max_output_tokens` (integer), `metadata` (jsonb), `created_at` (timestamptz).

#### Capability
Taxonomy of capabilities supported across the engine.
- **Fields:** `id` (UUIDv7, PK), `name` (varchar), `slug` (varchar, unique: e.g. `reasoning`, `coding`, `vision`, `ocr`, `audio_understanding`, `tool_calling`, `structured_output`), `category` (varchar: `intelligence`, `vision`, `audio`, `video`, `documents`, `rag`, `agentic`), `description` (text), `version` (integer), `created_at` (timestamptz).

#### ModelCapability
M:N mapping between models and evaluated capability scores.
- **Fields:** `model_id` (FK -> Model), `capability_id` (FK -> Capability), `support_level` (`native`, `supported`, `limited`, `unknown`), `score` (numeric(3,2)), `confidence` (numeric(3,2)), `evidence_count` (integer), `last_evaluated_at` (timestamptz), PK(`model_id`, `capability_id`).

---

### 4.7 Resource Intelligence

#### Resource
The concrete runtime execution unit representing `(Provider, Model, Credential)`.
- **Fields:**
  - `id` (UUIDv7, PK)
  - `tenant_id` (FK -> Tenant, nullable - null = platform-owned resource, populated = BYO-key tenant resource)
  - `provider_id` (FK -> Provider)
  - `model_id` (FK -> Model)
  - `model_version_id` (FK -> ModelVersion, nullable)
  - `credential_id` (FK -> Credential)
  - `status` (`active`, `draining`, `disabled`, `rate_limited`)
  - `region` (varchar, default `global`)
  - `endpoint` (varchar, custom URL if self-hosted or proxy)
  - `priority` (integer, default 0)
  - `created_at`, `updated_at` (timestamptz)

#### Credential
Isolated secret reference. Actual secrets are kept in a KMS / Vault, never in plaintext.
- **Fields:** `id` (UUIDv7, PK), `tenant_id` (FK -> Tenant, nullable), `provider_id` (FK -> Provider), `name` (varchar), `secret_reference` (varchar, KMS key ARN or Vault pointer), `credential_type` (`api_key`, `oauth2`, `service_account`), `status` (`active`, `revoked`, `expired`), `created_at`, `last_validated_at`, `revoked_at` (timestamptz).

#### ResourceCapability
Captures runtime variance where an individual resource instance limits a model's capabilities.
- **Fields:** `resource_id` (FK -> Resource), `capability_id` (FK -> Capability), `enabled` (boolean), `limitations` (jsonb), `created_at` (timestamptz), PK(`resource_id`, `capability_id`).

#### ResourceQuota
Runtime tracking of remaining quotas and limits.
- **Fields:** `id` (UUIDv7, PK), `resource_id` (FK -> Resource), `quota_type` (`requests`, `tokens`, `input_tokens`, `output_tokens`, `audio_seconds`, `concurrency`), `limit_value` (bigint), `remaining_value` (bigint), `unit` (varchar), `window_type` (`minute`, `day`, `month`, `sliding`), `window_start`, `window_end`, `reset_at` (timestamptz), `confidence` (numeric(3,2)), `observed_at` (timestamptz).

#### ResourceUsage
Detailed accounting log of token and request consumption.
- **Fields:** `id` (UUIDv7, PK), `resource_id` (FK -> Resource), `task_id` (FK -> Task), `execution_id` (FK -> Execution), `attempt_id` (FK -> ExecutionAttempt), `metric` (varchar: `input_tokens`, `output_tokens`, `requests`), `amount` (bigint), `timestamp` (timestamptz).

#### ResourceHealth
Real-time latency, error rates, and circuit breaker metrics.
- **Fields:** `id` (UUIDv7, PK), `resource_id` (FK -> Resource, unique), `status` (`healthy`, `degraded`, `circuit_open`, `half_open`), `latency_p50` (integer), `latency_p95` (integer), `error_rate` (numeric(4,3)), `timeout_rate` (numeric(4,3)), `rate_limit_rate` (numeric(4,3)), `success_rate` (numeric(4,3)), `observed_at` (timestamptz).

#### ResourceHealthEvent
Immutable log of state transitions within the circuit breaker.
- **Fields:** `id` (UUIDv7, PK), `resource_id` (FK -> Resource), `previous_status` (varchar), `new_status` (varchar), `reason` (varchar), `metrics` (jsonb), `created_at` (timestamptz).

#### ResourceReservation
Logical pre-allocation to prevent concurrent tasks from exhausting resources.
- **Fields:** `id` (UUIDv7, PK), `resource_id` (FK -> Resource), `task_id` (FK -> Task), `step_id` (UUIDv7), `estimated_requests` (integer), `estimated_tokens` (integer), `status` (`reserved`, `released`, `consumed`, `expired`), `expires_at`, `created_at` (timestamptz).

---

### 4.8 Truth & Validation Domain

#### Validation
The formal validation process decoupling generation from truth.
- **Fields:** `id` (UUIDv7, PK), `task_id` (FK -> Task), `execution_id` (FK -> Execution), `step_execution_id` (FK -> StepExecution), `target_type` (`artifact`, `claim`, `step_output`), `target_id` (UUIDv7), `validator_type` (`deterministic`, `execution`, `math_solver`, `independent_model`, `human`), `status` (`pending`, `passed`, `failed`, `disputed`), `confidence` (numeric(3,2)), `started_at`, `completed_at`, `created_at` (timestamptz).

#### ValidationRule
Reusable deterministic verification definitions.
- **Fields:** `id` (UUIDv7, PK), `name` (varchar), `type` (`json_schema`, `regex`, `compiler`, `test_suite`, `range_check`), `definition` (jsonb), `version` (integer), `severity` (`blocking`, `warning`), `created_at` (timestamptz).

#### ValidationResult
Outcome of running a single rule against a target.
- **Fields:** `id` (UUIDv7, PK), `validation_id` (FK -> Validation), `rule_id` (FK -> ValidationRule), `status` (`pass`, `fail`, `inconclusive`), `score` (numeric(3,2)), `confidence` (numeric(3,2)), `details` (jsonb), `evidence_refs` (jsonb array), `created_at` (timestamptz).

#### Claim
Structured atomic assertion extracted from model outputs.
- **Fields:** `id` (UUIDv7, PK), `task_id` (FK -> Task), `artifact_id` (FK -> Artifact), `text` (text), `claim_type` (`fact`, `inference`, `prediction`, `model_claim`, `user_claim`), `source_type` (`model`, `user`, `system`), `source_id` (varchar), `confidence` (numeric(3,2)), `status` (`unverified`, `supported`, `verified`, `disputed`, `rejected`), `created_at` (timestamptz).

#### Evidence
Verifiable backing data supporting or refuting a claim.
- **Fields:** `id` (UUIDv7, PK), `claim_id` (FK -> Claim), `type` (`source`, `calculation`, `test`, `benchmark`, `image_region`, `document_region`, `model_output`, `human_review`), `artifact_id` (FK -> Artifact), `location` (varchar, e.g. JSON path, page/bbox), `excerpt_ref` (text), `strength` (numeric(3,2)), `created_at` (timestamptz).

#### Dispute
Structured conflict record when models or validators produce contradictory claims.
- **Fields:** `id` (UUIDv7, PK), `task_id` (FK -> Task), `subject_type` (varchar), `subject_id` (varchar), `status` (`open`, `resolved`, `escalated`), `created_at`, `resolved_at` (timestamptz).

#### DisputePosition
The respective competing claims in a dispute.
- **Fields:** `id` (UUIDv7, PK), `dispute_id` (FK -> Dispute), `source_type` (varchar), `source_id` (varchar), `claim` (text), `evidence_refs` (jsonb array), `confidence` (numeric(3,2)), `created_at` (timestamptz).

#### Resolution
The conclusive arbitration outcome based on evidence.
- **Fields:** `id` (UUIDv7, PK), `dispute_id` (FK -> Dispute), `decision` (text), `reasoning_summary` (text), `evidence_refs` (jsonb array), `confidence` (numeric(3,2)), `resolved_by` (`critic_model`, `deterministic_solver`, `human`), `created_at` (timestamptz).

---

### 4.9 Evaluation, Benchmarks & Reputation

#### Evaluation
High-level scoring of an execution across holistic dimensions.
- **Fields:** `id` (UUIDv7, PK), `task_id` (FK -> Task), `execution_id` (FK -> Execution), `evaluator_type` (`deterministic`, `benchmark`, `human`, `independent_model`, `system`), `status` (`completed`, `inconclusive`), `overall_score` (numeric(3,2)), `confidence` (numeric(3,2)), `created_at` (timestamptz).

#### EvaluationMetric
Individual metric breakdowns (correctness, format, latency, cost).
- **Fields:** `id` (UUIDv7, PK), `evaluation_id` (FK -> Evaluation), `metric` (varchar), `score` (numeric(3,2)), `weight` (numeric(3,2)), `evidence_refs` (jsonb array), `created_at` (timestamptz).

#### Benchmark & BenchmarkCase
Standardized test suite assets for empirical capability measurement.
- **Benchmark:** `id` (UUIDv7, PK), `name` (varchar), `slug` (varchar, unique), `version` (integer), `domain` (varchar), `description` (text), `status` (`active`, `archived`), `created_at` (timestamptz).
- **BenchmarkCase:** `id` (UUIDv7, PK), `benchmark_id` (FK -> Benchmark), `name` (varchar), `difficulty` (numeric(3,2)), `input_artifact_id` (UUIDv7), `expected_output_artifact_id` (UUIDv7), `validation_strategy` (varchar), `metadata` (jsonb), `created_at` (timestamptz).

#### BenchmarkRun & BenchmarkResult
Execution traces and scores for benchmark runs.
- **BenchmarkRun:** `id` (UUIDv7, PK), `benchmark_id` (FK -> Benchmark), `model_id` (FK -> Model), `resource_id` (FK -> Resource), `version` (integer), `status` (`running`, `completed`, `failed`), `started_at`, `completed_at` (timestamptz).
- **BenchmarkResult:** `id` (UUIDv7, PK), `benchmark_run_id` (FK -> BenchmarkRun), `benchmark_case_id` (FK -> BenchmarkCase), `output_artifact_id` (UUIDv7), `score` (numeric(3,2)), `confidence` (numeric(3,2)), `latency_ms` (integer), `input_tokens` (integer), `output_tokens` (integer), `validation_id` (UUIDv7), `created_at` (timestamptz).

#### Reputation System
- **ReputationProfile:** `id` (UUIDv7, PK), `subject_type` (`model`, `model_version`, `resource`), `subject_id` (UUIDv7), `version` (integer), `overall_score` (numeric(3,2)), `confidence` (numeric(3,2)), `sample_size` (integer), `last_updated_at` (timestamptz).
- **ReputationScore:** `id` (UUIDv7, PK), `profile_id` (FK -> ReputationProfile), `dimension` (varchar: `reasoning`, `coding`, `arabic`, `ocr`, `vision`), `task_subtype` (varchar), `score` (numeric(3,2)), `confidence` (numeric(3,2)), `sample_size` (integer), `decay_factor` (numeric(4,3)), `updated_at` (timestamptz).
- **ReputationEvidence:** `id` (UUIDv7, PK), `reputation_score_id` (FK -> ReputationScore), `source_type` (`official_benchmark`, `internal_benchmark`, `production_validation`, `human_feedback`), `source_id` (UUIDv7), `weight` (numeric(3,2)), `contribution` (numeric(3,2)), `created_at` (timestamptz).
- **ReputationSnapshot:** `id` (UUIDv7, PK), `subject_type` (varchar), `subject_id` (UUIDv7), `scores` (jsonb), `created_at` (timestamptz).

---

### 4.10 System, Observability & Policies

#### Event (Immutable Event Store)
Authoritative, append-only historical log of domain facts.
- **Fields:** `id` (UUIDv7, PK), `tenant_id` (UUIDv7, nullable), `project_id` (UUIDv7, nullable), `event_type` (varchar), `aggregate_type` (varchar), `aggregate_id` (UUIDv7), `payload` (jsonb), `actor_type` (`system`, `user`, `worker`, `provider`), `actor_id` (varchar), `correlation_id` (UUIDv7), `causation_id` (UUIDv7), `created_at` (timestamptz).

#### OutboxEvent (ADR-095)
Transactional delivery queue buffer for publishing domain events to asynchronous subscribers.
- **Fields:** `id` (UUIDv7, PK), `event_id` (FK -> Event), `event_type` (varchar), `aggregate_type` (varchar), `aggregate_id` (UUIDv7), `payload` (jsonb), `headers` (jsonb), `published_at` (timestamptz, nullable), `retry_count` (integer), `last_error` (text), `created_at` (timestamptz).

#### EventConsumption (ADR-036 / ADR-095)
Consumer deduplication ledger guaranteeing idempotent event consumption.
- **Fields:** `consumer_name` (varchar), `event_id` (UUIDv7), `processed_at` (timestamptz). (PK: consumer_name, event_id).

#### AuditLog
Security and administrative compliance log.
- **Fields:** `id` (UUIDv7, PK), `tenant_id` (FK -> Tenant), `actor_id` (varchar), `action` (varchar), `resource_type` (varchar), `resource_id` (varchar), `before` (jsonb), `after` (jsonb), `ip_hash` (varchar), `user_agent_hash` (varchar), `created_at` (timestamptz).

#### Policy & FeatureFlag
- **Policy:** `id` (UUIDv7, PK), `tenant_id` (FK -> Tenant), `project_id` (FK -> Project), `name` (varchar), `type` (`budget`, `provider`, `privacy`, `execution`, `retention`), `rules` (jsonb), `priority` (integer), `status` (`active`, `disabled`), `created_at`, `updated_at` (timestamptz).
- **FeatureFlag:** `id` (UUIDv7, PK), `key` (varchar, unique), `description` (text), `default_value` (boolean), `rules` (jsonb), `status` (`active`, `disabled`), `created_at`, `updated_at` (timestamptz).

---

## 5. Foreign Key & Relational Topology

```text
Tenant (id)
 ├── User (tenant_id)
 ├── Project (tenant_id)
 │    ├── APIKey (project_id)
 │    └── Task (project_id)
 │         ├── TaskInput (task_id)
 │         ├── TaskOutput (task_id)
 │         ├── TaskRequirement (task_id)
 │         ├── TaskPolicy (task_id)
 │         ├── ExecutionPlan (task_id)
 │         │    ├── PlanRevision (plan_id)
 │         │    ├── PlanStep (plan_id)
 │         │    │    └── StepDependency (plan_step_id -> depends_on_step_id)
 │         │    └── PlanDecision (plan_id)
 │         ├── Execution (task_id)
 │         │    └── StepExecution (execution_id, plan_step_id)
 │         │         ├── ExecutionAttempt (step_execution_id)
 │         │         │    └── ExecutionError (attempt_id)
 │         │         ├── Checkpoint (execution_id, step_execution_id)
 │         │         └── Handoff (step_execution_id)
 │         ├── Artifact (task_id)
 │         │    ├── ArtifactVersion (artifact_id)
 │         │    ├── ArtifactRelation (source_id -> target_id)
 │         │    └── ArtifactValidation (artifact_id)
 │         └── Validation (task_id)
 │              ├── ValidationResult (validation_id, rule_id)
 │              └── Claim (task_id)
 │                   └── Evidence (claim_id)
 │                        └── Dispute (task_id) -> Resolution (dispute_id)
 └── Credential (tenant_id)
      └── Resource (credential_id, provider_id, model_id)
           ├── ResourceCapability (resource_id)
           ├── ResourceQuota (resource_id)
           ├── ResourceUsage (resource_id)
           ├── ResourceHealth (resource_id)
           └── ResourceReservation (resource_id)
```

---

## 6. PostgreSQL Logical Schemas (ADR-018)

To enforce clean domain boundaries within a single PostgreSQL database, the model maps directly to 10 logical schemas:

| Schema Name | Owned Entities |
| :--- | :--- |
| `identity` | `tenants`, `users`, `projects`, `api_keys` |
| `tasks` | `tasks`, `task_inputs`, `task_outputs`, `task_requirements`, `task_policies`, `task_states`, `task_dependencies`, `task_tags` |
| `planning` | `execution_plans`, `plan_revisions`, `plan_steps`, `step_dependencies`, `strategies`, `plan_decisions` |
| `execution` | `executions`, `step_executions`, `execution_attempts`, `execution_errors`, `checkpoints`, `handoffs`, `side_effect_receipts` |
| `artifacts` | `artifacts`, `artifact_versions`, `artifact_relations`, `artifact_validations` |
| `ai` | `providers`, `models`, `model_versions`, `capabilities`, `model_capabilities` |
| `resources` | `resources`, `credentials`, `resource_capabilities`, `resource_quotas`, `resource_usages`, `resource_health`, `resource_health_events`, `resource_reservations` |
| `validation` | `validations`, `validation_rules`, `validation_results`, `claims`, `evidences`, `disputes`, `dispute_positions`, `resolutions` |
| `evaluation` | `evaluations`, `evaluation_metrics`, `benchmarks`, `benchmark_cases`, `benchmark_runs`, `benchmark_results` |
| `reputation` | `reputation_profiles`, `reputation_scores`, `reputation_evidences`, `reputation_snapshots` |
| `system` | `events`, `outbox_events`, `event_consumptions`, `audit_logs`, `policies`, `idempotency_keys`, `feature_flags` |

---

## 7. Data Integrity Invariants

The following 10 invariants must be strictly enforced at the database and application levels:

1. **StepExecution Integrity:** A `StepExecution` cannot exist without an authoritative `PlanStep`.
2. **ExecutionAttempt Integrity:** An `ExecutionAttempt` cannot exist without an active `StepExecution`.
3. **DAG Self-Dependency:** A `PlanStep` cannot depend on itself.
4. **DAG Acyclicity:** The plan graph formed by `PlanStep` and `StepDependency` must be strictly acyclic (checked before activation).
5. **Task Completion Gate:** A `Task` cannot transition to `completed` unless all required `TaskOutputs` are produced and verified by applicable `ValidationRules`.
6. **Claim Verification Gate:** A `Claim` cannot transition to `verified` without valid, non-empty supporting `Evidence` or passing `ValidationResult`.
7. **Resource Health Freshness:** A `ResourceHealth` record cannot claim `healthy` status if the observation age exceeds the configured freshness window without an active canary probe.
8. **Side Effect Idempotency (ADR-096):** A `SideEffectReceipt` record enforces database-level uniqueness on `effect_key`. Re-executing mutations with the same key must return the existing receipt without duplicate external execution.
9. **Monotonic Fencing Tokens (ADR-039 / ADR-082):** Updates to `execution.step_executions` require `WHERE fencing_token = :worker_token`. Stale or zombie worker writes are rejected with 0 rows affected.
10. **Outbox Event Decoupling (ADR-095):** Ephemeral delivery records exist in `system.outbox_events` and may be safely pruned upon successful dispatch, while `system.events` remains an immutable historical fact log.

---

## 8. Minimal MVP Entity Set vs. Deferred Entities

To prevent over-engineering in early iterations while maintaining strict architectural compatibility:

### 8.1 Phase 1 (MVP Critical Entities)
- **Identity:** `Tenant`, `Project`, `APIKey`
- **Tasks:** `Task`, `TaskInput`, `TaskOutput`, `TaskPolicy`
- **Planning:** `ExecutionPlan`, `PlanStep`, `StepDependency`
- **Execution:** `Execution`, `StepExecution`, `ExecutionAttempt`, `ExecutionError`, `Checkpoint`
- **Artifacts:** `Artifact`
- **AI Ecosystem:** `Provider`, `Model`, `Capability`, `ModelCapability`
- **Resources:** `Resource`, `Credential`, `ResourceQuota`, `ResourceHealth`
- **Validation:** `Validation`, `ValidationResult`
- **System:** `Event` (Outbox)

### 8.2 Phase 2 (Deferred Post-MVP Entities)
- `Benchmark`, `BenchmarkCase`, `BenchmarkRun`, `BenchmarkResult`
- `ReputationProfile`, `ReputationScore`, `ReputationEvidence`, `ReputationSnapshot`
- `Claim`, `Evidence`, `Dispute`, `Resolution`
- `Evaluation`, `EvaluationMetric`
- `FeatureFlag`, `AuditLog`
- `ResourceReservation`, `ResourceHealthEvent`

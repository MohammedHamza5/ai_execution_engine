# AI Execution Engine — Provider Adapter Contract Specification

**Document:** `PROVIDER_ADAPTER_CONTRACT.md`  
**Status:** COMPLETE (Provider Abstraction & Anti-Corruption Layer Baseline)  
**Version:** 1.0.0  
**Authority:** Derived from Provider Adapter Contract v1.0 Material  

---

## 1. Purpose

This document defines the strict, universal contract between the AI Execution Engine core and external AI providers or model backends (Google Gemini, Groq, Mistral, OpenRouter, self-hosted LLMs, etc.).

It guarantees that the Core Domain never depends on provider-specific REST APIs, SDK schemas, proprietary error codes, header formats, or authentication quirks.

### Core Architecture Principle
> **«Provider-specific complexity must terminate at the Adapter boundary.»**  
> Under no circumstances may proprietary provider types (e.g. `GoogleGenerativeAI`, `GroqChatCompletionRequest`) leak across the adapter boundary into the Planner, Scheduler, Execution Engine, or Validation Engine. The Adapter functions as a strict **Anti-Corruption Layer (ACL)**.

---

## 2. Responsibilities & Non-Responsibilities

### 2.1 Adapter Responsibilities
1. **Authentication & Secret Handling:** Ingests ephemeral, secure credential handles from the Credential Vault; never logs secrets.
2. **Request Translation:** Maps canonical `UnifiedRequest` to proprietary provider payloads (REST/SDK).
3. **Response Translation:** Maps raw provider outputs to standardized `UnifiedResponse`.
4. **Error Normalization:** Normalizes HTTP status codes and proprietary errors into the common 16-category taxonomy.
5. **Usage & Token Accounting:** Extracts and reports normalized input/output tokens, audio seconds, image units, and estimated costs.
6. **Rate-Limit & Quota Extraction:** Ingests response headers (RPM, TPM, reset times) into normalized `RateLimitSnapshot` objects.
7. **Streaming Translation:** Converts proprietary SSE / chunk streams into canonical `StreamEvent` deltas.
8. **Capability Honesty:** Explicitly reports native vs. simulated vs. unsupported capabilities.
9. **Localized Technical Retries:** Handles minor transport retries (e.g. TCP resets) without usurping strategic retry decisions.
10. **Provider Health & Signals:** Emits latency, connection, and error metrics back to Resource Intelligence.

### 2.2 Adapter Non-Responsibilities
The Adapter explicitly does **NOT** own or decide:
- Which model or resource to select for a task (Owned by Planner & Resource Intelligence).
- Whether to decompose a task into multiple models.
- Whether a generated response is truthful or acceptable (Owned by Truth & Validation Engine).
- Strategic retries, quota failovers, or provider migrations (Owned by Execution Engine).
- Waiting for quota resets or spending paid credits (Governed by Task Policy).

---

## 3. Core Provider Adapter Interface (ADR-055)

Adapters implement a modular suite of interfaces, preventing bloated monolithic classes:

```typescript
export interface ProviderAdapter {
  getProviderInfo(): ProviderInfo;
  healthCheck(): Promise<HealthStatus>;
  generate(request: UnifiedRequest): Promise<UnifiedResponse>;
  stream(request: UnifiedRequest, onEvent: (event: StreamEvent) => void): Promise<UnifiedStreamResult>;
  cancel(requestId: string): Promise<void>;
  normalizeError(error: unknown): NormalizedProviderError;
}

export interface ProviderModelCatalog {
  listModels(): Promise<ModelInfo[]>;
  getModel(modelId: string): Promise<ModelInfo>;
}

export interface ProviderCapabilityResolver {
  supports(capability: Capability): boolean;
  getCapabilitySupport(capability: Capability): CapabilitySupport;
}

export interface ProviderUsageReader {
  extractUsage(rawResponse: unknown): Usage;
}

export interface ProviderRateLimitReader {
  extractRateLimits(rawHeaders: Record<string, string>): RateLimitSnapshot;
}
```

---

## 4. Identity Models: Provider vs. Model vs. Resource

The system enforces strict distinction between infrastructure concepts:
- **Provider:** The organization or hosting platform (`providerId: "gemini"`, `"groq"`, `"mistral"`).
- **Model:** The logical foundation architecture (`modelId: "gemini-1.5-pro"`). Canonical ID: `gemini/gemini-1.5-pro`.
- **Credential:** The encrypted secret handle (`cred_01924b...`).
- **Resource Instance:** The concrete executable runtime tuple `(Provider, Model, Credential)`.

```typescript
export interface ProviderInfo {
  providerId: string;
  name: string;
  version: string;
  apiType: "REST" | "SDK" | "GRPC" | "CUSTOM";
  regions?: string[];
  capabilities: Capability[];
  supports: {
    streaming: boolean;
    structuredOutput: boolean;
    toolCalling: boolean;
    multimodal: boolean;
    embeddings: boolean;
    transcription: boolean;
  };
}

export interface ModelIdentity {
  providerId: string;
  modelId: string;
  canonicalId: string; // e.g. "google/gemini-1.5-flash"
  displayName?: string;
  family?: string;
  version?: string;
}
```

---

## 5. Unified Request Contract (ADR-056)

All AI invocations enter adapters via a standardized, provider-agnostic request envelope:

```typescript
export interface UnifiedRequest {
  requestId: string;
  taskId: string;
  stepId: string;
  attemptId: string;
  resourceId: string;
  model: ModelReference;
  input: InputPayload[];
  instructions?: Instruction[];
  output: OutputSpecification;
  generation?: GenerationParameters;
  tools?: ToolDefinition[];
  constraints?: ExecutionConstraints;
  metadata?: Record<string, unknown>;
}

export type InputPayload =
  | TextInput
  | ImageInput
  | AudioInput
  | VideoInput
  | DocumentInput
  | StructuredInput
  | ArtifactReference;

export interface ArtifactReference {
  artifactId: string;
  storageUri: string; // e.g. "artifact://task/9281/input/exam.pdf"
  mediaType: string;
  sizeBytes?: number;
  checksum?: string;
}
```

### 5.1 Output Specification & Structured Output Honesty (ADR-057)
The task defines the required output format, never the model:
```typescript
export interface OutputSpecification {
  type: "text" | "json" | "structured" | "embedding" | "classification" | "transcription" | "tool_calls";
  schema?: JSONSchema;
  format?: string;
  requiredFields?: string[];
  strict?: boolean;
}
```
> **Honesty Invariant:** If a provider does not natively support strict JSON schema enforcement, the adapter must declare `nativeStructuredOutput: false`. It must **never** simulate native support without informing the core. The Execution Engine decides whether to route to another provider, apply prompt guidance, or route output through a validation repair step.

---

## 6. Unified Response & Normalized Usage Contract

```typescript
export interface UnifiedResponse {
  requestId: string;
  status: "success" | "partial" | "failed" | "unknown";
  output?: OutputPayload;
  usage?: Usage;
  latency?: LatencyMetrics;
  finishReason?: FinishReason; // "completed" | "max_tokens" | "stop" | "tool_call" | "content_filter" | "cancelled" | "error"
  resource: ResourceReference;
  providerMetadata?: Record<string, unknown>; // Sanitized metadata only; no raw secrets
  warnings?: Warning[];
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  audioInputSeconds?: number;
  audioOutputSeconds?: number;
  imageUnits?: number;
  videoSeconds?: number;
  requests?: number;
  estimatedCost?: number;
  currency?: string;
}

export interface LatencyMetrics {
  queueWaitMs?: number;
  providerConnectionMs?: number;
  providerProcessingMs?: number;
  totalMs?: number;
}
```

---

## 7. Error Normalization Taxonomy (ADR-058)

All proprietary HTTP codes, SDK exceptions, and network drops are normalized into 16 canonical categories:

```typescript
export enum ProviderErrorCode {
  AUTHENTICATION,         // Invalid API key, revoked credentials (401)
  AUTHORIZATION,          // Insufficient scopes, project forbidden (403)
  INVALID_REQUEST,        // Malformed parameters, unparseable payload (400)
  MODEL_NOT_FOUND,        // Invalid model identifier (404)
  UNSUPPORTED_CAPABILITY, // Requested modality or parameter unsupported
  RATE_LIMIT,             // Requests/min exceeded (HTTP 429 transient)
  QUOTA_EXHAUSTED,        // Daily/monthly quota exhausted (HTTP 429 persistent)
  CONTEXT_TOO_LARGE,      // Prompt exceeds context window limit
  OUTPUT_LIMIT,           // Generation exceeded max output tokens
  CONTENT_FILTER,         // Safety / TOS moderation block
  TIMEOUT,                // Connection or read timeout exceeded
  NETWORK_ERROR,          // Socket drop, DNS failure, connection reset
  SERVER_ERROR,           // Upstream provider internal error (HTTP 500, 502, 503)
  SERVICE_UNAVAILABLE,    // Provider capacity outage (HTTP 503)
  INVALID_OUTPUT,         // Upstream returned unparseable or corrupted response
  UNKNOWN                 // Unclassified anomaly
}

export interface NormalizedProviderError {
  code: ProviderErrorCode;
  message: string;
  retryable: boolean;
  migrationRecommended: boolean;
  retryAfterMs?: number;
  quotaResetAt?: Date;
  providerCode?: string;      // Native provider code (e.g. "RESOURCE_EXHAUSTED")
  providerMessage?: string;   // Sanitized native message
  metadata?: Record<string, unknown>;
}
```

---

## 8. Rate Limits & Quota Contract

Adapters parse rate-limit headers into standard snapshots:

```typescript
export interface RateLimitSnapshot {
  requestsRemaining?: number;
  requestsLimit?: number;
  tokensRemaining?: number;
  tokensLimit?: number;
  resetAt?: Date;
  retryAfterMs?: number;
  concurrencyRemaining?: number;
  observedAt: Date;
  confidence: number;
}
```
If a provider omits rate-limit headers, the adapter reports `undefined` with `confidence: 0`. The system never invents numbers; Resource Intelligence computes conservative estimates based on historical usage and observed 429s.

---

## 9. Streaming & Tool Calling Contracts

### 9.1 Normalized Streaming Events
Streaming chunks are converted to strongly-typed event streams:
```typescript
export type StreamEvent =
  | { type: "stream_started"; requestId: string }
  | { type: "text_delta"; text: string; sequence: number }
  | { type: "tool_call_delta"; callId: string; argumentsDelta: string }
  | { type: "reasoning_delta"; reasoningText: string }
  | { type: "usage_update"; usage: Usage }
  | { type: "completed"; finishReason: FinishReason; usage?: Usage }
  | { type: "error"; error: NormalizedProviderError };
```

### 9.2 Tool Calling & Execution Isolation (ADR-059)
- **Security Boundary:** Adapters **never** execute tools.
- Adapters solely map tool declarations to provider schemas and parse raw responses into normalized `ToolCall` structures (`callId`, `toolName`, `arguments`).
- Tool execution is handled exclusively by the core **Tool Executor** in an isolated sandbox.
- Every tool invocation enforces an `effectKey` idempotency token.

---

## 10. Credential Isolation & Vault Contract (ADR-060)

Adapters never receive persistent API keys or database connection records:
```typescript
export interface CredentialProvider {
  getCredential(resourceId: string): Promise<CredentialHandle>;
}

export interface CredentialHandle {
  token: string;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}
```
- Credential tokens exist only in ephemeral memory during execution.
- Tokens are strictly barred from queue payloads, logs, error stacks, traces, and artifacts.

---

## 11. Testing, Simulation & Adapter Certification (ADR-061)

Every adapter must pass the standardized **Contract Test Suite** before certification:

```text
[ ] Provider Identity & Metadata Verification
[ ] Dynamic Model Discovery & Inspection
[ ] Capability Declaration & Honesty Checks
[ ] Text Generation Contract
[ ] Structured JSON Output Contract
[ ] Multimodal Input Handling (Images, Audio, Documents)
[ ] Streaming Event Sequencing & Completion
[ ] Tool Call Parsing & Schema Mapping
[ ] Token Usage Extraction & Accuracy
[ ] Rate Limit Header Ingestion
[ ] Error Normalization (16 Taxonomy Categories)
[ ] Timeout & Cancellation Adherence
[ ] Credential Isolation (Zero secret leakage in outputs/errors)
[ ] Health Check & Canary Probe Verification
```

### Failure Simulation
The test suite includes `FakeProviderAdapter` and `MockProviderAdapter` to deterministically simulate network drops, HTTP 429 quota exhaustion, partial streams, and malformed outputs without incurring live API costs.

---

## 12. Architectural Decision Log (ADR-055 to ADR-066)

- **ADR-055 (Decoupled Adapter Interfaces):** Segregates operations into distinct interfaces (`ProviderAdapter`, `ModelCatalog`, `UsageReader`, etc.) so adapters only implement capabilities their upstream providers actually support.
- **ADR-056 (Canonical Request Envelope):** Unified request structures isolate the engine from provider-specific payload idiosyncrasies.
- **ADR-057 (Output Specification Ownership):** The task authoritatively dictates output requirements, not the provider.
- **ADR-058 (16-Category Error Normalization):** Upstream provider errors terminate at adapter boundaries into canonical enum values.
- **ADR-059 (Tool Execution Isolation):** Adapters translate tool definitions and output calls; they never execute tools directly.
- **ADR-060 (KMS Vault Ephemeral Credentials):** Adapters receive ephemeral credentials from the vault; secrets are barred from payloads and logs.
- **ADR-061 (Universal Contract Test Certification):** Adapters must pass an identical automated contract test suite before transitioning to `ACTIVE`.
- **ADR-062 (Adapter Versioning):** Every execution records `adapter_version` alongside model ID for historical failure explainability.
- **ADR-063 (Dynamic Provider Kill Switch):** Providers can be disabled instantly via database/policy flags without code deployment.
- **ADR-064 (Restricted Local Retries):** Adapters may only perform limited localized retries for minor socket drops; strategic retries and migrations belong strictly to the core.
- **ADR-065 (Clean Anti-Corruption Boundaries):** No proprietary provider SDK types may cross into the Core Domain.
- **ADR-066 (Sanitized Observability):** Trace logs capture token counts, latencies, and request hashes; raw prompts and responses are omitted by default for privacy and security.

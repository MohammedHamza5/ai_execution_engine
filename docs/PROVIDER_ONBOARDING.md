# AI-Execution-Engine — Provider Onboarding Specification (Task M4.11)
## Standard Operating Procedure for AI Inference Provider Integration

**Document Version:** 1.0.0  
**Status:** RATIFIED CANONICAL SPECIFICATION  
**Milestone:** M4 — Resource Intelligence & Free Resource Optimization  
**Architecture:** FROZEN (Preserving ADR-001 through ADR-104)  

---

## 1. Purpose & Core Principles

This specification governs the repeatable, safe onboarding of AI inference providers and aggregators into the AI Execution Engine.

### Non-Negotiable Invariants:
1. **Free-First Economic Guardrail:** Legitimate free resources are prioritized over paid resources. No paid resource is ever dispatched without explicit authorization (`allowPaid: true`).
2. **Provider Isolation:** Provider-specific wire formats, authentication mechanisms, and response payloads must remain strictly inside the provider adapter (`src/adapters/`). Core Resource Intelligence works exclusively with normalized domain entities.
3. **Zero Credential Exposure:** API keys, tokens, and secret references must never be committed to Git, logged in console traces, or persisted in decision explanations.
4. **Evidence-Based Lifecycle:** A provider or model is never marked production-ready based on marketing claims or documentation alone; it must progress through explicit, verifiable stages.

---

## 2. Verification Lifecycle Stages

```text
DISCOVERED
   │
   ▼
DOCUMENTATION_VERIFIED
   │
   ▼
CREDENTIAL_CONFIGURED (Local env only)
   │
   ▼
CONNECTIVITY_VERIFIED (Real ping / model list)
   │
   ▼
CAPABILITY_TESTED (Text, JSON, Code, Vision)
   │
   ▼
QUOTA_VERIFIED (Documented RPM/RPD validated)
   │
   ▼
INTEGRATION_TESTED (Execution Engine vertical slice)
   │
   ▼
PRODUCTION_CANDIDATE
```

- **`DISCOVERED`:** Candidate identified via public documentation or developer announcement.
- **`DOCUMENTATION_VERIFIED`:** Official endpoint specs, rate limits, pricing, and terms verified.
- **`CREDENTIAL_CONFIGURED`:** Test credential loaded locally via environment variable (`env:KEY_NAME`).
- **`CONNECTIVITY_VERIFIED`:** Live network handshake confirmed (HTTP 200 on basic probe).
- **`CAPABILITY_TESTED`:** Output verified against required formats (e.g. valid JSON parsing).
- **`QUOTA_VERIFIED`:** Rate limits, resets, and quota headers empirically observed.
- **`INTEGRATION_TESTED`:** Worker and Resource Intelligence successfully execute task attempts.
- **`PRODUCTION_CANDIDATE`:** Eligible for automated routing in production pool.
- **`BLOCKED` / `RETIRED`:** Excluded due to revoked access, deprecation, or policy violation.

---

## 3. Provider Adapter Contract Requirements

Every onboarded provider must implement the canonical `ProviderAdapter` interface (`src/adapters/types.ts`):

```typescript
export interface ProviderAdapter {
  readonly providerId: string;
  execute(request: UnifiedRequest, secretApiKey?: string): Promise<UnifiedResponse>;
  normalizeError(error: unknown): NormalizedProviderError;
}
```

### 3.1 Normalized Error Taxonomy
The adapter must classify all upstream exceptions into canonical `ProviderErrorCode` values:
- `AUTHENTICATION` (401 / 403)
- `RATE_LIMIT` (429 Too Many Requests — extracts `retryAfterMs`)
- `QUOTA_EXHAUSTED` (Daily or monthly limit zeroed)
- `SERVER_ERROR` (500 / 502 / 503 / 504)
- `TIMEOUT` (Client or upstream gateway timeout)
- `CONTEXT_TOO_LARGE` (Prompt exceeds context window)
- `INVALID_REQUEST` (Malformed body or unsupported parameter)

### 3.2 Usage & Quota Normalization
Every `UnifiedResponse` must extract accurate usage figures:
- `inputTokens`, `outputTokens`, `totalTokens`
- `latencyMs`
- `finishReason` (`stop`, `length`, `content_filter`, `unknown`)

---

## 4. Aggregator vs Direct Provider Policy

- **Direct Providers (e.g. Google Gemini, Groq, Cerebras, Mistral):**
  Direct relationship between credential, endpoint, and physical capacity. Quotas are authoritative for that account.
- **Aggregators (e.g. OpenRouter):**
  OpenRouter acts as a gateway forwarding to upstream inference providers.
  The engine records `providerType = 'aggregator'` and tracks `upstreamProviderSlug` where exposed.
  The engine never assumes multiple aggregator routes to the same underlying provider provide independent quota capacity.

---

## 5. Security & Secret Redaction Runbook

1. Credentials must be stored only as indirect environment references: `env:GEMINI_API_KEY`, `env:GROQ_API_KEY`.
2. Plaintext API keys must never be inserted into SQL migrations, test fixtures, or documentation.
3. All database persistence pipelines must pass candidate objects through `ResourceDecisionPersistenceService.sanitizeCandidate()`.

---

## 6. Deprecation & Retirement Procedure

When a provider or model is retired by its upstream vendor:
1. Transition registry lifecycle status to `RETIRED` via `resourceDiscoveryRegistry.deprecateCandidate(providerSlug, modelSlug, reason)`.
2. Update database `resources.resources SET status = 'retired'`.
3. Existing historical decision records in `resources.resource_decisions` remain immutable for compliance auditing.

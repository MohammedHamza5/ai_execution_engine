# M1 Slice 1 Report — Recovery Policy & Error Classifier

**Milestone:** M1 (Slice 1 of 10)  
**Status:** **M1 SLICE 1 COMPLETE**  
**Architecture:** FROZEN (ADR-001 through ADR-104)  
**Date:** 2026-10-07  

---

## 1. Objective

Implement a deterministic, provider-agnostic recovery policy and error classification module (`src/engine/recoveryPolicy.ts`) that converts canonical `NormalizedProviderError` envelopes into explicit recovery actions (`RETRY_SAME`, `MIGRATE_RESOURCE`, `FAIL`) with explainable rationale, without modifying worker orchestration, database schemas, or provider adapters.

---

## 2. Recovery Decision Model

The module exposes the following strongly-typed API:

```typescript
export type RecoveryAction =
  | "RETRY_SAME"
  | "MIGRATE_RESOURCE"
  | "FAIL";

export interface RecoveryDecision {
  readonly action: RecoveryAction;
  readonly reason: string;
  readonly retryable: boolean;
  readonly migrationRecommended: boolean;
  readonly waitRequired: boolean;
  readonly retryAfterMs?: number;
}
```

The recovery policy is completely provider-agnostic: it has no knowledge of proprietary provider APIs, HTTP endpoints, headers, or secrets. It operates strictly on the existing normalized error taxonomy (`ProviderErrorCode` and `NormalizedProviderError`).

---

## 3. Decision Precedence

The decision logic enforces a strict 4-tier evaluation order:

```text
                  NormalizedProviderError
                             │
                             ▼
     ┌───────────────────────────────────────────────┐
     │ 1. Is code in NON_RECOVERABLE_CODES set?      │
     │    (INVALID_REQUEST, AUTHENTICATION,          │
     │     AUTHORIZATION, MODEL_NOT_FOUND,           │
     │     CONTEXT_TOO_LARGE, CONTENT_FILTER)        │
     └───────────────────────┬───────────────────────┘
                             │
               YES ──────────┴────────── NO
                │                        │
                ▼                        ▼
             [ FAIL ]      ┌───────────────────────────────────────────┐
                           │ 2. Is migrationRecommended === true?      │
                           │    (QUOTA_EXHAUSTED, RATE_LIMIT, TIMEOUT, │
                           │     NETWORK_ERROR, SERVER_ERROR, etc.)    │
                           └─────────────────────┬─────────────────────┘
                                                 │
                                   YES ──────────┴────────── NO
                                    │                        │
                                    ▼                        ▼
                          [ MIGRATE_RESOURCE ] ┌───────────────────────────┐
                                               │ 3. Is retryable === true? │
                                               └─────────────┬─────────────┘
                                                             │
                                               YES ──────────┴────────── NO
                                                │                        │
                                                ▼                        ▼
                                          [ RETRY_SAME ]              [ FAIL ]
```

### Precedence Invariants:
1. **Security & Parameter Integrity First:** Security (Auth/Authz) and client/syntax defects (`INVALID_REQUEST`, `CONTEXT_TOO_LARGE`) immediately yield `FAIL`. They can never blindly migrate or loop across providers.
2. **Migration Precedence for Capacity/Outages:** If an error indicates `migrationRecommended: true`, the policy yields `MIGRATE_RESOURCE`, prioritizing alternate resource acquisition over hammering a degraded endpoint.
3. **Transient Same-Resource Retries:** If an error is transient (`retryable: true`) but migration is not recommended (`migrationRecommended: false`), the policy yields `RETRY_SAME`.
4. **Deterministic Explainability:** Every decision produces a structured, human-readable `reason` containing the error code and operational rationale without leaking upstream keys or payload secrets.

---

## 4. Error Handling Matrix

| Provider Error Code | `retryable` | `migrationRecommended` | Decision Action | Wait Required |
| :--- | :---: | :---: | :--- | :---: |
| `QUOTA_EXHAUSTED` | `true` | `true` | **`MIGRATE_RESOURCE`** | Preserved if `retryAfterMs` present |
| `RATE_LIMIT` | `true` | `true` | **`MIGRATE_RESOURCE`** | `true` if `retryAfterMs > 0` |
| `TIMEOUT` | `true` | `true` | **`MIGRATE_RESOURCE`** | `false` (immediate migration) |
| `NETWORK_ERROR` | `true` | `true` | **`MIGRATE_RESOURCE`** | `false` (immediate migration) |
| `SERVER_ERROR` | `true` | `true` | **`MIGRATE_RESOURCE`** | `false` (immediate migration) |
| `SERVICE_UNAVAILABLE` | `true` | `true` | **`MIGRATE_RESOURCE`** | `false` (immediate migration) |
| *Transient Blip* (e.g. `TIMEOUT`) | `true` | `false` | **`RETRY_SAME`** | Preserved if `retryAfterMs` present |
| `INVALID_REQUEST` | `false` | `false` | **`FAIL`** | `false` |
| `AUTHENTICATION` | `false` | `*` | **`FAIL`** | `false` |
| `AUTHORIZATION` | `false` | `*` | **`FAIL`** | `false` |
| `MODEL_NOT_FOUND` | `false` | `*` | **`FAIL`** | `false` |
| `CONTEXT_TOO_LARGE` | `false` | `*` | **`FAIL`** | `false` |
| `CONTENT_FILTER` | `false` | `*` | **`FAIL`** | `false` |
| `UNKNOWN` | `false` | `false` | **`FAIL`** | `false` |

---

## 5. Tests Added

A dedicated unit test suite was implemented in [`tests/recoveryPolicy.test.ts`](file:///c:/Users/KimoStore/StudioProjects/AI-Execution-Engine/tests/recoveryPolicy.test.ts) covering 12 test assertions:
1. `QUOTA_EXHAUSTED` yields `MIGRATE_RESOURCE`
2. `RATE_LIMIT` yields `MIGRATE_RESOURCE` with `waitRequired: true` and `retryAfterMs` preservation
3. `TIMEOUT` yields `MIGRATE_RESOURCE`
4. `NETWORK_ERROR` yields `MIGRATE_RESOURCE`
5. `SERVER_ERROR` yields `MIGRATE_RESOURCE`
6. `SERVICE_UNAVAILABLE` yields `MIGRATE_RESOURCE`
7. `retryable=true` with `migrationRecommended=false` yields `RETRY_SAME`
8. `INVALID_REQUEST` yields `FAIL`
9. `AUTHENTICATION` and `AUTHORIZATION` yield `FAIL` regardless of migration recommendations
10. All 16 `ProviderErrorCode` enum values produce deterministic, non-empty reasons free of secrets
11. Edge case: `retryable=true` and `migrationRecommended=true` prefers `MIGRATE_RESOURCE`
12. Edge case: `retryable=false` and `migrationRecommended=false` yields `FAIL`

---

## 6. Verification Results

### Vitest Test Suite (`npm test`)
```text
✓ tests/recoveryPolicy.test.ts (12 tests) 14ms
✓ tests/e2e.test.ts (1 test)
✓ tests/queue_worker.test.ts (2 tests)
✓ tests/api.test.ts (3 tests)
✓ tests/fencing.test.ts (1 test)
✓ tests/persistence.test.ts (1 test)
✓ tests/validation.test.ts (5 tests)
✓ tests/artifact.test.ts (1 test)
✓ tests/provider_adapter.test.ts (4 tests)

Test Files:  9 passed (9 total)
Tests:       30 passed (30 total)
Duration:    11.13s
Exit Code:   0
```

### TypeScript Strict Mode (`npx tsc --noEmit`)
```text
Exit Code: 0 (Zero errors)
```

### TypeScript Production Build (`npm run build`)
```text
> ai-execution-engine@0.1.0 build
> tsc

Exit Code: 0 (dist/ updated cleanly)
```

---

## 7. Files Changed

Only new files within the permitted Slice 1 scope were created:
- `src/engine/recoveryPolicy.ts` (New module: 88 lines)
- `tests/recoveryPolicy.test.ts` (New test suite: 168 lines)

**Unmodified Files (Strict Scope Invariant):**
- `src/engine/worker.ts` (Unchanged)
- `src/engine/executionEngine.ts` (Unchanged)
- `src/resources/resourceIntelligence.ts` (Unchanged)
- `src/adapters/geminiAdapter.ts` (Unchanged)
- `src/db/migrations/*` (Unchanged)
- `docs/*` (Architecture documents frozen and untouched)

---

## 8. Architecture Invariants Preserved

1. **Architecture Freeze:** No changes to architecture contracts, ADRs, database DDL, or queue models.
2. **Zero Provider Leaks:** `RecoveryPolicy` consumes only canonical domain interfaces (`NormalizedProviderError`).
3. **Deterministic Explainability:** All decisions return structured reasons.
4. **No Side Effects:** Pure in-memory classification with zero database mutations or network I/O.

---

## 9. Next Steps

**Slice 2 has NOT started.**  
Execution is paused pending human review and authorization for **Slice 2: Attempt Failure Persistence & Durable Checkpointing**.

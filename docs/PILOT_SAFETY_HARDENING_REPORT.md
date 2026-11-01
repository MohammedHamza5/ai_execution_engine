# AI-Execution-Engine — Pilot Safety Hardening Report

**Project:** AI-Execution-Engine  
**Document Type:** Safety Hardening, Evidence Audit & Pilot Authorization Report  
**Author:** Principal Software Architect (Antigravity)  
**Date:** 2026-10-18  
**Baseline Status:** M0–M6 Complete & Frozen (ADR-001 through ADR-104)  
**Final Verdict:** `PILOT_READY` (Subject to Operational Policy Constraints)

---

## 1. Executive Summary

This report documents the rigorous remediation and verification conducted for the three operational risks identified in `docs/FINAL_READINESS_REVIEW.md` and `docs/OPERATIONAL_READINESS_REPORT.md`:
1. **Cloudflare Adapter Default Model:** Remediation of the deprecated `@cf/meta/llama-3-8b-instruct` (Cloudflare HTTP 410) to `@cf/meta/llama-3.1-8b-instruct` with unit tests for default fallback and explicit model override.
2. **Windows Network Policy (IPv6 / Happy Eyeballs):** Scoping Node.js IPv4-first DNS ordering and disabling `autoSelectFamily` strictly to Windows (`process.platform === "win32"`), eliminating socket timeout hangs without mutating Linux container environments or disabling OS-level IPv6.
3. **Resource Quota Protection & Conservative Governance:** Formalizing routing prioritization so Groq serves routine tasks, Gemini is conserved for deliberative DAG planning and synthesis under its 20 RPD free tier, unverified per-key quotas are treated as single pools, and `allowPaid = false` is strictly locked.

Full regression verification across the entire test suite confirms **58/58 test files passed (329/329 tests green)** with zero failures and zero secret leaks.

---

## 2. Remediations Executed

### Task 1 — Cloudflare Adapter Deprecation Fix & Verification

- **Problem:** `src/adapters/cloudflareAdapter.ts` had a fallback default `const model = request.modelId || "@cf/meta/llama-3-8b-instruct";`. Cloudflare Workers AI deprecated this model (`HTTP 410 Gone: Model has been deprecated on 2026-05-30`), causing requests omitting `modelId` to fail.
- **Action Taken:**
  - Updated line 62 in `src/adapters/cloudflareAdapter.ts` to:
    ```typescript
    const model = request.modelId || "@cf/meta/llama-3.1-8b-instruct";
    ```
  - Preserved full support for explicit caller-specified models (e.g., `@cf/baai/bge-large-en-v1.5`).
  - Updated `tests/m4_live_provider_enablement.test.ts` to use `@cf/meta/llama-3.1-8b-instruct`.
  - Added unit test asserting default model fallback when `request.modelId` is omitted (`fetch` URL verified).
  - Added unit test asserting explicit model retention when `request.modelId` is passed (`fetch` URL verified).
- **Test Evidence:**
  - `tests/m4_live_provider_enablement.test.ts` (9 tests passed).

---

### Task 2 — Windows Network Policy (IPv6 Socket Hang)

- **Problem:** On Windows 11 Node.js v20 runtime, unrouted or ISP-unreachable IPv6 routes caused Node's dual-stack Happy Eyeballs socket connection to hang (`ETIMEDOUT` / `ENETUNREACH`) for 20+ seconds or fail before falling back to IPv4. Previously, an unconditional `dns.setDefaultResultOrder("ipv4first")` had been placed in `src/index.ts` and `src/config/env.ts`, which globally altered network behavior on all platforms including Linux containers.
- **Action Taken:**
  - Created isolated module `src/config/networkPolicy.ts` (39 lines) implementing `applyPlatformNetworkPolicy()`.
  - Scoped policy exclusively to Windows:
    ```typescript
    export function applyPlatformNetworkPolicy(platformOverride?: NodeJS.Platform): NetworkPolicyResult {
      const currentPlatform = platformOverride ?? process.platform;
      if (currentPlatform === "win32") {
        dns.setDefaultResultOrder("ipv4first");
        if (typeof net.setDefaultAutoSelectFamily === "function") {
          net.setDefaultAutoSelectFamily(false);
        }
        return { applied: true, platform: currentPlatform, dnsResultOrder: "ipv4first", autoSelectFamily: false };
      }
      return { applied: false, platform: currentPlatform };
    }
    ```
  - Removed unconditional top-level `dns.setDefaultResultOrder` from `src/config/env.ts` and `src/index.ts`, replacing both with `applyPlatformNetworkPolicy()`.
  - Preserved standard RFC 6724 dual-stack behavior on Linux and macOS environments.
  - Zero OS-level IPv6 disabling or system configuration tampering.
- **Test Evidence:**
  - Created `tests/networkPolicy.test.ts` verifying win32 application, linux non-application, darwin non-application, and runtime safety (4 tests passed).

---

### Task 3 — Resource Quota Protection & Governance

- **Problem:** 
  - Gemini free-tier keys share a strict 20 RPD (requests per day) project ceiling. Routine execution tasks routed to Gemini quickly exhaust this quota.
  - Groq and Gemini multiple keys lack cross-project proof of independence, presenting a risk of cascading exhaustion if treated as separate quotas.
- **Action Taken & System Verification:**
  - Verified `ResourceScoringEngine`: Groq offers sub-second latency (P95 400ms -> latency score 1.0) and 30 RPM headroom, naturally out-scoring Gemini (P95 1500ms -> latency score 0.905) for routine text tasks.
  - Verified Capability Isolation: Tasks requiring `planning`, `synthesis`, or `multimodal` DAG execution specify required capabilities, routing to Gemini (`gemini-3.8-flash`) while excluding Groq via `EligibilityEngine`'s `CAPABILITY_UNSUPPORTED` rule.
  - Verified Cold Reserve Isolation: Cold reserves retain low priority ($\le 10$) and are never selected while primary resources ($80-100$) are healthy.
  - Verified Zero Silent Paid Spend: `EligibilityEngine` hard-excludes paid models with `PAID_UNAUTHORIZED` whenever `allowPaid = false`. If only paid candidates remain, `ResourceDecisionEngine` halts with `REQUEST_APPROVAL` and aborts rather than spending silently (ADR-072).
  - Verified Quota Exhaustion Handling: In `src/engine/worker.ts`, upon `QUOTA_EXHAUSTED`, database quota is immediately set to 0, preventing repeated attempts on the exhausted quota pool.
- **Test Evidence:**
  - `tests/live_fleet_e2e.test.ts` (3 tests passed).
  - `tests/resourceSelection.test.ts` (13 tests passed).
  - `tests/eligibilityEngine.test.ts` (4 tests passed).
  - `tests/resourceOperationalIntelligence.test.ts` (10 tests passed).

---

## 3. Code Modifications & Architectural Justifications

| File Path | Lines Changed | Justification |
| :--- | :--- | :--- |
| `src/adapters/cloudflareAdapter.ts` | Line 62 | Updated deprecated model `@cf/meta/llama-3-8b-instruct` to `@cf/meta/llama-3.1-8b-instruct`. Preserved explicit `request.modelId` parameter. Total lines: 138 (Anti-Monolith compliant). |
| `src/config/networkPolicy.ts` | New file (39 lines) | Encapsulated Windows-scoped network policy (`dns.setDefaultResultOrder("ipv4first")` + `net.setDefaultAutoSelectFamily(false)`). Prevents global non-Windows mutation. |
| `src/config/env.ts` | Lines 1–4 | Replaced unconditional `dns.setDefaultResultOrder("ipv4first")` with `applyPlatformNetworkPolicy()`. |
| `src/index.ts` | Lines 1–4 | Replaced unconditional `dns.setDefaultResultOrder("ipv4first")` with `applyPlatformNetworkPolicy()`. |
| `tests/m4_live_provider_enablement.test.ts` | Lines 62–135 | Updated model reference to `@cf/meta/llama-3.1-8b-instruct` and added unit tests for default fallback and explicit model preservation. |
| `tests/networkPolicy.test.ts` | New file (33 lines) | Unit tests verifying win32 vs linux/darwin platform behavior isolation. |

---

## 4. Test Verification & Full Suite Regression

Running the entire test suite via `npm test` produced clean execution across all test files:

```
Test Files  58 passed (58)
     Tests  329 passed (329)
  Start at  18:28:37
  Duration  41.96s
```

### Key Sub-Suite Breakdown

| Test Suite | Files | Passed / Total | Status |
| :--- | :---: | :---: | :---: |
| **Provider Adapters & Models** | 4 files | 29 / 29 | PASS |
| **Network Policy** | 1 file | 4 / 4 | PASS |
| **Eligibility & Scoring Engines** | 3 files | 27 / 27 | PASS |
| **Resource Intelligence & Quotas** | 4 files | 30 / 30 | PASS |
| **Crash Fencing & Worker Recovery** | 6 files | 35 / 35 | PASS |
| **DAG Engine & State Transitions (M6)** | 12 files | 78 / 78 | PASS |
| **Live Fleet E2E** | 1 file | 3 / 3 | PASS |
| **Other M0–M5 Test Suites** | 27 files | 123 / 123 | PASS |
| **Total** | **58 files** | **329 / 329** | **100% GREEN** |

---

## 5. Updated Resource Fleet Status Table

| Provider | Model ID / Slug | Role / Capabilities | Default Fallback? | Free Quota Tier | Quota Confidence | Engine Priority |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: |
| **GroqCloud** | `openai/gpt-oss-120b` | Reasoning, Math, Arch | No | 30 RPM / 14.4k RPD | Shared Pool (`LIKELY`) | 100 (Primary) |
| **GroqCloud** | `qwen/qwen3.8-27b` | Fast Code, JSON, Text | No | 30 RPM / 14.4k RPD | Shared Pool (`LIKELY`) | 95 (Workhorse) |
| **GroqCloud** | `openai/gpt-oss-20b` | Critic, Validation | No | 30 RPM / 14.4k RPD | Shared Pool (`LIKELY`) | 90 (Validator) |
| **Google Gemini** | `gemini-3.8-flash` | Deliberative Planning, Synthesis | Yes (Gemini Adapter) | 15 RPM / 20 RPD | Shared Pool (`LIKELY`) | 100 (Planner Only) |
| **Cloudflare** | `@cf/meta/llama-3.1-8b-instruct` | Edge Reflex, Light Utility | **Yes (Cloudflare Adapter)** | Edge Free Tier | Per-Token | 80 (Fast Edge) |
| **Cloudflare** | `@cf/baai/bge-large-en-v1.5` | Dense Vector Embeddings | Explicit Only | Edge Free Tier | Per-Token | 80 (Embeddings) |
| **OpenRouter** | `liquid/lfm-2.5-2.6b:free` | Aggregator Buffer, Free Text | Yes (OpenRouter Adapter) | Rate-Limited Free | Aggregator Shared | 60 (Buffer) |

---

## 6. Pilot Operational Invariants & Safeguards

During the controlled pilot run, the runtime must adhere to the following strict operational boundaries:

1. **Zero Silent Paid Spend Invariant (ADR-072):**
   - Under no circumstances shall `allowPaid` be set to `true` in pilot tasks.
   - Any attempt to route to a paid tier without explicit approval must trigger `REQUEST_APPROVAL` and abort.
2. **Gemini Quota Preservation:**
   - Routine code and text execution tasks must not request `planning` or `multimodal` capabilities unless explicitly necessary, preserving Gemini's 20 RPD budget for DAG orchestration.
3. **Conservative Quota Pool Assumption:**
   - The engine does not treat Gemini Slot 1, 2, and 3 or Groq Slot 1, 2, and 3 as independent quota budgets. Quota exhaustion on one slot immediately trips circuit breaker protection for that provider.
4. **Environment Isolation:**
   - IPv4-first DNS ordering is strictly active on Windows dev/test hosts and inactive on production container hosts.
5. **Cold Reserve Invariant:**
   - Cold reserves ($\le 10$ priority) are reserved strictly for emergency failover and never dispatched under healthy operating conditions.

---

## 7. Final Operational Verdict

```
+-------------------------------------------------------------------------------+
|                             FINAL VERDICT                                     |
|                                                                               |
|                            >>> PILOT_READY <<<                                |
|                                                                               |
|  All 3 operational risks successfully remediated, isolated, and verified.     |
|  58 test suites passed (329/329 tests). Zero regressions. Zero secret leaks.  |
|  The engine is approved for controlled pilot execution under allowPaid=false. |
+-------------------------------------------------------------------------------+
```

# AI-Execution-Engine — API Resource Onboarding Matrix

**Milestone:** M4 (Resource Intelligence & Free Resource Optimization)  
**Governing Authority:** `docs/M4_MASTER_EXECUTION_PLAN.md`, ADR-072, ADR-104  
**Date Audited:** 2026-10-16  
**Auditor:** API Resource Research & Onboarding Lead  

---

## 1. Executive Overview

This matrix establishes the definitive, evidence-backed classification of the eight candidate AI inference services evaluated for the **AI-Execution-Engine** free-first resource pool.

In strict alignment with the engine's core principle:
> *"We do not search for the best model. We search for the best possible execution of the task using the resources currently available."*

We distinguish genuine, sustainable free capacity from temporary promotional trials, aggregator gateways, and marketing claims.

---

## 2. Comprehensive Provider Comparison Matrix

| # | Provider ID | Service Name | Provider Type | Billing Classification | Credit Card Required? | Documented Free Allowance & Reset | Rate Limits (RPM / RPD / TPM) | Commercial Use & Privacy Terms | Engine Qualification Status | Recommended Engine Tier |
|---|-------------|--------------|---------------|------------------------|-----------------------|-----------------------------------|-------------------------------|--------------------------------|-----------------------------|--------------------------|
| **1** | `gemini` | **Google Gemini API** (Google AI Studio) | Direct Provider API | `PERMANENT_FREE_TIER` | **No** (Zero payment details needed) | Continuous free tier. Resets daily at 00:00 Pacific Time. | Flash: 15 RPM, 1,500 RPD, 1M TPM. Pro: 2 RPM, 50 RPD, 32k TPM. | **Permitted**. ⚠️ **Privacy Warning:** Prompts & outputs on Free Tier are used by Google to train models (`Used to improve our products: Yes`). Paid tier disables training. | `CONNECTIVITY_VERIFIED` (Existing adapter in repo) | **Tier 1 (Core Backbone)** |
| **2** | `groq` | **GroqCloud** | Direct LPU Provider | `PERMANENT_FREE_TIER` | **No** (Email/OAuth registration) | Continuous free tier per organization. Resets daily at 00:00 UTC. | Standard chat: 30 RPM. 8B models: up to 14,400 RPD / 500k TPD. 70B models: 1,000 RPD / 100k TPD. Audio (Whisper): 20 RPM, 2k RPD. | **Permitted**. Low latency LPU inference. Standard platform data logging; zero user data training on API endpoints. | `DOCUMENTATION_VERIFIED` | **Tier 1 (High-Speed Reasoning & Synthesis)** |
| **3** | `cerebras` | **Cerebras Inference** | Direct CS-3 Provider | `TRIAL_CREDITS` | **Yes** (Valid payment method required to claim trial) | **One-time $5 credit**, expires in 30 days. No permanent free allowance. | Trial tier: low RPM, restricted context window. Developer tier (paid): >10x higher throughput. | Commercial terms standard for paid tier, but free access is an expiring promotional trial. | `BLOCKED` (Fails free-first non-expiring criteria; requires credit card) | **Excluded from Free Pool** (Eligible only as BYOK / Paid) |
| **4** | `cloudflare` | **Cloudflare Workers AI** | Direct Edge Provider | `PERMANENT_FREE_TIER` | **No** (Included on Workers Free plan) | **10,000 Neurons per day**. Resets daily at 00:00 UTC. | 10k Neurons/day cap. Hard cut-off when exhausted (HTTP error until next UTC day). Concurrency governed by edge limits. | **Permitted**. Edge isolation. Subject to Cloudflare Workers terms of service. | `DOCUMENTATION_VERIFIED` | **Tier 2 (Edge Fallback & Lightweight Models)** |
| **5** | `mistral` | **Mistral AI (La Plateforme)** | Direct European Provider | `FREE_PREVIEW` (Experiment Tier) | **No** (Requires SMS Phone Verification) | Free sandbox testing. Monthly token allowances dynamically throttled. | ~1 RPS (~60 RPM). Dynamic TPM. Hard throttling with `429 Too Many Requests`. Headers supply `X-RateLimit-Remaining`. | ⚠️ **Non-Commercial Only on Free:** Free tier explicitly restricted to experimentation, evaluation, and prototyping. Live commercial traffic requires upgrade to Paid Tier. | `DOCUMENTATION_VERIFIED` | **Tier 3 (Evaluation & Non-Commercial Dev Only)** |
| **6** | `openrouter` | **OpenRouter** | Multi-Provider Aggregator Gateway | `PERMANENT_FREE_TIER` (for `:free` endpoints) | **No** (Optional deposit) | Free models with `:free` suffix. Quota depends on lifetime account deposit. | 20 RPM global limit. **50 RPD** for accounts with <$10 lifetime deposit. **1,000 RPD** for accounts with ≥$10 lifetime deposit. | Depends on individual routed model upstream provider. Aggregator terms apply. | `DOCUMENTATION_VERIFIED` | **Tier 2 (Model Diversity & Quota Extender)** |
| **7** | `nvidia` | **NVIDIA API Catalog / NIM** | Model Catalog & NIM Gateway | `FREE_PREVIEW` (Prototyping Sandbox) | **No** (NVIDIA Developer Account) | Serverless developer sandbox with rate-limited trial access. | ~40 RPM depending on model load. Daily volume dynamically throttled during peak hours. | ⚠️ **Evaluation Only:** Intended solely for prototyping, testing, and NIM evaluation. Production deployment requires paid cloud partner or self-hosted enterprise license. | `DOCUMENTATION_VERIFIED` | **Tier 3 (Frontier Model Evaluation & Prototyping)** |
| **8** | `huggingface` | **Hugging Face Inference Providers** | Aggregated Provider Hub | `PAID` / `BYOK` (Zero free credits for base accounts) | **Yes/No** (Free accounts get $0. PRO accounts get $2/mo general compute credit) | **Zero free allowance** on Inference Providers for standard free accounts. | Pay-as-you-go partner rates. Requests blocked immediately with 0 credit balance unless BYOK is supplied. | Standard HF terms. | `BLOCKED` (Zero ongoing free credit allowance on free accounts) | **Excluded from Free Pool** (Eligible only as BYOK) |

---

## 3. Tiered Suitability Assessment for AI-Execution-Engine

### Tier 1 — Core Free Execution Pool (Immediate Integration Candidates)
1. **Google Gemini API (`gemini`)**:
   - **Role:** High-context backbone, multimodal processing (text, code, vision, audio).
   - **Quotas:** 15 RPM / 1,500 RPD on Flash.
   - **Trade-off:** Data training opt-in on free tier requires sanitized task payloads.
2. **GroqCloud (`groq`)**:
   - **Role:** Ultra-fast reasoning, step execution, and real-time synthesis (Llama 3.3 70B, Llama 3.1 8B).
   - **Quotas:** 30 RPM / 14,400 RPD (8B) / 1,000 RPD (70B).
   - **Trade-off:** Strict daily token caps (TPD) require careful token accounting in Resource Intelligence.

### Tier 2 — Extended Free Pool (Diversity & Secondary Fallbacks)
3. **Cloudflare Workers AI (`cloudflare`)**:
   - **Role:** Edge tasks, text embeddings, lightweight utility steps (`@cf/meta/llama-3.1-8b-instruct`).
   - **Quotas:** 10,000 Neurons/day (~tens to hundreds of requests depending on model weight).
   - **Trade-off:** Requires Account ID and API Token; non-OpenAI request schema requires adapter mapping.
4. **OpenRouter (`openrouter`)**:
   - **Role:** Fallback diversity pool for specialized open-weight models (`:free` endpoints).
   - **Quotas:** 20 RPM, 50 RPD (fresh free account).
   - **Trade-off:** High variance in upstream provider latency and availability; 50 RPD limit is restrictive without a $10 historical deposit.

### Tier 3 — Evaluation & Non-Commercial Sandbox (Restricted Workloads)
5. **Mistral AI (`mistral`)**:
   - **Role:** Specialized code generation (`codestral-latest`) and multilingual evaluation.
   - **Trade-off:** Policy restriction (non-commercial only on free tier) and SMS requirement.
6. **NVIDIA API Catalog (`nvidia`)**:
   - **Role:** Benchmarking and evaluating cutting-edge NIM models (e.g., Nemotron, DeepSeek).
   - **Trade-off:** Ephemeral sandbox capacity; not guaranteed for ongoing SLA.

### Blocked / Ineligible for Sustainable Free Pool
7. **Cerebras Inference (`cerebras`)**:
   - **Reason:** Expiring 30-day $5 credit requiring credit card registration. Not an ongoing free tier.
8. **Hugging Face Inference Providers (`huggingface`)**:
   - **Reason:** $0 free compute allowance for standard free accounts. Requires paid credits or BYOK.

---

## 4. Aggregator vs Direct Provider Architectural Risks

| Risk Dimension | Direct Provider APIs (Gemini, Groq, Cloudflare) | Aggregators & Gateways (OpenRouter, NVIDIA Catalog) |
|---|---|---|
| **Rate Limit Attribution** | Clear, deterministic HTTP headers (`Retry-After`, `X-RateLimit-*`). | Ambiguous: HTTP 429 may stem from gateway or congested upstream host. |
| **Capacity Independence** | Dedicated vendor compute capacity. | Shared upstream compute; multiple catalog models may route to the same underlying cluster. |
| **Failure Classification** | Explicit error payloads (`RESOURCE_EXHAUSTED`, `INVALID_ARGUMENT`). | Wrapped error payloads requiring double-layer unwrapping in adapter boundary. |
| **Latency Consistency** | Direct TLS handshake and stream termination. | Additional hop through aggregator gateway adds 80–250ms p50 latency. |

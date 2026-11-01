# AI-Execution-Engine — Initial Verified Resource Inventory

**Milestone:** M4 (Resource Intelligence & Free Resource Optimization)  
**Governing Authority:** `docs/M4_MASTER_EXECUTION_PLAN.md` (Task M4.12), ADR-018, ADR-028, ADR-072, ADR-104  
**Date:** 2026-10-16  
**Auditor:** API Resource Research & Onboarding Lead  

---

## 1. Inventory Design & Catalog Criteria

In accordance with Task M4.12 of the M4 Master Plan, this inventory maps actual provider, model, and endpoint combinations to their documented capabilities, context ceilings, rate limits, and qualification statuses.

Every entry must have:
1. Verifiable model identifier and endpoint.
2. Verified billing category (`PERMANENT_FREE_TIER`, `FREE_PREVIEW`, `TRIAL_CREDITS`, `PAID`, `BYOK`).
3. Concrete capability tags matching `src/domain/resource/stateTypes.ts`: `["text", "code", "reasoning", "vision", "audio", "embeddings", "json", "tools"]`.
4. Discrete context window and output token limits.
5. Exact qualification state according to the M4 verification pipeline.

---

## 2. Initial Catalog of Candidate Resources (8 Selected Services)

### Resource 1: Google Gemini 1.5 Flash
- **Resource Identifier:** `gemini/gemini-1.5-flash`
- **Provider:** Google DeepMind (`gemini`)
- **API Base URL:** `https://generativelanguage.googleapis.com/v1beta`
- **Native Endpoint:** `/models/gemini-1.5-flash:generateContent`
- **OpenAI Endpoint:** `/openai/chat/completions`
- **Billing Class:** `PERMANENT_FREE_TIER`
- **Capabilities:** `["text", "code", "reasoning", "vision", "audio", "json", "tools"]`
- **Context Window:** 1,048,576 tokens
- **Max Output Tokens:** 8,192 tokens
- **Documented Limits:** 15 RPM, 1,500 RPD, 1,000,000 TPM (Resets daily at 00:00 PT)
- **Qualification State:** `CONNECTIVITY_VERIFIED` (Implemented in `src/adapters/geminiAdapter.ts`)
- **Engine Suitability:** **Tier 1 (High-throughput multimodal backbone)**
- **Notes / Constraints:** Prompts and outputs are used by Google for model training on the free tier.

---

### Resource 2: Google Gemini 2.0 Flash
- **Resource Identifier:** `gemini/gemini-2.0-flash`
- **Provider:** Google DeepMind (`gemini`)
- **API Base URL:** `https://generativelanguage.googleapis.com/v1beta`
- **Native Endpoint:** `/models/gemini-2.0-flash:generateContent`
- **OpenAI Endpoint:** `/openai/chat/completions`
- **Billing Class:** `PERMANENT_FREE_TIER`
- **Capabilities:** `["text", "code", "reasoning", "vision", "audio", "json", "tools"]`
- **Context Window:** 1,048,576 tokens
- **Max Output Tokens:** 8,192 tokens
- **Documented Limits:** 15 RPM, 1,500 RPD, 1,000,000 TPM (Shared daily pool)
- **Qualification State:** `DOCUMENTATION_VERIFIED`
- **Engine Suitability:** **Tier 1 (Modernized fast multimodal backbone)**
- **Notes / Constraints:** Replaces Gemini 1.5 Flash with lower latency and improved reasoning.

---

### Resource 3: Groq Llama 3.3 70B Versatile
- **Resource Identifier:** `groq/llama-3.3-70b-versatile`
- **Provider:** GroqCloud (`groq`)
- **API Base URL:** `https://api.groq.com/openai/v1`
- **Endpoint:** `/chat/completions`
- **Billing Class:** `PERMANENT_FREE_TIER`
- **Capabilities:** `["text", "code", "reasoning", "json", "tools"]`
- **Context Window:** 128,000 tokens
- **Max Output Tokens:** 32,768 tokens
- **Documented Limits:** 30 RPM, 1,000 RPD, 100,000 TPD, 6,000 TPM (Resets daily at 00:00 UTC)
- **Qualification State:** `DOCUMENTATION_VERIFIED`
- **Engine Suitability:** **Tier 1 (High-tier reasoning, code generation, and arbitration)**
- **Notes / Constraints:** Extremely fast inference (~250-300 tok/sec); daily token ceiling (100k TPD) is the primary constraint.

---

### Resource 4: Groq Llama 3.1 8B Instant
- **Resource Identifier:** `groq/llama-3.1-8b-instant`
- **Provider:** GroqCloud (`groq`)
- **API Base URL:** `https://api.groq.com/openai/v1`
- **Endpoint:** `/chat/completions`
- **Billing Class:** `PERMANENT_FREE_TIER`
- **Capabilities:** `["text", "code", "json", "tools"]`
- **Context Window:** 128,000 tokens
- **Max Output Tokens:** 8,192 tokens
- **Documented Limits:** 30 RPM, 14,400 RPD, 500,000 TPD, 30,000 TPM (Resets daily at 00:00 UTC)
- **Qualification State:** `DOCUMENTATION_VERIFIED`
- **Engine Suitability:** **Tier 1 (Ultra-fast workhorse for steps, preliminary extraction, and formatting)**
- **Notes / Constraints:** High daily request quota (14.4k RPD) makes it an ideal fallback workhorse.

---

### Resource 5: Cloudflare Llama 3.1 8B Instruct
- **Resource Identifier:** `cloudflare/@cf/meta/llama-3.1-8b-instruct`
- **Provider:** Cloudflare Workers AI (`cloudflare`)
- **API Base URL:** `https://api.cloudflare.com/client/v4/accounts/{account_id}/ai`
- **Endpoint:** `/run/@cf/meta/llama-3.1-8b-instruct`
- **Billing Class:** `PERMANENT_FREE_TIER`
- **Capabilities:** `["text", "code", "json"]`
- **Context Window:** 8,192 tokens
- **Max Output Tokens:** 2,048 tokens
- **Documented Limits:** 10,000 Neurons per day (Resets daily at 00:00 UTC)
- **Qualification State:** `DOCUMENTATION_VERIFIED`
- **Engine Suitability:** **Tier 2 (Edge fallback & utility step worker)**
- **Notes / Constraints:** Requires mapping proprietary Cloudflare JSON request/response schema into `UnifiedRequest`.

---

### Resource 6: Cloudflare BGE-Large Embeddings
- **Resource Identifier:** `cloudflare/@cf/baai/bge-large-en-v1.5`
- **Provider:** Cloudflare Workers AI (`cloudflare`)
- **API Base URL:** `https://api.cloudflare.com/client/v4/accounts/{account_id}/ai`
- **Endpoint:** `/run/@cf/baai/bge-large-en-v1.5`
- **Billing Class:** `PERMANENT_FREE_TIER`
- **Capabilities:** `["embeddings"]`
- **Context Window:** 512 tokens
- **Max Output Tokens:** N/A (1024-dimension vector output)
- **Documented Limits:** 10,000 Neurons per day
- **Qualification State:** `DOCUMENTATION_VERIFIED`
- **Engine Suitability:** **Tier 2 (Free local semantic search & claim verification)**
- **Notes / Constraints:** Low neuron cost per invocation allows extensive embedding operations.

---

### Resource 7: OpenRouter Meta Llama 3.2 3B Instruct (:free)
- **Resource Identifier:** `openrouter/meta-llama/llama-3.2-3b-instruct:free`
- **Provider:** OpenRouter (`openrouter`)
- **API Base URL:** `https://openrouter.ai/api/v1`
- **Endpoint:** `/chat/completions`
- **Billing Class:** `PERMANENT_FREE_TIER`
- **Capabilities:** `["text", "code", "json"]`
- **Context Window:** 131,072 tokens
- **Max Output Tokens:** 4,096 tokens
- **Documented Limits:** 20 RPM global; 50 RPD (free account) / 1,000 RPD (unlocked)
- **Qualification State:** `DOCUMENTATION_VERIFIED`
- **Engine Suitability:** **Tier 2 (Lightweight fallback & alternative provider diversity)**
- **Notes / Constraints:** Shared aggregator capacity; upstream latency spikes may occur.

---

### Resource 8: Mistral Small Latest (La Plateforme)
- **Resource Identifier:** `mistral/mistral-small-latest`
- **Provider:** Mistral AI (`mistral`)
- **API Base URL:** `https://api.mistral.ai/v1`
- **Endpoint:** `/chat/completions`
- **Billing Class:** `FREE_PREVIEW` (Experiment Tier)
- **Capabilities:** `["text", "code", "reasoning", "json", "tools"]`
- **Context Window:** 32,768 tokens
- **Max Output Tokens:** 8,192 tokens
- **Documented Limits:** ~1 RPS (~60 RPM), dynamic TPM
- **Qualification State:** `DOCUMENTATION_VERIFIED`
- **Engine Suitability:** **Tier 3 (Evaluation, testing, non-commercial benchmarking)**
- **Notes / Constraints:** Policy restriction: Experiment tier is restricted to non-commercial testing/prototyping.

---

### Resource 9: NVIDIA Llama 3.1 Nemotron 70B Instruct (NIM Sandbox)
- **Resource Identifier:** `nvidia/nvidia/llama-3.1-nemotron-70b-instruct`
- **Provider:** NVIDIA NIM (`nvidia`)
- **API Base URL:** `https://integrate.api.nvidia.com/v1`
- **Endpoint:** `/chat/completions`
- **Billing Class:** `FREE_PREVIEW` (Evaluation Sandbox)
- **Capabilities:** `["text", "code", "reasoning", "json"]`
- **Context Window:** 128,000 tokens
- **Max Output Tokens:** 4,096 tokens
- **Documented Limits:** ~40 RPM (Sandbox rate limits)
- **Qualification State:** `DOCUMENTATION_VERIFIED`
- **Engine Suitability:** **Tier 3 (High-end synthetic reasoning evaluation)**
- **Notes / Constraints:** Sandbox testing only; ephemeral capacity without production SLA.

---

### Resource 10: Cerebras Llama 3.3 70B
- **Resource Identifier:** `cerebras/llama3.3-70b`
- **Provider:** Cerebras Systems (`cerebras`)
- **API Base URL:** `https://api.cerebras.ai/v1`
- **Endpoint:** `/chat/completions`
- **Billing Class:** `PERMANENT_FREE_TIER` (No credit card required)
- **Capabilities:** `["text", "code", "reasoning", "json"]`
- **Context Window:** 128,000 tokens
- **Max Output Tokens:** 8,192 tokens
- **Documented Limits:** 30 RPM, 60,000 TPM, 14,400 RPD
- **Qualification State:** `CONNECTIVITY_VERIFIED` (Implemented via `src/adapters/openAICompatibleAdapter.ts`)
- **Engine Suitability:** **Tier 1 (Ultra-fast wafer-scale reasoning and code generation)**
- **Notes / Constraints:** Drop-in OpenAI-compatible inference with ultra-fast latency (300-500 tok/sec).

---

## 3. Disqualified / Blocked Candidate Entries

| Provider & Model | Billing Category | Disqualification Reason | Architectural Action |
|---|---|---|---|
| **Hugging Face Inference Providers** | `PAID` / `BYOK` | Standard free accounts receive $0 compute credits. Cannot run without paid credit balance. | Excluded from free pool. Blocked under ADR-072. |

---

## 4. Multi-Credential Fleet Registry (Audit Date: 2026-10-17)

A total of 16 live credentials across 4 providers were onboarded and audited:

| Provider | Credential Slot | Secret Reference | Audited Endpoint / Model | Live Test Status |
|---|---|---|---|:---:|
| **Cloudflare** | Slot 1 | `env:CLOUDFLARE_API_TOKEN_1` | `@cf/meta/llama-3.1-8b-instruct` | **`CONNECTIVITY_VERIFIED` (HTTP 200)** |
| **GroqCloud** | Slot 1 | `env:GROQ_API_KEY_1` | `qwen/qwen3.8-27b` / `openai/gpt-oss-20b` | **`CONNECTIVITY_VERIFIED` (HTTP 200)** |
| **GroqCloud** | Slot 2 | `env:GROQ_API_KEY_2` | `qwen/qwen3.8-27b` / `openai/gpt-oss-20b` | **`CONNECTIVITY_VERIFIED` (HTTP 200)** |
| **GroqCloud** | Slot 3 | `env:GROQ_API_KEY_3` | `qwen/qwen3.8-27b` / `openai/gpt-oss-20b` | **`CONNECTIVITY_VERIFIED` (HTTP 200)** |
| **GroqCloud** | Slot 4 | `env:GROQ_API_KEY_4` | `qwen/qwen3.8-27b` / `openai/gpt-oss-20b` | **`CONNECTIVITY_VERIFIED` (HTTP 200)** |
| **GroqCloud** | Slot 5 | `env:GROQ_API_KEY_5` | `qwen/qwen3.8-27b` / `openai/gpt-oss-20b` | **`CONNECTIVITY_VERIFIED` (HTTP 200)** |
| **Gemini** | Slot 1 | `env:GEMINI_API_KEY_1` | `models/gemini-3.8-flash` | **`CONNECTIVITY_VERIFIED` (HTTP 200)** |
| **Gemini** | Slot 2 | `env:GEMINI_API_KEY_2` | `models/gemini-3.8-flash` | **`CONNECTIVITY_VERIFIED` (HTTP 200)** |
| **Gemini** | Slot 3 | `env:GEMINI_API_KEY_3` | `models/gemini-3.8-flash` | **`CONNECTIVITY_VERIFIED` (HTTP 200)** |
| **Gemini** | Slot 4 | `env:GEMINI_API_KEY_4` | `models/gemini-3.8-flash` | **`CONNECTIVITY_VERIFIED` (HTTP 200)** |
| **Gemini** | Slot 5 | `env:GEMINI_API_KEY_5` | `models/gemini-3.8-flash` | **`CONNECTIVITY_VERIFIED` (HTTP 200)** |
| **OpenRouter** | Slot 1 | `env:OPENROUTER_API_KEY_1` | `liquid/lfm-2.5-2.6b:free` | **`CONNECTIVITY_VERIFIED` (HTTP 200)** |
| **OpenRouter** | Slot 2 | `env:OPENROUTER_API_KEY_2` | `liquid/lfm-2.5-2.6b:free` | **`COOLDOWN` (HTTP 429 Upstream)** |
| **OpenRouter** | Slot 3 | `env:OPENROUTER_API_KEY_3` | `liquid/lfm-2.5-2.6b:free` | **`CONNECTIVITY_VERIFIED` (HTTP 200)** |
| **OpenRouter** | Slot 4 | `env:OPENROUTER_API_KEY_4` | `liquid/lfm-2.5-2.6b:free` | **`CONNECTIVITY_VERIFIED` (HTTP 200)** |
| **OpenRouter** | Slot 5 | `env:OPENROUTER_API_KEY_5` | `liquid/lfm-2.5-2.6b:free` | **`CONNECTIVITY_VERIFIED` (HTTP 200)** |


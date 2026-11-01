# AI-Execution-Engine — API Resource Onboarding Runbook

**Milestone:** M4 (Resource Intelligence & Free Resource Optimization)  
**Governing Authority:** `docs/M4_MASTER_EXECUTION_PLAN.md`, ADR-023 (Cryptographic Secret Isolation), ADR-072, ADR-104  
**Date:** 2026-10-16  
**Auditor:** API Resource Research & Onboarding Lead  

---

## 1. Security & Operational Mandates

> [!CAUTION]
> **Strict Non-Negotiable Security Rules:**
> 1. **Zero Secret Leaks:** Never paste live API keys, tokens, or passwords into chat, git commits, terminal logs, or public reports.
> 2. **Environment Variable Isolation:** Secrets must reside strictly in a local `.env` file or operating system environment variables.
> 3. **Secret Redaction:** Logs must only print sanitized strings (e.g., `sk-***[redacted]`).
> 4. **Zero Silent Spend:** All initial connectivity probes must target strictly free models/endpoints to prevent any unexpected billing.

---

## 2. Local Environment Setup & `.gitignore` Guard

Before adding any secrets, ensure git ignores sensitive files.

### Step 2.1: Verify `.gitignore`
Ensure `.gitignore` contains the following lines:
```gitignore
# Environment & Secrets
.env
.env.*
!.env.example

# Node dependencies & outputs
node_modules/
dist/
coverage/
```

### Step 2.2: Local `.env` Configuration Template
Create or update your local `.env` file in the project root:
```bash
# PostgreSQL Database
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ai_execution_engine

# --- Tier 1 Free Providers ---
# Google Gemini API (https://aistudio.google.com/app/apikey)
GEMINI_API_KEY=your_gemini_api_key_here

# GroqCloud (https://console.groq.com/keys)
GROQ_API_KEY=gsk_your_groq_api_key_here

# --- Tier 2 Free Providers ---
# Cloudflare Workers AI (https://dash.cloudflare.com/)
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id_here
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token_here

# OpenRouter (https://openrouter.ai/keys)
OPENROUTER_API_KEY=sk-or-v1-your_openrouter_api_key_here

# --- Tier 3 Sandbox / Evaluation Providers ---
# Mistral AI (https://console.mistral.ai/api-keys/)
MISTRAL_API_KEY=your_mistral_api_key_here

# NVIDIA NIM (https://build.nvidia.com/)
NVIDIA_API_KEY=nvapi-your_nvidia_api_key_here
```

---

## 3. Safe Local Connectivity Verification Scripts

Below are standalone, safe TypeScript/Node verification scripts. Each script:
- Reads credentials directly from environment variables.
- Executes a single, minimal prompt (`"ping"` or `"test"`).
- Prints only HTTP status, latency, and token count.
- Never prints the secret key.

You can run these scripts using `npx tsx scripts/verify_<provider>.ts`.

---

### Probe 1: Google Gemini API (Native Adapter & REST Probe)
```typescript
// scripts/verify_gemini.ts
import { config } from "../src/config/env.js";

async function verifyGemini() {
  const apiKey = config.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.startsWith("simulated-")) {
    console.error("❌ FAILED: GEMINI_API_KEY is missing or configured with a simulated key.");
    process.exit(1);
  }

  const model = "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const startTime = Date.now();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Respond with the single word: PONG" }] }],
        generationConfig: { maxOutputTokens: 10, temperature: 0.0 }
      })
    });

    const latencyMs = Date.now() - startTime;
    if (!res.ok) {
      console.error(`❌ HTTP ${res.status} ${res.statusText}`);
      const errText = await res.text();
      console.error("Error payload:", errText);
      process.exit(1);
    }

    const data = await res.json() as any;
    const output = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    console.log(`✅ Gemini Connectivity Verified!`);
    console.log(`   Model: ${model}`);
    console.log(`   Response: "${output}"`);
    console.log(`   Latency: ${latencyMs}ms`);
    console.log(`   Usage: Prompt Tokens = ${data?.usageMetadata?.promptTokenCount}, Output Tokens = ${data?.usageMetadata?.candidatesTokenCount}`);
  } catch (err: any) {
    console.error("❌ Network or Execution Failure:", err.message);
  }
}

verifyGemini();
```

---

### Probe 2: GroqCloud Connectivity Probe
```typescript
// scripts/verify_groq.ts
async function verifyGroq() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error("❌ FAILED: GROQ_API_KEY is not set in environment.");
    process.exit(1);
  }

  const url = "https://api.groq.com/openai/v1/chat/completions";
  const model = "llama-3.1-8b-instant";
  const startTime = Date.now();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Respond with the single word: PONG" }],
        max_tokens: 10,
        temperature: 0.0
      })
    });

    const latencyMs = Date.now() - startTime;
    if (!res.ok) {
      console.error(`❌ HTTP ${res.status} ${res.statusText}`);
      console.error(await res.text());
      process.exit(1);
    }

    const data = await res.json() as any;
    const output = data.choices?.[0]?.message?.content?.trim();
    console.log(`✅ Groq Connectivity Verified!`);
    console.log(`   Model: ${model}`);
    console.log(`   Response: "${output}"`);
    console.log(`   Latency: ${latencyMs}ms`);
    console.log(`   Rate Limits Remaining (RPM): ${res.headers.get("x-ratelimit-remaining-requests")}`);
    console.log(`   Rate Limits Remaining (TPM): ${res.headers.get("x-ratelimit-remaining-tokens")}`);
  } catch (err: any) {
    console.error("❌ Network or Execution Failure:", err.message);
  }
}

verifyGroq();
```

---

### Probe 3: Cloudflare Workers AI Connectivity Probe
```typescript
// scripts/verify_cloudflare.ts
async function verifyCloudflare() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !apiToken) {
    console.error("❌ FAILED: CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN is missing.");
    process.exit(1);
  }

  const model = "@cf/meta/llama-3.1-8b-instruct";
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
  const startTime = Date.now();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt: "Respond with the single word: PONG",
        max_tokens: 10
      })
    });

    const latencyMs = Date.now() - startTime;
    if (!res.ok) {
      console.error(`❌ HTTP ${res.status} ${res.statusText}`);
      console.error(await res.text());
      process.exit(1);
    }

    const data = await res.json() as any;
    console.log(`✅ Cloudflare Workers AI Verified!`);
    console.log(`   Model: ${model}`);
    console.log(`   Response: "${data?.result?.response?.trim()}"`);
    console.log(`   Latency: ${latencyMs}ms`);
  } catch (err: any) {
    console.error("❌ Network or Execution Failure:", err.message);
  }
}

verifyCloudflare();
```

---

### Probe 4: OpenRouter Free Models Connectivity Probe
```typescript
// scripts/verify_openrouter.ts
async function verifyOpenRouter() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("❌ FAILED: OPENROUTER_API_KEY is not set in environment.");
    process.exit(1);
  }

  // 1. First probe key status & quota limits
  const keyRes = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { "Authorization": `Bearer ${apiKey}` }
  });
  if (keyRes.ok) {
    const keyData = await keyRes.json() as any;
    console.log(`🔑 OpenRouter Key Label: ${keyData?.data?.label}`);
    console.log(`   Credit Limit: ${keyData?.data?.limit ?? "Unlimited"}`);
    console.log(`   Credit Usage: ${keyData?.data?.usage}`);
    console.log(`   Free Tier RPD Limit: ${keyData?.data?.is_free_tier ? "50 RPD" : "1000+ RPD"}`);
  }

  // 2. Probe minimal free model completion
  const url = "https://openrouter.ai/api/v1/chat/completions";
  const model = "meta-llama/llama-3.2-3b-instruct:free";
  const startTime = Date.now();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": "https://github.com/AI-Execution-Engine",
        "X-Title": "AI-Execution-Engine-Audit"
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Respond with the single word: PONG" }],
        max_tokens: 10,
        temperature: 0.0
      })
    });

    const latencyMs = Date.now() - startTime;
    if (!res.ok) {
      console.error(`❌ HTTP ${res.status} ${res.statusText}`);
      console.error(await res.text());
      process.exit(1);
    }

    const data = await res.json() as any;
    console.log(`✅ OpenRouter Free Endpoint Verified!`);
    console.log(`   Model: ${model}`);
    console.log(`   Response: "${data.choices?.[0]?.message?.content?.trim()}"`);
    console.log(`   Latency: ${latencyMs}ms`);
  } catch (err: any) {
    console.error("❌ Network or Execution Failure:", err.message);
  }
}

verifyOpenRouter();
```

---

## 4. Verification Lifecycle Progression Rules

To advance a resource through the qualification lifecycle:

```mermaid
flowchart LR
    D[DISCOVERED] --> DV[DOCUMENTATION_VERIFIED]
    DV --> CC[CREDENTIAL_CONFIGURED]
    CC --> CV[CONNECTIVITY_VERIFIED]
    CV --> CT[CAPABILITY_TESTED]
    CT --> QV[QUOTA_VERIFIED]
    QV --> IT[INTEGRATION_TESTED]
    IT --> PC[PRODUCTION_CANDIDATE]
```

1. **`DISCOVERED`:** Candidate service identified and recorded.
2. **`DOCUMENTATION_VERIFIED`:** Official docs, endpoints, rate limits, and billing terms verified and logged in `API_RESOURCE_EVIDENCE_LEDGER.md`.
3. **`CREDENTIAL_CONFIGURED`:** Developer adds secret to `.env` locally (zero secrets in chat).
4. **`CONNECTIVITY_VERIFIED`:** Safe ping probe succeeds with HTTP 200 and normalized output.
5. **`CAPABILITY_TESTED`:** JSON output, reasoning, context length, or tool calling evaluated with a standardized task suite.
6. **`QUOTA_VERIFIED`:** Rate-limiting behavior and header reset timings observed under controlled load.
7. **`INTEGRATION_TESTED`:** Resource wired through `ProviderAdapter` and registered in `resources.resources` with full worker FSM lifecycle.
8. **`PRODUCTION_CANDIDATE`:** Zero regressions across all test suites, passing all economic and truth invariants (ADR-072, ADR-104).

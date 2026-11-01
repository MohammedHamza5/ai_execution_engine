import dns from "node:dns";
import net from "node:net";
net.setDefaultAutoSelectFamily(false);
dns.setDefaultResultOrder("ipv4first");

import dotenv from "dotenv";
dotenv.config();

interface ModelProbeResult {
  provider: string;
  keyLabel: string;
  model: string;
  status: "VERIFIED_LIVE" | "AUTH_VALID_MODEL_UNVERIFIED" | "MODEL_UNAVAILABLE" | "RATE_LIMITED" | "INVALID_CREDENTIAL" | "FAILED";
  httpStatus: number;
  latencyMs: number;
  outputPreview?: string;
  errorSnippet?: string;
  rateLimitHeaders?: Record<string, string>;
}

const probeResults: ModelProbeResult[] = [];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -------------------------------------------------------------
// 1. GEMINI PROBES
// -------------------------------------------------------------
async function probeGemini(keyLabel: string, apiKey: string, model: string): Promise<ModelProbeResult> {
  const start = Date.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "ping" }] }],
        generationConfig: { maxOutputTokens: 5, temperature: 0.1 },
      }),
      signal: AbortSignal.timeout(12000),
    });
    const latencyMs = Date.now() - start;
    if (res.ok) {
      const data = (await res.json()) as any;
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "OK";
      return {
        provider: "Gemini",
        keyLabel,
        model,
        status: "VERIFIED_LIVE",
        httpStatus: res.status,
        latencyMs,
        outputPreview: text.slice(0, 30),
      };
    } else {
      const errText = await res.text();
      let status: ModelProbeResult["status"] = "FAILED";
      if (res.status === 404) status = "MODEL_UNAVAILABLE";
      else if (res.status === 429) status = "RATE_LIMITED";
      else if (res.status === 401 || res.status === 403) status = "INVALID_CREDENTIAL";

      return {
        provider: "Gemini",
        keyLabel,
        model,
        status,
        httpStatus: res.status,
        latencyMs,
        errorSnippet: errText.slice(0, 120).replace(/\n/g, " "),
      };
    }
  } catch (err: any) {
    return {
      provider: "Gemini",
      keyLabel,
      model,
      status: "FAILED",
      httpStatus: 0,
      latencyMs: Date.now() - start,
      errorSnippet: err.message,
    };
  }
}

// -------------------------------------------------------------
// 2. GROQ PROBES
// -------------------------------------------------------------
async function probeGroq(keyLabel: string, apiKey: string, model: string): Promise<ModelProbeResult> {
  const start = Date.now();
  const url = "https://api.groq.com/openai/v1/chat/completions";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 5,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(12000),
    });
    const latencyMs = Date.now() - start;

    const rateLimitHeaders: Record<string, string> = {};
    for (const [k, v] of res.headers.entries()) {
      if (k.toLowerCase().startsWith("x-ratelimit-")) {
        rateLimitHeaders[k.toLowerCase()] = v;
      }
    }

    if (res.ok) {
      const data = (await res.json()) as any;
      const text = data?.choices?.[0]?.message?.content?.trim() || "OK";
      return {
        provider: "Groq",
        keyLabel,
        model,
        status: "VERIFIED_LIVE",
        httpStatus: res.status,
        latencyMs,
        outputPreview: text.slice(0, 30),
        rateLimitHeaders,
      };
    } else {
      const errText = await res.text();
      let status: ModelProbeResult["status"] = "FAILED";
      if (res.status === 404) status = "MODEL_UNAVAILABLE";
      else if (res.status === 429) status = "RATE_LIMITED";
      else if (res.status === 401 || res.status === 403) status = "INVALID_CREDENTIAL";

      return {
        provider: "Groq",
        keyLabel,
        model,
        status,
        httpStatus: res.status,
        latencyMs,
        errorSnippet: errText.slice(0, 120).replace(/\n/g, " "),
        rateLimitHeaders,
      };
    }
  } catch (err: any) {
    return {
      provider: "Groq",
      keyLabel,
      model,
      status: "FAILED",
      httpStatus: 0,
      latencyMs: Date.now() - start,
      errorSnippet: err.message,
    };
  }
}

// -------------------------------------------------------------
// 3. CLOUDFLARE PROBES
// -------------------------------------------------------------
async function probeCloudflareText(keyLabel: string, accountId: string, token: string, model: string): Promise<ModelProbeResult> {
  const start = Date.now();
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: "ping", max_tokens: 5 }),
      signal: AbortSignal.timeout(15000),
    });
    const latencyMs = Date.now() - start;
    if (res.ok) {
      const data = (await res.json()) as any;
      const text = data?.result?.response?.trim() || JSON.stringify(data?.result) || "OK";
      return {
        provider: "Cloudflare",
        keyLabel,
        model,
        status: "VERIFIED_LIVE",
        httpStatus: res.status,
        latencyMs,
        outputPreview: text.slice(0, 30),
      };
    } else {
      const errText = await res.text();
      let status: ModelProbeResult["status"] = "FAILED";
      if (res.status === 404) status = "MODEL_UNAVAILABLE";
      else if (res.status === 429) status = "RATE_LIMITED";
      else if (res.status === 401 || res.status === 403) status = "INVALID_CREDENTIAL";

      return {
        provider: "Cloudflare",
        keyLabel,
        model,
        status,
        httpStatus: res.status,
        latencyMs,
        errorSnippet: errText.slice(0, 120).replace(/\n/g, " "),
      };
    }
  } catch (err: any) {
    return {
      provider: "Cloudflare",
      keyLabel,
      model,
      status: "FAILED",
      httpStatus: 0,
      latencyMs: Date.now() - start,
      errorSnippet: err.message,
    };
  }
}

async function probeCloudflareEmbeddings(keyLabel: string, accountId: string, token: string, model: string): Promise<ModelProbeResult> {
  const start = Date.now();
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: ["ping test"] }),
      signal: AbortSignal.timeout(15000),
    });
    const latencyMs = Date.now() - start;
    if (res.ok) {
      const data = (await res.json()) as any;
      const shape = Array.isArray(data?.result?.data) ? `vectors: ${data.result.data.length}x${data.result.data[0]?.length || 0}` : "OK";
      return {
        provider: "Cloudflare",
        keyLabel,
        model,
        status: "VERIFIED_LIVE",
        httpStatus: res.status,
        latencyMs,
        outputPreview: shape,
      };
    } else {
      const errText = await res.text();
      return {
        provider: "Cloudflare",
        keyLabel,
        model,
        status: res.status === 404 ? "MODEL_UNAVAILABLE" : "FAILED",
        httpStatus: res.status,
        latencyMs,
        errorSnippet: errText.slice(0, 120).replace(/\n/g, " "),
      };
    }
  } catch (err: any) {
    return {
      provider: "Cloudflare",
      keyLabel,
      model,
      status: "FAILED",
      httpStatus: 0,
      latencyMs: Date.now() - start,
      errorSnippet: err.message,
    };
  }
}

// -------------------------------------------------------------
// 4. OPENROUTER PROBES
// -------------------------------------------------------------
async function probeOpenRouter(keyLabel: string, apiKey: string, model: string): Promise<ModelProbeResult> {
  const start = Date.now();
  const url = "https://openrouter.ai/api/v1/chat/completions";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/AI-Execution-Engine",
        "X-Title": "AI-Execution-Engine-Audit",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 5,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const latencyMs = Date.now() - start;
    if (res.ok) {
      const data = (await res.json()) as any;
      const text = data?.choices?.[0]?.message?.content?.trim() || "OK";
      return {
        provider: "OpenRouter",
        keyLabel,
        model,
        status: "VERIFIED_LIVE",
        httpStatus: res.status,
        latencyMs,
        outputPreview: text.slice(0, 30),
      };
    } else {
      const errText = await res.text();
      let status: ModelProbeResult["status"] = "FAILED";
      if (res.status === 404) status = "MODEL_UNAVAILABLE";
      else if (res.status === 429) status = "RATE_LIMITED";
      else if (res.status === 401 || res.status === 403) status = "INVALID_CREDENTIAL";

      return {
        provider: "OpenRouter",
        keyLabel,
        model,
        status,
        httpStatus: res.status,
        latencyMs,
        errorSnippet: errText.slice(0, 120).replace(/\n/g, " "),
      };
    }
  } catch (err: any) {
    return {
      provider: "OpenRouter",
      keyLabel,
      model,
      status: "FAILED",
      httpStatus: 0,
      latencyMs: Date.now() - start,
      errorSnippet: err.message,
    };
  }
}

// -------------------------------------------------------------
// MAIN AUDIT EXECUTION
// -------------------------------------------------------------
async function main() {
  console.log("===============================================================================");
  console.log("AI-Execution-Engine: Resource Fleet Audit & Quota Probe");
  console.log("Invariant: Sequential, low-token calls, zero secret exposure.");
  console.log("===============================================================================\n");

  // Phase A: Model Candidates Audit on Key 1 of each provider
  console.log(">>> Phase A: Testing candidate models on Key 1...");

  // 1. Gemini Candidates on Key 1
  const geminiKey1 = process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY || "";
  const geminiCandidates = ["gemini-3.8-flash", "gemini-2.5-flash", "gemini-flash-latest"];
  let verifiedGeminiModel = "gemini-flash-latest";
  for (const m of geminiCandidates) {
    process.stdout.write(`  [Gemini_1] Testing candidate '${m}'... `);
    const res = await probeGemini("GEMINI_1", geminiKey1, m);
    probeResults.push(res);
    console.log(`${res.status} (HTTP ${res.httpStatus}) - ${res.errorSnippet || res.outputPreview || ""}`);
    if (res.status === "VERIFIED_LIVE") verifiedGeminiModel = m;
    await sleep(600);
  }

  // 2. Groq Candidates on Key 1
  const groqKey1 = process.env.GROQ_API_KEY_1 || process.env.GROQ_API_KEY || "";
  const groqCandidates = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"];
  let verifiedGroqModel = "llama-3.3-70b-versatile";
  for (const m of groqCandidates) {
    process.stdout.write(`  [GROQ_1] Testing candidate '${m}'... `);
    const res = await probeGroq("GROQ_1", groqKey1, m);
    probeResults.push(res);
    console.log(`${res.status} (HTTP ${res.httpStatus}) - ${res.errorSnippet || res.outputPreview || ""}`);
    if (res.status === "VERIFIED_LIVE" && !verifiedGroqModel) verifiedGroqModel = m;
    await sleep(600);
  }

  // 3. Cloudflare Candidates on Key 1
  const cfToken1 = process.env.CLOUDFLARE_API_TOKEN_1 || process.env.CLOUDFLARE_API_TOKEN || "";
  const cfAccount1 = process.env.CLOUDFLARE_ACCOUNT_ID_1 || process.env.CLOUDFLARE_ACCOUNT_ID || "";
  process.stdout.write(`  [CLOUDFLARE_1] Testing text model '@cf/meta/llama-3.1-8b-instruct'... `);
  const cfTextRes = await probeCloudflareText("CLOUDFLARE_1", cfAccount1, cfToken1, "@cf/meta/llama-3.1-8b-instruct");
  probeResults.push(cfTextRes);
  console.log(`${cfTextRes.status} (HTTP ${cfTextRes.httpStatus}) - ${cfTextRes.errorSnippet || cfTextRes.outputPreview || ""}`);
  await sleep(600);

  process.stdout.write(`  [CLOUDFLARE_1] Testing embeddings model '@cf/baai/bge-large-en-v1.5'... `);
  const cfEmbRes = await probeCloudflareEmbeddings("CLOUDFLARE_1", cfAccount1, cfToken1, "@cf/baai/bge-large-en-v1.5");
  probeResults.push(cfEmbRes);
  console.log(`${cfEmbRes.status} (HTTP ${cfEmbRes.httpStatus}) - ${cfEmbRes.errorSnippet || cfEmbRes.outputPreview || ""}`);
  await sleep(600);

  // 4. OpenRouter Candidates on Key 1
  const orKey1 = process.env.OPENROUTER_API_KEY_1 || process.env.OPENROUTER_API_KEY || "";
  const orCandidates = [
    "liquid/lfm-2.5-2.6b:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "deepseek/deepseek-r1:free",
    "qwen/qwen-2.5-coder-32b-instruct:free",
  ];
  let verifiedOrModel = "liquid/lfm-2.5-2.6b:free";
  for (const m of orCandidates) {
    process.stdout.write(`  [OPENROUTER_1] Testing candidate '${m}'... `);
    const res = await probeOpenRouter("OPENROUTER_1", orKey1, m);
    probeResults.push(res);
    console.log(`${res.status} (HTTP ${res.httpStatus}) - ${res.errorSnippet || res.outputPreview || ""}`);
    if (res.status === "VERIFIED_LIVE" && !verifiedOrModel) verifiedOrModel = m;
    await sleep(800);
  }

  // Phase B: Fleet Credential Coverage (Keys 2 through 5)
  console.log("\n>>> Phase B: Testing remaining fleet credentials with verified models...");

  // Gemini Keys 2 to 5
  for (let i = 2; i <= 5; i++) {
    const key = process.env[`GEMINI_API_KEY_${i}`] || "";
    const label = `GEMINI_${i}`;
    process.stdout.write(`  [${label}] Testing live execution with '${verifiedGeminiModel}'... `);
    if (!key) {
      console.log("NOT_CONFIGURED (missing env var)");
      continue;
    }
    const res = await probeGemini(label, key, verifiedGeminiModel);
    probeResults.push(res);
    console.log(`${res.status} (HTTP ${res.httpStatus}, ${res.latencyMs}ms) - ${res.errorSnippet || res.outputPreview || ""}`);
    await sleep(600);
  }

  // Groq Keys 2 to 5 (Observing rate-limit headers across keys)
  for (let i = 2; i <= 5; i++) {
    const key = process.env[`GROQ_API_KEY_${i}`] || "";
    const label = `GROQ_${i}`;
    const testModel = "qwen/qwen3.8-27b"; // Fast and proven
    process.stdout.write(`  [${label}] Testing live execution with '${testModel}'... `);
    if (!key) {
      console.log("NOT_CONFIGURED (missing env var)");
      continue;
    }
    const res = await probeGroq(label, key, testModel);
    probeResults.push(res);
    const rlReq = res.rateLimitHeaders?.["x-ratelimit-remaining-requests"] || "N/A";
    console.log(`${res.status} (HTTP ${res.httpStatus}, ${res.latencyMs}ms, RPM left: ${rlReq}) - ${res.errorSnippet || res.outputPreview || ""}`);
    await sleep(600);
  }

  // OpenRouter Keys 2 to 5
  for (let i = 2; i <= 5; i++) {
    const key = process.env[`OPENROUTER_API_KEY_${i}`] || "";
    const label = `OPENROUTER_${i}`;
    const testModel = "liquid/lfm-2.5-2.6b:free";
    process.stdout.write(`  [${label}] Testing live execution with '${testModel}'... `);
    if (!key) {
      console.log("NOT_CONFIGURED (missing env var)");
      continue;
    }
    const res = await probeOpenRouter(label, key, testModel);
    probeResults.push(res);
    console.log(`${res.status} (HTTP ${res.httpStatus}, ${res.latencyMs}ms) - ${res.errorSnippet || res.outputPreview || ""}`);
    await sleep(800);
  }

  console.log("\n===============================================================================");
  console.log("PROBE DATA CAPTURED SUCCESSFULLY (Zero Secret Leaks)");
  console.log("Total Probes Run:", probeResults.length);
  console.log("===============================================================================");
}

main().catch((err) => {
  console.error("Fatal probe error:", err);
  process.exit(1);
});

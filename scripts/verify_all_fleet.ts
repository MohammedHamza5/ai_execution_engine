import dns from "node:dns";
import net from "node:net";
net.setDefaultAutoSelectFamily(false);
dns.setDefaultResultOrder("ipv4first");

import dotenv from "dotenv";
dotenv.config();

interface TestResult {
  provider: string;
  keyLabel: string;
  status: "SUCCESS" | "FAILED";
  httpStatus?: number;
  latencyMs?: number;
  message?: string;
}

const results: TestResult[] = [];

// 1. Cloudflare
async function testCloudflare() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID_1 || process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN_1 || process.env.CLOUDFLARE_API_TOKEN;

  const startTime = Date.now();
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt: "Reply PONG", max_tokens: 5 }),
        signal: AbortSignal.timeout(10000),
      }
    );
    const latencyMs = Date.now() - startTime;
    if (res.ok) {
      console.log(`[PASS] Cloudflare Key 1 OK (${latencyMs}ms)`);
      results.push({ provider: "Cloudflare", keyLabel: "CLOUDFLARE_KEY_1", status: "SUCCESS", httpStatus: res.status, latencyMs, message: "Model: @cf/meta/llama-3.1-8b-instruct" });
    } else {
      console.log(`[FAIL] Cloudflare Key 1 HTTP ${res.status}`);
      results.push({ provider: "Cloudflare", keyLabel: "CLOUDFLARE_KEY_1", status: "FAILED", httpStatus: res.status, latencyMs });
    }
  } catch (err: any) {
    console.log(`[ERR] Cloudflare Key 1: ${err.message}`);
    results.push({ provider: "Cloudflare", keyLabel: "CLOUDFLARE_KEY_1", status: "FAILED", message: err.message });
  }
}

// 2. Gemini
async function testGeminiKey(index: number) {
  const label = `GEMINI_KEY_${index}`;
  const key = process.env[`GEMINI_API_KEY_${index}`];

  const startTime = Date.now();
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${encodeURIComponent(key!)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Reply PONG" }] }],
        generationConfig: { maxOutputTokens: 5, temperature: 0.1 },
      }),
      signal: AbortSignal.timeout(15000),
    });
    const latencyMs = Date.now() - startTime;
    if (res.ok) {
      console.log(`[PASS] ${label} OK (${latencyMs}ms)`);
      results.push({ provider: "Gemini", keyLabel: label, status: "SUCCESS", httpStatus: res.status, latencyMs, message: "Model: gemini-flash-latest" });
    } else {
      console.log(`[FAIL] ${label} HTTP ${res.status}`);
      const err = await res.text();
      results.push({ provider: "Gemini", keyLabel: label, status: "FAILED", httpStatus: res.status, latencyMs, message: err.slice(0, 100) });
    }
  } catch (err: any) {
    console.log(`[ERR] ${label}: ${err.message}`);
    results.push({ provider: "Gemini", keyLabel: label, status: "FAILED", message: err.message });
  }
}

// 3. Groq
async function testGroqKey(index: number) {
  const label = `GROQ_KEY_${index}`;
  const key = process.env[`GROQ_API_KEY_${index}`];

  const startTime = Date.now();
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen/qwen3.8-27b",
        messages: [{ role: "user", content: "Reply PONG" }],
        max_tokens: 5,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const latencyMs = Date.now() - startTime;
    if (res.ok) {
      const remReq = res.headers.get("x-ratelimit-remaining-requests") || "N/A";
      console.log(`[PASS] ${label} OK (${latencyMs}ms, RPM left: ${remReq})`);
      results.push({
        provider: "Groq",
        keyLabel: label,
        status: "SUCCESS",
        httpStatus: res.status,
        latencyMs,
        message: `Model: qwen/qwen3.8-27b | RPM Left: ${remReq}`,
      });
    } else {
      console.log(`[FAIL] ${label} HTTP ${res.status}`);
      const err = await res.text();
      results.push({ provider: "Groq", keyLabel: label, status: "FAILED", httpStatus: res.status, latencyMs, message: err.slice(0, 100) });
    }
  } catch (err: any) {
    console.log(`[ERR] ${label}: ${err.message}`);
    results.push({ provider: "Groq", keyLabel: label, status: "FAILED", message: err.message });
  }
}

// 4. OpenRouter
async function testOpenRouterKey(index: number) {
  const label = `OPENROUTER_KEY_${index}`;
  const key = process.env[`OPENROUTER_API_KEY_${index}`];

  const startTime = Date.now();
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/AI-Execution-Engine",
        "X-Title": "AI-Execution-Engine-Fleet-Audit",
      },
      body: JSON.stringify({
        model: "liquid/lfm-2.5-2.6b:free",
        messages: [{ role: "user", content: "Reply PONG" }],
        max_tokens: 5,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const latencyMs = Date.now() - startTime;
    if (res.ok) {
      console.log(`[PASS] ${label} OK (${latencyMs}ms)`);
      results.push({
        provider: "OpenRouter",
        keyLabel: label,
        status: "SUCCESS",
        httpStatus: res.status,
        latencyMs,
        message: "Model: liquid/lfm-2.5-2.6b:free",
      });
    } else {
      console.log(`[FAIL] ${label} HTTP ${res.status}`);
      const err = await res.text();
      results.push({ provider: "OpenRouter", keyLabel: label, status: "FAILED", httpStatus: res.status, latencyMs, message: err.slice(0, 100) });
    }
  } catch (err: any) {
    console.log(`[ERR] ${label}: ${err.message}`);
    results.push({ provider: "OpenRouter", keyLabel: label, status: "FAILED", message: err.message });
  }
}

async function runFleetAudit() {
  console.log("=== Starting Parallel Fleet Audit Across All 16 Keys ===");

  const tasks: Promise<void>[] = [
    testCloudflare(),
    testGeminiKey(1),
    testGeminiKey(2),
    testGeminiKey(3),
    testGeminiKey(4),
    testGeminiKey(5),
    testGroqKey(1),
    testGroqKey(2),
    testGroqKey(3),
    testGroqKey(4),
    testGroqKey(5),
    testOpenRouterKey(1),
    testOpenRouterKey(2),
    testOpenRouterKey(3),
    testOpenRouterKey(4),
    testOpenRouterKey(5),
  ];

  await Promise.all(tasks);

  console.log("\n=================== AUDIT RESULTS SUMMARY ===================");
  console.table(
    results.map((r) => ({
      Provider: r.provider,
      Key: r.keyLabel,
      Status: r.status,
      HTTP: r.httpStatus ?? "N/A",
      "Latency (ms)": r.latencyMs ?? "N/A",
      Details: r.message ?? "OK",
    }))
  );
}

runFleetAudit();

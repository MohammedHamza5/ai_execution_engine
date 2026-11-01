import dns from "node:dns";
import net from "node:net";
net.setDefaultAutoSelectFamily(false);
dns.setDefaultResultOrder("ipv4first");

import dotenv from "dotenv";
dotenv.config();

async function testCloudflare() {
  console.log("=== Testing Cloudflare Credentials ===");
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !token) {
    console.log("❌ Cloudflare credentials missing from .env");
    return;
  }

  try {
    // 1. Verify token
    const verifyRes = await fetch(
      `https://api.cloudflare.com/client/v4/user/tokens/verify`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    const verifyData = (await verifyRes.json()) as any;
    console.log("Token Verify HTTP Status:", verifyRes.status);
    console.log("Token Verify Result:", JSON.stringify(verifyData.messages || verifyData.errors));

    // 2. Test inference run with Llama 3.1 8B Instruct
    const model = "@cf/meta/llama-3.1-8b-instruct";
    const startTime = Date.now();
    const runRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: "Respond with the single word PONG",
          max_tokens: 10,
        }),
      }
    );

    const latencyMs = Date.now() - startTime;
    console.log("Workers AI Model Run HTTP Status:", runRes.status);
    const runData = (await runRes.json()) as any;
    if (runRes.ok) {
      console.log(`✅ Cloudflare Workers AI Succeeded! (Latency: ${latencyMs}ms)`);
      console.log("   Output:", JSON.stringify(runData?.result?.response || runData?.result));
    } else {
      console.log("❌ Cloudflare Run Error:", JSON.stringify(runData.errors || runData));
    }
  } catch (err: any) {
    console.log("❌ Cloudflare Exception:", err.message);
  }
}

async function testGemini() {
  console.log("\n=== Testing Gemini API Key ===");
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.log("❌ GEMINI_API_KEY missing from .env");
    return;
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(
      key
    )}`;
    const startTime = Date.now();
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Respond with the single word PONG" }] }],
        generationConfig: { maxOutputTokens: 10 },
      }),
    });

    const latencyMs = Date.now() - startTime;
    console.log("Gemini API HTTP Status:", res.status);
    const text = await res.text();
    if (res.ok) {
      const data = JSON.parse(text);
      console.log(`✅ Gemini API Succeeded! (Latency: ${latencyMs}ms)`);
      console.log(
        "   Output:",
        data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
      );
    } else {
      console.log("❌ Gemini Error Response:", text);
    }
  } catch (err: any) {
    console.log("❌ Gemini Exception:", err.message);
  }
}

async function main() {
  await testCloudflare();
  await testGemini();
}

main();

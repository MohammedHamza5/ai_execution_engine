import dotenv from "dotenv";
dotenv.config();

import { GeminiProviderAdapter } from "../src/adapters/geminiAdapter.js";
import { GroqProviderAdapter } from "../src/adapters/groqAdapter.js";
import { CloudflareProviderAdapter } from "../src/adapters/cloudflareAdapter.js";
import { OpenRouterProviderAdapter } from "../src/adapters/openrouterAdapter.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";

async function verifyProviders() {
  console.log("=== AI-Execution-Engine: Safe Live Provider Probe ===");
  console.log("Invariant: Zero secret leaks, max 10 tokens, free models only.\n");

  const probePrompt = "Respond with one word: Ready.";
  const probeConfigs = [
    {
      name: "Google Gemini",
      slug: "gemini",
      adapter: new GeminiProviderAdapter(),
      model: "gemini-1.5-flash",
      key: process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY,
    },
    {
      name: "Groq",
      slug: "groq",
      adapter: new GroqProviderAdapter(),
      model: "llama-3.1-8b-instant",
      key: process.env.GROQ_API_KEY_1 || process.env.GROQ_API_KEY,
    },
    {
      name: "Cloudflare Workers AI",
      slug: "cloudflare",
      adapter: new CloudflareProviderAdapter(),
      model: "@cf/meta/llama-3-8b-instruct",
      key: process.env.CLOUDFLARE_API_TOKEN_1 || process.env.CLOUDFLARE_API_TOKEN,
    },
    {
      name: "OpenRouter (Free)",
      slug: "openrouter",
      adapter: new OpenRouterProviderAdapter(),
      model: "meta-llama/llama-3.1-8b-instruct:free",
      key: process.env.OPENROUTER_API_KEY_1 || process.env.OPENROUTER_API_KEY,
    },
  ];

  for (const p of probeConfigs) {
    if (!p.key || p.key.startsWith("simulated-")) {
      console.log(`[${p.name}] SKIPPED — No live API key configured.`);
      continue;
    }

    process.stdout.write(`[${p.name}] Probing model '${p.model}'... `);
    const start = Date.now();
    try {
      const response = await p.adapter.execute(
        {
          requestId: generateUUIDv7(),
          taskId: generateUUIDv7(),
          stepId: generateUUIDv7(),
          attemptId: generateUUIDv7(),
          resourceId: `probe-${p.slug}`,
          modelId: p.model,
          prompt: probePrompt,
          parameters: { maxOutputTokens: 10, temperature: 0.1 },
        },
        p.key
      );
      const elapsed = Date.now() - start;
      const preview = response.outputText.trim().replace(/\n/g, " ").slice(0, 30);
      console.log(`SUCCESS (${elapsed}ms) | Output: "${preview}" | Tokens: ${response.usage.totalTokens}`);
    } catch (err: any) {
      const elapsed = Date.now() - start;
      console.log(`FAILED (${elapsed}ms) | Error: [${err.code || "ERR"}] ${err.message || String(err)}`);
    }
  }

  console.log("\nLive provider probe completed.");
}

verifyProviders().catch((err) => {
  console.error("Probe runner error:", err);
  process.exit(1);
});

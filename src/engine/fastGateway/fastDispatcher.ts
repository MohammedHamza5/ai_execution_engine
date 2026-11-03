import { ChatCompletionRequest, ChatCompletionResponse, ProviderCandidate } from "./types.js";
import { keyPoolManager } from "./keyPoolManager.js";
import { CognitiveIntentAnalyzer } from "./intentAnalyzer.js";
import { swarmSmoother } from "./swarmConcurrencySmoother.js";
import { ProviderAdapterRegistry } from "../../adapters/adapterRegistry.js";
import { generateUUIDv7 } from "../../domain/common/id.js";

const registry = new ProviderAdapterRegistry(true);

export class FastInferenceDispatcher {
  public static async dispatch(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const modelHint = req.model || req.models?.[0] || "auto";
    const isJson = req.response_format?.type === "json_object";
    const prompt = this.formatPrompt(req);
    const chain = this.buildCandidateChain(modelHint, req);
    let lastError: Error | null = null;

    for (const candidate of chain) {
      const adapter = registry.getAdapter(candidate.provider);
      if (!adapter) continue;

      try {
        const result = await swarmSmoother.schedule(candidate.provider, async (keyInfo) => {
          const reqId = generateUUIDv7();
          try {
            return await adapter.execute(
              {
                requestId: reqId,
                taskId: reqId,
                stepId: reqId,
                attemptId: reqId,
                resourceId: reqId,
                modelId: candidate.model,
                prompt,
                parameters: {
                  temperature: req.temperature ?? 0.7,
                  maxOutputTokens: req.max_tokens ?? 2048,
                  responseFormat: isJson ? "json" : "text",
                  ...(candidate.provider === "cloudflare" && keyInfo.accountId ? { accountId: keyInfo.accountId } : {}),
                } as any,
              },
              keyInfo.apiKey
            );
          } catch (execErr: any) {
            const msg = String(execErr?.message || "").toLowerCase();
            if (msg.includes("rate") || msg.includes("429") || msg.includes("quota")) {
              keyPoolManager.markCooldown(candidate.provider, keyInfo.apiKey, 60_000);
            }
            throw execErr;
          }
        });

        return {
          id: `chatcmpl-${generateUUIDv7()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: `${candidate.provider}/${candidate.model}`,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: result.outputText },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: result.usage.inputTokens,
            completion_tokens: result.usage.outputTokens,
            total_tokens: result.usage.totalTokens,
          },
        };
      } catch (err: any) {
        lastError = err;
      }
    }

    throw new Error(`All provider tiers failed in FastInferenceDispatcher. Last error: ${lastError?.message || "No keys available"}`);
  }

  private static formatPrompt(req: ChatCompletionRequest): string {
    const messages = req.messages || [];
    let text = "";
    if (messages.length === 1 && messages[0].role === "user") {
      text = messages[0].content;
    } else {
      text = messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n") + "\n\nASSISTANT:";
    }
    if (req.response_format?.type === "json_object" && !/json/i.test(text)) {
      text += "\n\n(Respond with a valid JSON object)";
    }
    return text;
  }

  public static buildCandidateChain(modelHint?: string, req?: ChatCompletionRequest): ProviderCandidate[] {
    const hint = (modelHint || "auto").toLowerCase();

    // Guard: Redirect Subscription-Only models to high-capacity free titans
    const subscriptionOnlySlugs = ["claude-sonnet", "claude-opus", "mimo-v2.6", "minimax-m3", "hy4"];
    if (subscriptionOnlySlugs.some(s => hint.includes(s))) {
      return [
        { provider: "apinex", model: "free/qwen-3.8-max", apiKey: "" },
        { provider: "apinex", model: "free/deepseek-v4.1-flash", apiKey: "" },
        { provider: "groq", model: "llama-3.3-70b-versatile", apiKey: "" },
      ];
    }

    // 1. Direct Next-Gen Apinex 2026 Free Titans (Highest Priority when requested)
    if (hint.startsWith("free/") || hint.includes("apinex")) {
      const targetModel = hint.startsWith("free/") ? hint : `free/${hint.replace("apinex/", "")}`;
      return [
        { provider: "apinex", model: targetModel, apiKey: "" },
        { provider: "groq", model: "llama-3.3-70b-versatile", apiKey: "" },
        { provider: "gemini", model: "gemini-1.5-flash", apiKey: "" },
      ];
    }

    // 2. Explicit Model Family Overrides
    if (hint.includes("qwen")) {
      return [
        { provider: "apinex", model: "free/qwen-3.8-max", apiKey: "" },
        { provider: "groq", model: "qwen/qwen3.8-27b", apiKey: "" },
        { provider: "groq", model: "llama-3.3-70b-versatile", apiKey: "" },
      ];
    }
    if (hint.includes("glm")) {
      return [
        { provider: "apinex", model: "free/glm-5.3-flash", apiKey: "" },
        { provider: "groq", model: "llama-3.3-70b-versatile", apiKey: "" },
      ];
    }
    if (hint.includes("kimi")) {
      return [
        { provider: "apinex", model: "free/kimi-k3", apiKey: "" },
        { provider: "gemini", model: "gemini-1.5-flash", apiKey: "" },
      ];
    }
    if (hint.includes("deepseek") || hint.includes("reasoning")) {
      return [
        { provider: "apinex", model: "free/deepseek-v4.1-flash", apiKey: "" },
        { provider: "openrouter", model: "deepseek/deepseek-r1:free", apiKey: "" },
        { provider: "groq", model: "openai/gpt-oss-120b", apiKey: "" },
        { provider: "groq", model: "qwen/qwen3.8-27b", apiKey: "" },
        { provider: "gemini", model: "gemini-1.5-flash", apiKey: "" },
      ];
    }
    if (hint.includes("allam")) {
      return [
        { provider: "groq", model: "allam-2-7b", apiKey: "" },
        { provider: "groq", model: "qwen/qwen3.8-27b", apiKey: "" },
        { provider: "gemini", model: "gemini-1.5-flash", apiKey: "" },
      ];
    }
    if (hint.includes("gemini") || hint.includes("context")) {
      return [
        { provider: "apinex", model: "free/gemini-3.8-flash", apiKey: "" },
        { provider: "gemini", model: "gemini-1.5-flash", apiKey: "" },
        { provider: "groq", model: "llama-3.3-70b-versatile", apiKey: "" },
      ];
    }
    if (hint.includes("cloudflare")) {
      return [
        { provider: "cloudflare", model: "@cf/meta/llama-3.1-8b-instruct", apiKey: "" },
        { provider: "groq", model: "llama-3.3-70b-versatile", apiKey: "" },
      ];
    }

    // 2. Cognitive Semantic Intent Dispatching (Next-Gen Fleet AI Brain)
    if (req) {
      const intent = CognitiveIntentAnalyzer.analyze(req);

      switch (intent.domain) {
        case "MASSIVE_CONTEXT":
          return [
            { provider: "apinex", model: "free/gemini-3.8-flash", apiKey: "" },
            { provider: "apinex", model: "free/kimi-k3", apiKey: "" },
            { provider: "gemini", model: "gemini-1.5-flash", apiKey: "" },
            { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct:free", apiKey: "" },
          ];
        case "ARABIC_SPECIALIST":
          return [
            { provider: "apinex", model: "free/qwen-3.8-max", apiKey: "" },
            { provider: "apinex", model: "free/glm-5.3-flash", apiKey: "" },
            { provider: "groq", model: "qwen/qwen3.8-27b", apiKey: "" },
            { provider: "groq", model: "allam-2-7b", apiKey: "" },
            { provider: "gemini", model: "gemini-1.5-flash", apiKey: "" },
          ];
        case "VISUAL_CANVAS":
          return [
            { provider: "apinex", model: "free/gemini-3.8-flash", apiKey: "" },
            { provider: "apinex", model: "free/qwen-3.8-max", apiKey: "" },
            { provider: "groq", model: "qwen/qwen3.8-27b", apiKey: "" },
            { provider: "groq", model: "llama-3.3-70b-versatile", apiKey: "" },
          ];
        case "DEEP_REASONING":
          return [
            { provider: "apinex", model: "free/deepseek-v4.1-flash", apiKey: "" },
            { provider: "apinex", model: "free/deepseek-v4-pro-0813", apiKey: "" },
            { provider: "openrouter", model: "deepseek/deepseek-r1:free", apiKey: "" },
            { provider: "groq", model: "llama-3.3-70b-versatile", apiKey: "" },
            { provider: "gemini", model: "gemini-1.5-flash", apiKey: "" },
          ];
        case "CODE_SYSTEMS":
          return [
            { provider: "apinex", model: "free/qwen-3.8-max", apiKey: "" },
            { provider: "groq", model: "qwen/qwen3.8-27b", apiKey: "" },
            { provider: "openrouter", model: "deepseek/deepseek-r1:free", apiKey: "" },
            { provider: "gemini", model: "gemini-1.5-flash", apiKey: "" },
          ];
        case "FAST_CHAT":
        default:
          return [
            { provider: "apinex", model: "free/glm-5.3-flash", apiKey: "" },
            { provider: "apinex", model: "free/deepseek-v4.1-flash", apiKey: "" },
            { provider: "groq", model: "llama-3.3-70b-versatile", apiKey: "" },
            { provider: "groq", model: "qwen/qwen3.8-27b", apiKey: "" },
            { provider: "cloudflare", model: "@cf/meta/llama-3.1-8b-instruct", apiKey: "" },
            { provider: "gemini", model: "gemini-1.5-flash", apiKey: "" },
          ];
      }
    }

    // Default Fallback Chain (Next-Gen Ultra Stack)
    return [
      { provider: "apinex", model: "free/glm-5.3-flash", apiKey: "" },
      { provider: "apinex", model: "free/qwen-3.8-max", apiKey: "" },
      { provider: "groq", model: "llama-3.3-70b-versatile", apiKey: "" },
      { provider: "groq", model: "qwen/qwen3.8-27b", apiKey: "" },
      { provider: "gemini", model: "gemini-1.5-flash", apiKey: "" },
    ];
  }
}

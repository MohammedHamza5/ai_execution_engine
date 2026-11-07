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
                systemInstruction: req.messages?.find((m) => m.role === "system")?.content,
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

        let cleanText = result.outputText;
        if (isJson || /<think>[\s\S]*?<\/think>/.test(cleanText)) {
          cleanText = cleanText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
        }
        if (isJson) {
          const jsonMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
          if (jsonMatch) {
            cleanText = jsonMatch[1].trim();
          }
        }

        return {
          id: `chatcmpl-${generateUUIDv7()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: `${candidate.provider}/${candidate.model}`,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: cleanText },
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
      text = messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");
    }
    if (req.response_format?.type === "json_object" && !/json/i.test(text)) {
      text += "\n\n(Respond with a valid JSON object)";
    }
    return text;
  }

  public static buildCandidateChain(modelHint?: string, req?: ChatCompletionRequest): ProviderCandidate[] {
    const hint = (modelHint || "auto").toLowerCase();

    // 1. Arabic Specialist, Qwen Persona Simulation, & Plan Synthesis
    if (hint.includes("qwen") || hint === "free/qwen-3.8-max" || hint.includes("arabic")) {
      return [
        { provider: "groq", model: "qwen/qwen3.8-27b", apiKey: "" },
        { provider: "groq", model: "allam-2-7b", apiKey: "" },
        { provider: "openrouter", model: "qwen/qwen3.8-27b", apiKey: "" },
        { provider: "cloudflare", model: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b", apiKey: "" },
        { provider: "apinex", model: "free/qwen-3.8-max", apiKey: "" },
      ];
    }

    // 2. Ultra-Fast Diagnostic Reasoning, Plateau Analysis, & Churn Prevention
    if (hint.includes("deepseek") || hint === "free/deepseek-v4.1-flash" || hint.includes("reasoning") || hint.includes("plateau")) {
      return [
        { provider: "cloudflare", model: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b", apiKey: "" },
        { provider: "openrouter", model: "deepseek/deepseek-v4.1-flash", apiKey: "" },
        { provider: "groq", model: "openai/gpt-oss-120b", apiKey: "" },
        { provider: "groq", model: "qwen/qwen3.8-27b", apiKey: "" },
        { provider: "apinex", model: "free/deepseek-v4.1-flash", apiKey: "" },
      ];
    }

    // 3. Massive Context, Season Wrapped Narratives & Large Document Synthesis
    if (hint.includes("gemini") || hint === "free/gemini-3.8-flash" || hint.includes("wrapped") || hint.includes("context") || hint.includes("massive")) {
      return [
        { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct", apiKey: "" },
        { provider: "groq", model: "qwen/qwen3.8-27b", apiKey: "" },
        { provider: "gemini", model: "gemini-3.8-flash", apiKey: "" },
        { provider: "apinex", model: "free/gemini-3.8-flash", apiKey: "" },
      ];
    }

    // 4. Instant Gym-Floor Swaps & Review Feedback Drafts
    if (hint.includes("llama-3.3") || hint.includes("swap") || hint.includes("draft") || hint.includes("70b")) {
      return [
        { provider: "groq", model: "qwen/qwen3.8-27b", apiKey: "" },
        { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct", apiKey: "" },
        { provider: "cloudflare", model: "@cf/meta/llama-3.1-8b-instruct", apiKey: "" },
      ];
    }

    // 5. Instant Micro-Badges & Rapid Sentiment Classification
    if (hint.includes("llama-3.1") || hint.includes("8b") || hint.includes("badge") || hint.includes("sentiment")) {
      return [
        { provider: "cloudflare", model: "@cf/meta/llama-3.1-8b-instruct", apiKey: "" },
        { provider: "groq", model: "qwen/qwen3.8-27b", apiKey: "" },
        { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct", apiKey: "" },
      ];
    }

    // 6. Generic or Free Prefix Fallbacks
    if (hint.startsWith("free/") || hint.includes("apinex")) {
      const targetModel = hint.startsWith("free/") ? hint : `free/${hint.replace("apinex/", "")}`;
      return [
        { provider: "groq", model: "qwen/qwen3.8-27b", apiKey: "" },
        { provider: "cloudflare", model: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b", apiKey: "" },
        { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct", apiKey: "" },
        { provider: "apinex", model: targetModel, apiKey: "" },
      ];
    }

    // 7. Cognitive Semantic Intent Dispatching
    if (req) {
      const intent = CognitiveIntentAnalyzer.analyze(req);
      switch (intent.domain) {
        case "MASSIVE_CONTEXT":
          return [
            { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct", apiKey: "" },
            { provider: "groq", model: "qwen/qwen3.8-27b", apiKey: "" },
            { provider: "gemini", model: "gemini-3.8-flash", apiKey: "" },
          ];
        case "VISUAL_CANVAS":
          return [
            { provider: "groq", model: "qwen/qwen3.8-27b", apiKey: "" },
            { provider: "gemini", model: "gemini-3.8-flash", apiKey: "" },
            { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct", apiKey: "" },
          ];
        case "ARABIC_SPECIALIST":
          return [
            { provider: "groq", model: "allam-2-7b", apiKey: "" },
            { provider: "groq", model: "qwen/qwen3.8-27b", apiKey: "" },
            { provider: "cloudflare", model: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b", apiKey: "" },
          ];
        case "CODE_SYSTEMS":
          return [
            { provider: "groq", model: "qwen/qwen3.8-27b", apiKey: "" },
            { provider: "cloudflare", model: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b", apiKey: "" },
          ];
        case "DEEP_REASONING":
          return [
            { provider: "openrouter", model: "deepseek/deepseek-r1:free", apiKey: "" },
            { provider: "cloudflare", model: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b", apiKey: "" },
            { provider: "groq", model: "openai/gpt-oss-120b", apiKey: "" },
          ];
        case "FAST_CHAT":
        default:
          return [
            { provider: "groq", model: "qwen/qwen3.8-27b", apiKey: "" },
            { provider: "cloudflare", model: "@cf/meta/llama-3.1-8b-instruct", apiKey: "" },
            { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct", apiKey: "" },
          ];
      }
    }

    // Master Default Fallback Chain
    return [
      { provider: "groq", model: "qwen/qwen3.8-27b", apiKey: "" },
      { provider: "cloudflare", model: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b", apiKey: "" },
      { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct", apiKey: "" },
      { provider: "cloudflare", model: "@cf/meta/llama-3.1-8b-instruct", apiKey: "" },
    ];
  }
}

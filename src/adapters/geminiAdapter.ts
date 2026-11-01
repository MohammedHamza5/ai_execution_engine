import {
  ProviderAdapter,
  UnifiedRequest,
  UnifiedResponse,
  NormalizedProviderError,
  ProviderErrorCode,
} from "./types.js";
import { GeminiErrorNormalizer } from "./geminiErrorNormalizer.js";

export class GeminiProviderAdapter implements ProviderAdapter {
  public readonly providerId = "gemini";

  private simulatedFault: NormalizedProviderError | ProviderErrorCode | null = null;
  private faultSequence: (NormalizedProviderError | ProviderErrorCode | null)[] = [];
  private resourceFaults: Map<string, NormalizedProviderError | ProviderErrorCode> = new Map();
  private responseSequence: string[] = [];

  public static createNormalizedError = GeminiErrorNormalizer.createNormalizedError;
  public normalizeError = GeminiErrorNormalizer.normalize;

  public setSimulatedFault(fault: NormalizedProviderError | ProviderErrorCode | null): void {
    this.simulatedFault = fault;
  }

  public setFaultSequence(faults: (NormalizedProviderError | ProviderErrorCode | null)[]): void {
    this.faultSequence = [...faults];
  }

  public setResourceFault(resourceId: string, fault: NormalizedProviderError | ProviderErrorCode): void {
    this.resourceFaults.set(resourceId, fault);
  }

  public setResponseSequence(responses: string[]): void {
    this.responseSequence = [...responses];
  }

  public resetSimulation(): void {
    this.simulatedFault = null;
    this.faultSequence = [];
    this.responseSequence = [];
    this.resourceFaults.clear();
  }

  public async execute(request: UnifiedRequest, secretApiKey?: string): Promise<UnifiedResponse> {
    const startTime = Date.now();

    let targetFault = request.parameters?.simulationFault ||
      (this.faultSequence.length > 0 ? this.faultSequence.shift() : null) ||
      (this.resourceFaults.has(request.resourceId) ? this.resourceFaults.get(request.resourceId) : null) ||
      this.simulatedFault;

    if (targetFault) {
      throw typeof targetFault === "string" ? GeminiErrorNormalizer.createNormalizedError(targetFault) : targetFault;
    }

    if (!secretApiKey || secretApiKey === "simulated-test-key" || secretApiKey.startsWith("simulated-")) {
      const outputText = this.responseSequence.length > 0
        ? this.responseSequence.shift()!
        : request.parameters?.simulationResponse || `[Gemini Simulated Response] Executed prompt: "${request.prompt.slice(0, 50)}"`;

      return {
        requestId: request.requestId,
        outputText,
        usage: {
          inputTokens: Math.ceil(request.prompt.length / 4),
          outputTokens: 25,
          totalTokens: Math.ceil(request.prompt.length / 4) + 25,
        },
        latencyMs: Date.now() - startTime,
        finishReason: "stop",
      };
    }

    const model = request.modelId.includes("/")
      ? request.modelId.split("/")[1]
      : request.modelId || "gemini-3.8-flash";

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(secretApiKey)}`;
    const controller = new AbortController();
    const timeoutMs = request.timeoutMs || 30000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: request.prompt }] }],
          generationConfig: {
            temperature: request.parameters?.temperature ?? 0.2,
            maxOutputTokens: request.parameters?.maxOutputTokens ?? 2048,
            ...(request.parameters?.responseFormat === "json" ? { responseMimeType: "application/json" } : {}),
          },
        }),
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw { status: response.status, statusText: response.statusText, body: errorBody };
      }

      const data = (await response.json()) as any;
      const candidate = data?.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      const outputText = parts.map((p: any) => p.text || "").join("").trim();

      const inputTokens = data?.usageMetadata?.promptTokenCount ?? Math.ceil(request.prompt.length / 4);
      const outputTokens = data?.usageMetadata?.candidatesTokenCount ?? Math.ceil(outputText.length / 4);

      return {
        requestId: request.requestId,
        outputText,
        rawResponse: data,
        usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
        latencyMs,
        finishReason: candidate?.finishReason === "STOP" ? "stop" : (candidate?.finishReason?.toLowerCase() || "unknown"),
      };
    } catch (err: any) {
      throw GeminiErrorNormalizer.normalize(err);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

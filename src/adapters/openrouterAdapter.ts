import {
  ProviderAdapter,
  UnifiedRequest,
  UnifiedResponse,
  NormalizedProviderError,
  ProviderErrorCode,
} from "./types.js";

export class OpenRouterProviderAdapter implements ProviderAdapter {
  public readonly providerId = "openrouter";

  private simulatedFault: NormalizedProviderError | ProviderErrorCode | null = null;
  private faultSequence: (NormalizedProviderError | ProviderErrorCode | null)[] = [];
  private responseSequence: string[] = [];

  public setSimulatedFault(fault: NormalizedProviderError | ProviderErrorCode | null): void {
    this.simulatedFault = fault;
  }

  public setFaultSequence(faults: (NormalizedProviderError | ProviderErrorCode | null)[]): void {
    this.faultSequence = [...faults];
  }

  public setResponseSequence(responses: string[]): void {
    this.responseSequence = [...responses];
  }

  public resetSimulation(): void {
    this.simulatedFault = null;
    this.faultSequence = [];
    this.responseSequence = [];
  }

  public async execute(request: UnifiedRequest, secretApiKey?: string): Promise<UnifiedResponse> {
    const startTime = Date.now();

    let targetFault = request.parameters?.simulationFault || (this.faultSequence.length > 0 ? this.faultSequence.shift() : null) || this.simulatedFault;
    if (targetFault) {
      throw typeof targetFault === "string" ? this.createError(targetFault) : targetFault;
    }

    if (!secretApiKey || secretApiKey === "simulated-test-key" || secretApiKey.startsWith("simulated-")) {
      const outputText = this.responseSequence.length > 0
        ? this.responseSequence.shift()!
        : request.parameters?.simulationResponse || `[OpenRouter Simulated Response] Executed prompt: "${request.prompt.slice(0, 50)}"`;
      const inputTokens = Math.ceil(request.prompt.length / 4);
      const outputTokens = Math.ceil(outputText.length / 4);
      return {
        requestId: request.requestId,
        outputText,
        usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
        latencyMs: Date.now() - startTime,
        finishReason: "stop",
      };
    }

    const model = request.modelId || "liquid/lfm-2.5-2.6b:free";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), request.timeoutMs || 30000);

    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secretApiKey}`,
          "HTTP-Referer": "https://ai-execution-engine.local",
          "X-Title": "AI-Execution-Engine",
        },
        body: JSON.stringify({
          model,
          messages: [
            ...(request.systemInstruction ? [{ role: "system", content: request.systemInstruction }] : []),
            { role: "user", content: request.prompt },
          ],
          temperature: request.parameters?.temperature ?? 0.2,
          max_tokens: request.parameters?.maxOutputTokens ?? 2048,
        }),
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startTime;
      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        const retryAfterHeader = response.headers.get("retry-after");
        const retryAfterMs = retryAfterHeader ? Math.max(1000, parseFloat(retryAfterHeader) * 1000) : undefined;
        throw { status: response.status, statusText: response.statusText, body: errorBody, retryAfterMs };
      }

      const data = (await response.json()) as any;
      const choice = data?.choices?.[0];
      const outputText = choice?.message?.content ?? "";
      const inputTokens = data?.usage?.prompt_tokens ?? Math.ceil(request.prompt.length / 4);
      const outputTokens = data?.usage?.completion_tokens ?? Math.ceil(outputText.length / 4);

      return {
        requestId: request.requestId,
        outputText,
        rawResponse: data,
        usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
        latencyMs,
        finishReason: choice?.finish_reason === "stop" ? "stop" : "unknown",
      };
    } catch (err: any) {
      throw this.normalizeError(err);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  public normalizeError(error: any): NormalizedProviderError {
    if (error?.code && Object.values(ProviderErrorCode).includes(error.code)) {
      return error as NormalizedProviderError;
    }
    if (error?.name === "AbortError") {
      return { code: ProviderErrorCode.TIMEOUT, message: "OpenRouter request timed out", retryable: true, migrationRecommended: true };
    }
    const status = error?.status;
    const body = String(error?.body || error?.message || "");
    const retryAfterMs = error?.retryAfterMs;

    if (status === 401 || status === 403 || /unauthorized|invalid_api_key/i.test(body)) {
      return { code: ProviderErrorCode.AUTHENTICATION, message: "OpenRouter credential invalid or unauthorized", retryable: false, migrationRecommended: false, providerCode: "UNAUTHORIZED" };
    }
    if (status === 429 || /rate limit|quota exceeded|free tier limit|temporarily rate/i.test(body)) {
      const isQuota = /quota/i.test(body);
      return {
        code: isQuota ? ProviderErrorCode.QUOTA_EXHAUSTED : ProviderErrorCode.RATE_LIMIT,
        message: isQuota ? "OpenRouter quota exhausted" : "OpenRouter rate limit reached",
        retryable: !isQuota,
        migrationRecommended: true,
        retryAfterMs: retryAfterMs || 5000,
        providerCode: isQuota ? "QUOTA_EXHAUSTED" : "RATE_LIMIT",
      };
    }
    if (status === 404 || /model not found|no endpoints|unavailable for free/i.test(body)) {
      return { code: ProviderErrorCode.MODEL_NOT_FOUND, message: "OpenRouter model not found or unavailable for free", retryable: false, migrationRecommended: true, providerCode: "MODEL_NOT_FOUND" };
    }
    if (status === 503) {
      return { code: ProviderErrorCode.SERVICE_UNAVAILABLE, message: "OpenRouter upstream unavailable", retryable: true, migrationRecommended: true, providerCode: "SERVICE_UNAVAILABLE" };
    }
    if (status && status >= 500) {
      return { code: ProviderErrorCode.SERVER_ERROR, message: `OpenRouter server error (${status})`, retryable: true, migrationRecommended: true, providerCode: "SERVER_ERROR" };
    }
    return { code: ProviderErrorCode.UNKNOWN, message: `OpenRouter error: ${body.slice(0, 100)}`, retryable: false, migrationRecommended: true };
  }

  private createError(code: ProviderErrorCode): NormalizedProviderError {
    return { code, message: `OpenRouter simulated fault: ${code}`, retryable: code === ProviderErrorCode.RATE_LIMIT || code === ProviderErrorCode.TIMEOUT, migrationRecommended: true };
  }
}

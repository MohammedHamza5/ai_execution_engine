import {
  ProviderAdapter,
  UnifiedRequest,
  UnifiedResponse,
  NormalizedProviderError,
  ProviderErrorCode,
} from "./types.js";

export class CloudflareProviderAdapter implements ProviderAdapter {
  public readonly providerId = "cloudflare";

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
        : request.parameters?.simulationResponse ||
          (request.parameters?.responseFormat === "json"
            ? JSON.stringify({ status: "ok", code: 200 })
            : `[Cloudflare Simulated Response] Executed prompt: "${request.prompt.slice(0, 50)}"`);
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

    const accountId = (request.parameters as any)?.accountId || process.env.CLOUDFLARE_ACCOUNT_ID_1 || process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!accountId) {
      throw { code: ProviderErrorCode.INVALID_REQUEST, message: "Cloudflare account ID is missing", retryable: false, migrationRecommended: false };
    }

    const model = request.modelId || "@cf/meta/llama-3.1-8b-instruct";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), request.timeoutMs || 30000);

    try {
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secretApiKey}`,
        },
        body: JSON.stringify(
          request.systemInstruction
            ? {
                messages: [
                  { role: "system", content: request.systemInstruction },
                  { role: "user", content: request.prompt },
                ],
                max_tokens: request.parameters?.maxOutputTokens ?? 1024,
              }
            : {
                prompt: request.prompt,
                max_tokens: request.parameters?.maxOutputTokens ?? 1024,
              }
        ),
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startTime;
      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw { status: response.status, statusText: response.statusText, body: errorBody };
      }

      const data = (await response.json()) as any;
      const outputText = data?.result?.response || (typeof data?.result === "string" ? data.result : "");
      const inputTokens = Math.ceil(request.prompt.length / 4);
      const outputTokens = Math.ceil(outputText.length / 4);

      return {
        requestId: request.requestId,
        outputText,
        rawResponse: data,
        usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
        latencyMs,
        finishReason: "stop",
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
      return { code: ProviderErrorCode.TIMEOUT, message: "Cloudflare request timed out", retryable: true, migrationRecommended: true };
    }
    const status = error?.status;
    const body = String(error?.body || error?.message || "");

    if (status === 401 || status === 403 || /10000|Authentication error|Unauthorized/i.test(body)) {
      return { code: ProviderErrorCode.AUTHENTICATION, message: "Cloudflare token invalid or unauthorized", retryable: false, migrationRecommended: false, providerCode: "AUTH_ERROR" };
    }
    if (status === 429 || /rate limit|quota/i.test(body)) {
      return { code: ProviderErrorCode.RATE_LIMIT, message: "Cloudflare Workers AI rate limit reached", retryable: true, migrationRecommended: true, retryAfterMs: 5000, providerCode: "RATE_LIMIT" };
    }
    if (status === 404 || /model not found|7000/i.test(body)) {
      return { code: ProviderErrorCode.MODEL_NOT_FOUND, message: "Cloudflare AI model not found", retryable: false, migrationRecommended: false, providerCode: "MODEL_NOT_FOUND" };
    }
    if (status === 503) {
      return { code: ProviderErrorCode.SERVICE_UNAVAILABLE, message: "Cloudflare Workers AI unavailable", retryable: true, migrationRecommended: true, providerCode: "UNAVAILABLE" };
    }
    if (status && status >= 500) {
      return { code: ProviderErrorCode.SERVER_ERROR, message: `Cloudflare server error (${status})`, retryable: true, migrationRecommended: true, providerCode: "SERVER_ERROR" };
    }
    return { code: ProviderErrorCode.UNKNOWN, message: `Cloudflare error: ${body.slice(0, 100)}`, retryable: false, migrationRecommended: true };
  }

  private createError(code: ProviderErrorCode): NormalizedProviderError {
    return { code, message: `Cloudflare simulated fault: ${code}`, retryable: code === ProviderErrorCode.RATE_LIMIT || code === ProviderErrorCode.TIMEOUT, migrationRecommended: true };
  }
}

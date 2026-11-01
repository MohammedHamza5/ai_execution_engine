import {
  ProviderAdapter,
  UnifiedRequest,
  UnifiedResponse,
  NormalizedProviderError,
  ProviderErrorCode,
} from "./types.js";

export interface OpenAICompatibleConfig {
  readonly providerId: string;
  readonly baseUrl: string;
  readonly defaultModel: string;
  readonly chatEndpoint?: string;
  readonly customHeaders?: Record<string, string>;
}

export class OpenAICompatibleProviderAdapter implements ProviderAdapter {
  public readonly providerId: string;
  private readonly config: OpenAICompatibleConfig;
  private simulatedFault: NormalizedProviderError | ProviderErrorCode | null = null;
  private faultSequence: (NormalizedProviderError | ProviderErrorCode | null)[] = [];
  private responseSequence: string[] = [];

  constructor(config: OpenAICompatibleConfig) {
    this.config = config;
    this.providerId = config.providerId.toLowerCase();
  }

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
    const fault = request.parameters?.simulationFault ||
      (this.faultSequence.length > 0 ? this.faultSequence.shift() : null) ||
      this.simulatedFault;

    if (fault) {
      throw typeof fault === "string" ? this.createError(fault) : fault;
    }

    if (!secretApiKey || secretApiKey === "simulated-test-key" || secretApiKey.startsWith("simulated-")) {
      const outputText = this.responseSequence.length > 0
        ? this.responseSequence.shift()!
        : request.parameters?.simulationResponse ||
          `[${this.config.providerId} Simulated Response] Executed prompt: "${request.prompt.slice(0, 50)}"`;
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

    const model = request.modelId || this.config.defaultModel;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), request.timeoutMs || 30000);
    const endpoint = `${this.config.baseUrl.replace(/\/+$/, "")}${this.config.chatEndpoint || "/chat/completions"}`;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secretApiKey}`,
          ...(this.config.customHeaders || {}),
        },
        body: JSON.stringify({
          model,
          messages: [
            ...(request.systemInstruction ? [{ role: "system", content: request.systemInstruction }] : []),
            { role: "user", content: request.prompt },
          ],
          temperature: request.parameters?.temperature ?? 0.2,
          max_tokens: request.parameters?.maxOutputTokens ?? 2048,
          ...(request.parameters?.responseFormat === "json" ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startTime;
      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        const retryHeader = response.headers.get("retry-after") || response.headers.get("x-ratelimit-reset-requests");
        const retryAfterMs = retryHeader ? Math.max(1000, parseFloat(retryHeader) * 1000) : undefined;
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
      return { code: ProviderErrorCode.TIMEOUT, message: `${this.config.providerId} request timed out`, retryable: true, migrationRecommended: true };
    }
    const status = error?.status;
    const body = String(error?.body || error?.message || "");
    const retryAfterMs = error?.retryAfterMs;

    if (status === 401 || status === 403 || /invalid_api_key|unauthorized/i.test(body)) {
      return { code: ProviderErrorCode.AUTHENTICATION, message: `${this.config.providerId} credential invalid or unauthorized`, retryable: false, migrationRecommended: false, providerCode: "INVALID_API_KEY" };
    }
    if (status === 429 || /rate_limit_exceeded|tokens_per_minute|requests_per_minute/i.test(body)) {
      const isQuota = /quota_exceeded|insufficient_quota/i.test(body);
      return {
        code: isQuota ? ProviderErrorCode.QUOTA_EXHAUSTED : ProviderErrorCode.RATE_LIMIT,
        message: isQuota ? `${this.config.providerId} quota exhausted` : `${this.config.providerId} rate limit exceeded`,
        retryable: !isQuota,
        migrationRecommended: true,
        retryAfterMs: retryAfterMs || 5000,
        providerCode: isQuota ? "QUOTA_EXHAUSTED" : "RATE_LIMIT_EXCEEDED",
      };
    }
    if (status === 404 || /model_not_found/i.test(body)) {
      return { code: ProviderErrorCode.MODEL_NOT_FOUND, message: `${this.config.providerId} model not found`, retryable: false, migrationRecommended: false, providerCode: "MODEL_NOT_FOUND" };
    }
    if (status === 503) {
      return { code: ProviderErrorCode.SERVICE_UNAVAILABLE, message: `${this.config.providerId} service temporarily unavailable`, retryable: true, migrationRecommended: true, providerCode: "SERVICE_UNAVAILABLE" };
    }
    if (status && status >= 500) {
      return { code: ProviderErrorCode.SERVER_ERROR, message: `${this.config.providerId} server error (${status})`, retryable: true, migrationRecommended: true, providerCode: "SERVER_ERROR" };
    }
    return { code: ProviderErrorCode.UNKNOWN, message: `${this.config.providerId} error: ${body.slice(0, 100)}`, retryable: false, migrationRecommended: true };
  }

  private createError(code: ProviderErrorCode): NormalizedProviderError {
    return {
      code,
      message: `${this.config.providerId} simulated fault: ${code}`,
      retryable: code === ProviderErrorCode.RATE_LIMIT || code === ProviderErrorCode.TIMEOUT,
      migrationRecommended: true,
    };
  }
}

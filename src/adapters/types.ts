export enum ProviderErrorCode {
  AUTHENTICATION = "AUTHENTICATION",
  AUTHORIZATION = "AUTHORIZATION",
  INVALID_REQUEST = "INVALID_REQUEST",
  MODEL_NOT_FOUND = "MODEL_NOT_FOUND",
  UNSUPPORTED_CAPABILITY = "UNSUPPORTED_CAPABILITY",
  RATE_LIMIT = "RATE_LIMIT",
  QUOTA_EXHAUSTED = "QUOTA_EXHAUSTED",
  CONTEXT_TOO_LARGE = "CONTEXT_TOO_LARGE",
  OUTPUT_LIMIT = "OUTPUT_LIMIT",
  CONTENT_FILTER = "CONTENT_FILTER",
  TIMEOUT = "TIMEOUT",
  NETWORK_ERROR = "NETWORK_ERROR",
  SERVER_ERROR = "SERVER_ERROR",
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
  INVALID_OUTPUT = "INVALID_OUTPUT",
  UNKNOWN = "UNKNOWN",
}

export interface NormalizedProviderError {
  readonly code: ProviderErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly migrationRecommended: boolean;
  readonly retryAfterMs?: number;
  readonly providerCode?: string;
  readonly details?: Record<string, unknown>;
}

export interface UnifiedRequest {
  readonly requestId: string;
  readonly taskId: string;
  readonly stepId: string;
  readonly attemptId: string;
  readonly resourceId: string;
  readonly modelId: string;
  readonly prompt: string;
  readonly systemInstruction?: string;
  readonly timeoutMs?: number;
  readonly parameters?: {
    readonly temperature?: number;
    readonly maxOutputTokens?: number;
    readonly responseFormat?: "text" | "json";
    readonly simulationFault?: ProviderErrorCode | NormalizedProviderError;
    readonly simulationResponse?: string;
  };
}

export interface UnifiedResponse {
  readonly requestId: string;
  readonly outputText: string;
  readonly rawResponse?: unknown;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
  };
  readonly latencyMs: number;
  readonly finishReason: "stop" | "length" | "content_filter" | "unknown";
}

export interface ProviderAdapter {
  readonly providerId: string;
  execute(request: UnifiedRequest, secretApiKey?: string): Promise<UnifiedResponse>;
  normalizeError(error: unknown): NormalizedProviderError;
}

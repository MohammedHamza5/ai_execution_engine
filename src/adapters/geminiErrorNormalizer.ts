import { NormalizedProviderError, ProviderErrorCode } from "./types.js";

/**
 * Normalizes upstream Google Gemini errors and synthesizes canonical errors for simulation.
 */
export class GeminiErrorNormalizer {
  public static createNormalizedError(
    code: ProviderErrorCode,
    customMessage?: string,
    details?: Record<string, unknown>
  ): NormalizedProviderError {
    const defaultMessages: Record<ProviderErrorCode, { msg: string; retryable: boolean; migrate: boolean; providerCode?: string }> = {
      [ProviderErrorCode.QUOTA_EXHAUSTED]: { msg: "Upstream provider resource quota exceeded", retryable: false, migrate: true, providerCode: "RESOURCE_EXHAUSTED" },
      [ProviderErrorCode.RATE_LIMIT]: { msg: "Provider concurrency or rate limit threshold exceeded", retryable: true, migrate: true, providerCode: "RESOURCE_EXHAUSTED" },
      [ProviderErrorCode.TIMEOUT]: { msg: "Upstream provider HTTP connection timed out", retryable: true, migrate: true },
      [ProviderErrorCode.NETWORK_ERROR]: { msg: "Network connectivity error reaching provider endpoint", retryable: true, migrate: true },
      [ProviderErrorCode.SERVER_ERROR]: { msg: "Provider internal server error (HTTP 500)", retryable: true, migrate: true, providerCode: "INTERNAL" },
      [ProviderErrorCode.SERVICE_UNAVAILABLE]: { msg: "Provider service temporarily unavailable (HTTP 503)", retryable: true, migrate: true, providerCode: "UNAVAILABLE" },
      [ProviderErrorCode.INVALID_REQUEST]: { msg: "Invalid parameters or malformed prompt sent to provider", retryable: false, migrate: false, providerCode: "INVALID_ARGUMENT" },
      [ProviderErrorCode.AUTHENTICATION]: { msg: "Provider credential invalid, expired, or forbidden", retryable: false, migrate: false, providerCode: "PERMISSION_DENIED" },
      [ProviderErrorCode.AUTHORIZATION]: { msg: "Provider access denied for requested resource", retryable: false, migrate: false, providerCode: "PERMISSION_DENIED" },
      [ProviderErrorCode.MODEL_NOT_FOUND]: { msg: "Target model identifier was not found on provider", retryable: false, migrate: false, providerCode: "NOT_FOUND" },
      [ProviderErrorCode.CONTEXT_TOO_LARGE]: { msg: "Prompt token count exceeds maximum model context window", retryable: false, migrate: false, providerCode: "INVALID_ARGUMENT" },
      [ProviderErrorCode.OUTPUT_LIMIT]: { msg: "Provider response exceeded maximum generation token limit", retryable: false, migrate: false, providerCode: "MAX_TOKENS" },
      [ProviderErrorCode.UNSUPPORTED_CAPABILITY]: { msg: "Requested capability is not supported by provider model", retryable: false, migrate: false, providerCode: "UNSUPPORTED" },
      [ProviderErrorCode.CONTENT_FILTER]: { msg: "Response was blocked by provider safety filters", retryable: false, migrate: false, providerCode: "SAFETY" },
      [ProviderErrorCode.INVALID_OUTPUT]: { msg: "Provider returned malformed or unparseable output payload", retryable: true, migrate: false },
      [ProviderErrorCode.UNKNOWN]: { msg: "An unknown provider anomaly occurred", retryable: false, migrate: true },
    };

    const def = defaultMessages[code] || defaultMessages[ProviderErrorCode.UNKNOWN];
    return {
      code,
      message: customMessage || def.msg,
      retryable: def.retryable,
      migrationRecommended: def.migrate,
      providerCode: def.providerCode,
      ...(code === ProviderErrorCode.RATE_LIMIT ? { retryAfterMs: 5000 } : {}),
      details,
    };
  }

  public static normalize(error: any): NormalizedProviderError {
    if (error?.code && Object.values(ProviderErrorCode).includes(error.code)) {
      return error as NormalizedProviderError;
    }

    if (error?.name === "AbortError") {
      return {
        code: ProviderErrorCode.TIMEOUT,
        message: "Upstream provider HTTP connection timed out",
        retryable: true,
        migrationRecommended: false,
      };
    }

    if (
      error?.code === "ENOTFOUND" ||
      error?.code === "ECONNRESET" ||
      error?.code === "ETIMEDOUT" ||
      error?.name === "FetchError" ||
      error?.type === "network"
    ) {
      return {
        code: ProviderErrorCode.NETWORK_ERROR,
        message: "Network connectivity error reaching provider endpoint",
        retryable: true,
        migrationRecommended: true,
      };
    }

    const status = error?.status || error?.statusCode;
    if (status === 400) {
      return {
        code: ProviderErrorCode.INVALID_REQUEST,
        message: "Invalid parameters or malformed prompt sent to provider",
        retryable: false,
        migrationRecommended: false,
        providerCode: "INVALID_ARGUMENT",
      };
    }

    if (status === 401 || status === 403) {
      return {
        code: ProviderErrorCode.AUTHENTICATION,
        message: "Provider credential invalid, expired, or forbidden",
        retryable: false,
        migrationRecommended: true,
        providerCode: "PERMISSION_DENIED",
      };
    }

    if (status === 404) {
      return {
        code: ProviderErrorCode.MODEL_NOT_FOUND,
        message: "Target model identifier was not found on provider",
        retryable: false,
        migrationRecommended: true,
        providerCode: "NOT_FOUND",
      };
    }

    if (status === 429) {
      return {
        code: ProviderErrorCode.RATE_LIMIT,
        message: "Provider concurrency or rate limit threshold exceeded (HTTP 429)",
        retryable: true,
        migrationRecommended: true,
        retryAfterMs: 5000,
        providerCode: "RESOURCE_EXHAUSTED",
      };
    }

    if (status === 503) {
      return {
        code: ProviderErrorCode.SERVICE_UNAVAILABLE,
        message: "Provider service temporarily unavailable or high demand spike (HTTP 503)",
        retryable: true,
        migrationRecommended: true,
        providerCode: "UNAVAILABLE",
      };
    }

    if (status >= 500 && status < 600) {
      return {
        code: ProviderErrorCode.SERVER_ERROR,
        message: `Provider internal server error (HTTP ${status})`,
        retryable: true,
        migrationRecommended: true,
        providerCode: "INTERNAL",
      };
    }

    return {
      code: ProviderErrorCode.UNKNOWN,
      message: error?.message || "An unknown provider anomaly occurred",
      retryable: false,
      migrationRecommended: true,
    };
  }
}

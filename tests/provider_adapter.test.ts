import { describe, it, expect } from "vitest";
import { GeminiProviderAdapter } from "../src/adapters/geminiAdapter.js";
import { ProviderErrorCode, UnifiedRequest } from "../src/adapters/types.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";

describe("Provider Adapter Contract & Error Normalization Tests", () => {
  const adapter = new GeminiProviderAdapter();

  const sampleRequest: UnifiedRequest = {
    requestId: generateUUIDv7(),
    taskId: generateUUIDv7(),
    stepId: generateUUIDv7(),
    attemptId: generateUUIDv7(),
    resourceId: generateUUIDv7(),
    modelId: "gemini-1.5-flash",
    prompt: "Translate 'Hello' to French",
  };

  it("successfully normalizes valid provider responses with token accounting", async () => {
    const response = await adapter.execute(sampleRequest, "simulated-test-key");

    expect(response.requestId).toBe(sampleRequest.requestId);
    expect(response.outputText).toContain("Exec");
    expect(response.usage.inputTokens).toBeGreaterThan(0);
    expect(response.usage.outputTokens).toBe(25);
    expect(response.finishReason).toBe("stop");
    expect(response.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("normalizes HTTP 401 / 403 into AUTHENTICATION error without leaking secrets", () => {
    const rawError = {
      status: 401,
      statusText: "Unauthorized",
      message: "API key expired: AIzaSyD982...",
    };

    const normalized = adapter.normalizeError(rawError);

    expect(normalized.code).toBe(ProviderErrorCode.AUTHENTICATION);
    expect(normalized.retryable).toBe(false);
    expect(normalized.migrationRecommended).toBe(true);
    // Secret key must never leak in normalized message
    expect(normalized.message).not.toContain("AIzaSyD982");
  });

  it("normalizes timeouts into TIMEOUT error", () => {
    const rawError = {
      name: "AbortError",
      message: "The operation was aborted",
    };

    const normalized = adapter.normalizeError(rawError);

    expect(normalized.code).toBe(ProviderErrorCode.TIMEOUT);
    expect(normalized.retryable).toBe(true);
    expect(normalized.migrationRecommended).toBe(false);
  });

  it("normalizes HTTP 429 into RATE_LIMIT error with retryAfter recommendation", () => {
    const rawError = {
      status: 429,
      statusText: "Too Many Requests",
    };

    const normalized = adapter.normalizeError(rawError);

    expect(normalized.code).toBe(ProviderErrorCode.RATE_LIMIT);
    expect(normalized.retryable).toBe(true);
    expect(normalized.migrationRecommended).toBe(true);
    expect(normalized.retryAfterMs).toBe(5000);
  });
});

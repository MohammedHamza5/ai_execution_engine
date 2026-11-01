import { describe, it, expect, beforeEach } from "vitest";
import { GeminiProviderAdapter } from "../src/adapters/geminiAdapter.js";
import { ProviderErrorCode, UnifiedRequest } from "../src/adapters/types.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";

describe("M1.4 Deterministic Provider Fault Injection Tests", () => {
  let adapter: GeminiProviderAdapter;

  beforeEach(() => {
    adapter = new GeminiProviderAdapter();
  });

  const createRequest = (resourceId?: string, extraParams?: Record<string, any>): UnifiedRequest => ({
    requestId: generateUUIDv7(),
    taskId: generateUUIDv7(),
    stepId: generateUUIDv7(),
    attemptId: generateUUIDv7(),
    resourceId: resourceId || generateUUIDv7(),
    modelId: "gemini-1.5-flash",
    prompt: "Test prompt for deterministic simulation",
    parameters: extraParams,
  });

  it("creates canonical NormalizedProviderError instances for all major categories", () => {
    const quotaErr = GeminiProviderAdapter.createNormalizedError(ProviderErrorCode.QUOTA_EXHAUSTED);
    expect(quotaErr.code).toBe(ProviderErrorCode.QUOTA_EXHAUSTED);
    expect(quotaErr.retryable).toBe(false);
    expect(quotaErr.migrationRecommended).toBe(true);
    expect(quotaErr.providerCode).toBe("RESOURCE_EXHAUSTED");

    const rateLimitErr = GeminiProviderAdapter.createNormalizedError(ProviderErrorCode.RATE_LIMIT);
    expect(rateLimitErr.code).toBe(ProviderErrorCode.RATE_LIMIT);
    expect(rateLimitErr.retryable).toBe(true);
    expect(rateLimitErr.migrationRecommended).toBe(true);
    expect(rateLimitErr.retryAfterMs).toBe(5000);

    const timeoutErr = GeminiProviderAdapter.createNormalizedError(ProviderErrorCode.TIMEOUT);
    expect(timeoutErr.code).toBe(ProviderErrorCode.TIMEOUT);
    expect(timeoutErr.retryable).toBe(true);
    expect(timeoutErr.migrationRecommended).toBe(true);

    const netErr = GeminiProviderAdapter.createNormalizedError(ProviderErrorCode.NETWORK_ERROR);
    expect(netErr.code).toBe(ProviderErrorCode.NETWORK_ERROR);
    expect(netErr.retryable).toBe(true);
    expect(netErr.migrationRecommended).toBe(true);

    const serverErr = GeminiProviderAdapter.createNormalizedError(ProviderErrorCode.SERVER_ERROR);
    expect(serverErr.code).toBe(ProviderErrorCode.SERVER_ERROR);
    expect(serverErr.retryable).toBe(true);
    expect(serverErr.migrationRecommended).toBe(true);

    const svcUnavailableErr = GeminiProviderAdapter.createNormalizedError(ProviderErrorCode.SERVICE_UNAVAILABLE);
    expect(svcUnavailableErr.code).toBe(ProviderErrorCode.SERVICE_UNAVAILABLE);
    expect(svcUnavailableErr.retryable).toBe(true);
    expect(svcUnavailableErr.migrationRecommended).toBe(true);

    const invalidReqErr = GeminiProviderAdapter.createNormalizedError(ProviderErrorCode.INVALID_REQUEST);
    expect(invalidReqErr.code).toBe(ProviderErrorCode.INVALID_REQUEST);
    expect(invalidReqErr.retryable).toBe(false);
    expect(invalidReqErr.migrationRecommended).toBe(false);

    const authErr = GeminiProviderAdapter.createNormalizedError(ProviderErrorCode.AUTHENTICATION);
    expect(authErr.code).toBe(ProviderErrorCode.AUTHENTICATION);
    expect(authErr.retryable).toBe(false);
    expect(authErr.migrationRecommended).toBe(false);
  });

  it("injects simulated persistent fault across executions", async () => {
    adapter.setSimulatedFault(ProviderErrorCode.QUOTA_EXHAUSTED);

    const req = createRequest();
    await expect(adapter.execute(req, "simulated-test-key")).rejects.toMatchObject({
      code: ProviderErrorCode.QUOTA_EXHAUSTED,
      migrationRecommended: true,
    });
  });

  it("injects sequential faults and transitions to success", async () => {
    adapter.setFaultSequence([
      ProviderErrorCode.TIMEOUT,
      ProviderErrorCode.RATE_LIMIT,
      null, // success on 3rd call
    ]);

    // Call 1 -> TIMEOUT
    await expect(adapter.execute(createRequest(), "simulated-test-key")).rejects.toMatchObject({
      code: ProviderErrorCode.TIMEOUT,
    });

    // Call 2 -> RATE_LIMIT
    await expect(adapter.execute(createRequest(), "simulated-test-key")).rejects.toMatchObject({
      code: ProviderErrorCode.RATE_LIMIT,
    });

    // Call 3 -> Success!
    const response = await adapter.execute(createRequest(), "simulated-test-key");
    expect(response.finishReason).toBe("stop");
    expect(response.outputText).toContain("Executed prompt");
  });

  it("injects resource-targeted faults leaving other resources healthy", async () => {
    const resourceA = generateUUIDv7();
    const resourceB = generateUUIDv7();

    adapter.setResourceFault(resourceA, ProviderErrorCode.QUOTA_EXHAUSTED);

    // Resource A fails with QUOTA_EXHAUSTED
    await expect(adapter.execute(createRequest(resourceA), "simulated-test-key")).rejects.toMatchObject({
      code: ProviderErrorCode.QUOTA_EXHAUSTED,
    });

    // Resource B succeeds normally
    const response = await adapter.execute(createRequest(resourceB), "simulated-test-key");
    expect(response.finishReason).toBe("stop");
  });

  it("respects per-request simulationFault in parameters", async () => {
    const req = createRequest(undefined, {
      simulationFault: ProviderErrorCode.INVALID_REQUEST,
    });

    await expect(adapter.execute(req, "simulated-test-key")).rejects.toMatchObject({
      code: ProviderErrorCode.INVALID_REQUEST,
      retryable: false,
      migrationRecommended: false,
    });
  });

  it("resets simulation faults cleanly", async () => {
    adapter.setSimulatedFault(ProviderErrorCode.SERVER_ERROR);
    adapter.resetSimulation();

    const response = await adapter.execute(createRequest(), "simulated-test-key");
    expect(response.finishReason).toBe("stop");
  });

  it("normalizes HTTP 503 and network socket errors in normalizeError", () => {
    const http503 = adapter.normalizeError({ status: 503, statusText: "Service Unavailable" });
    expect(http503.code).toBe(ProviderErrorCode.SERVICE_UNAVAILABLE);
    expect(http503.retryable).toBe(true);
    expect(http503.migrationRecommended).toBe(true);

    const netErr = adapter.normalizeError({ code: "ENOTFOUND", message: "DNS resolution failed" });
    expect(netErr.code).toBe(ProviderErrorCode.NETWORK_ERROR);
    expect(netErr.retryable).toBe(true);
    expect(netErr.migrationRecommended).toBe(true);
  });
});

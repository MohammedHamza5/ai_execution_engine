import { describe, it, expect } from "vitest";
import { RecoveryPolicy } from "../src/engine/recoveryPolicy.js";
import { ProviderErrorCode, NormalizedProviderError } from "../src/adapters/types.js";

describe("Recovery Policy & Error Classifier Tests (M1 Slice 1)", () => {
  it("QUOTA_EXHAUSTED yields MIGRATE_RESOURCE when migration is recommended", () => {
    const error: NormalizedProviderError = {
      code: ProviderErrorCode.QUOTA_EXHAUSTED,
      message: "Daily token tier limit reached",
      retryable: true,
      migrationRecommended: true,
    };

    const decision = RecoveryPolicy.evaluate(error);

    expect(decision.action).toBe("MIGRATE_RESOURCE");
    expect(decision.migrationRecommended).toBe(true);
    expect(decision.reason).toContain("QUOTA_EXHAUSTED");
  });

  it("RATE_LIMIT yields MIGRATE_RESOURCE when migration is recommended", () => {
    const error: NormalizedProviderError = {
      code: ProviderErrorCode.RATE_LIMIT,
      message: "HTTP 429: Too Many Requests",
      retryable: true,
      migrationRecommended: true,
      retryAfterMs: 3000,
    };

    const decision = RecoveryPolicy.evaluate(error);

    expect(decision.action).toBe("MIGRATE_RESOURCE");
    expect(decision.migrationRecommended).toBe(true);
    expect(decision.waitRequired).toBe(true);
    expect(decision.retryAfterMs).toBe(3000);
    expect(decision.reason).toContain("RATE_LIMIT");
  });

  it("TIMEOUT yields MIGRATE_RESOURCE when migration is recommended", () => {
    const error: NormalizedProviderError = {
      code: ProviderErrorCode.TIMEOUT,
      message: "Upstream request timed out after 30s",
      retryable: true,
      migrationRecommended: true,
    };

    const decision = RecoveryPolicy.evaluate(error);

    expect(decision.action).toBe("MIGRATE_RESOURCE");
    expect(decision.migrationRecommended).toBe(true);
    expect(decision.reason).toContain("TIMEOUT");
  });

  it("NETWORK_ERROR yields MIGRATE_RESOURCE when migration is recommended", () => {
    const error: NormalizedProviderError = {
      code: ProviderErrorCode.NETWORK_ERROR,
      message: "Connection reset by peer",
      retryable: true,
      migrationRecommended: true,
    };

    const decision = RecoveryPolicy.evaluate(error);

    expect(decision.action).toBe("MIGRATE_RESOURCE");
    expect(decision.migrationRecommended).toBe(true);
    expect(decision.reason).toContain("NETWORK_ERROR");
  });

  it("SERVER_ERROR yields MIGRATE_RESOURCE when migration is recommended", () => {
    const error: NormalizedProviderError = {
      code: ProviderErrorCode.SERVER_ERROR,
      message: "HTTP 500: Internal server error",
      retryable: true,
      migrationRecommended: true,
    };

    const decision = RecoveryPolicy.evaluate(error);

    expect(decision.action).toBe("MIGRATE_RESOURCE");
    expect(decision.migrationRecommended).toBe(true);
    expect(decision.reason).toContain("SERVER_ERROR");
  });

  it("SERVICE_UNAVAILABLE yields MIGRATE_RESOURCE when migration is recommended", () => {
    const error: NormalizedProviderError = {
      code: ProviderErrorCode.SERVICE_UNAVAILABLE,
      message: "HTTP 503: Service Unavailable",
      retryable: true,
      migrationRecommended: true,
    };

    const decision = RecoveryPolicy.evaluate(error);

    expect(decision.action).toBe("MIGRATE_RESOURCE");
    expect(decision.migrationRecommended).toBe(true);
    expect(decision.reason).toContain("SERVICE_UNAVAILABLE");
  });

  it("retryable error without migration recommendation yields RETRY_SAME", () => {
    const error: NormalizedProviderError = {
      code: ProviderErrorCode.TIMEOUT,
      message: "Transient socket blip",
      retryable: true,
      migrationRecommended: false,
      retryAfterMs: 500,
    };

    const decision = RecoveryPolicy.evaluate(error);

    expect(decision.action).toBe("RETRY_SAME");
    expect(decision.retryable).toBe(true);
    expect(decision.migrationRecommended).toBe(false);
    expect(decision.waitRequired).toBe(true);
    expect(decision.retryAfterMs).toBe(500);
    expect(decision.reason).toContain("TIMEOUT");
  });

  it("non-retryable error INVALID_REQUEST yields FAIL", () => {
    const error: NormalizedProviderError = {
      code: ProviderErrorCode.INVALID_REQUEST,
      message: "Malformed JSON payload or parameters",
      retryable: false,
      migrationRecommended: false,
    };

    const decision = RecoveryPolicy.evaluate(error);

    expect(decision.action).toBe("FAIL");
    expect(decision.retryable).toBe(false);
    expect(decision.migrationRecommended).toBe(false);
    expect(decision.reason).toContain("INVALID_REQUEST");
  });

  it("AUTHENTICATION and AUTHORIZATION failures yield FAIL", () => {
    const authError: NormalizedProviderError = {
      code: ProviderErrorCode.AUTHENTICATION,
      message: "API key is invalid",
      retryable: false,
      migrationRecommended: true, // Even if provider adapter suggested key migration
    };

    const authDecision = RecoveryPolicy.evaluate(authError);
    expect(authDecision.action).toBe("FAIL");
    expect(authDecision.reason).toContain("AUTHENTICATION");

    const authzError: NormalizedProviderError = {
      code: ProviderErrorCode.AUTHORIZATION,
      message: "Insufficient scopes",
      retryable: false,
      migrationRecommended: false,
    };

    const authzDecision = RecoveryPolicy.evaluate(authzError);
    expect(authzDecision.action).toBe("FAIL");
    expect(authzDecision.reason).toContain("AUTHORIZATION");
  });

  it("every decision contains a deterministic non-empty reason without secrets", () => {
    const errorCodes = Object.values(ProviderErrorCode);

    for (const code of errorCodes) {
      const error: NormalizedProviderError = {
        code,
        message: "Simulated test error",
        retryable: false,
        migrationRecommended: false,
      };

      const decision = RecoveryPolicy.evaluate(error);

      expect(decision.reason).toBeDefined();
      expect(typeof decision.reason).toBe("string");
      expect(decision.reason.trim().length).toBeGreaterThan(0);
      expect(decision.reason).not.toContain("AIzaSy");
    }
  });

  it("edge case: retryable=true and migrationRecommended=true prefers MIGRATE_RESOURCE", () => {
    const error: NormalizedProviderError = {
      code: ProviderErrorCode.RATE_LIMIT,
      message: "Rate limit exceeded",
      retryable: true,
      migrationRecommended: true,
    };

    const decision = RecoveryPolicy.evaluate(error);

    expect(decision.action).toBe("MIGRATE_RESOURCE");
    expect(decision.retryable).toBe(true);
    expect(decision.migrationRecommended).toBe(true);
  });

  it("edge case: retryable=false and migrationRecommended=false yields FAIL", () => {
    const error: NormalizedProviderError = {
      code: ProviderErrorCode.UNKNOWN,
      message: "Unclassified unexpected anomaly",
      retryable: false,
      migrationRecommended: false,
    };

    const decision = RecoveryPolicy.evaluate(error);

    expect(decision.action).toBe("FAIL");
    expect(decision.retryable).toBe(false);
    expect(decision.migrationRecommended).toBe(false);
  });
});

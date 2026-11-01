/**
 * Normalized Resource State & Capabilities Taxonomy
 * 
 * Enforces M4.2 and Section 9 & 10 of M4 MASTER EXECUTION PLAN.
 */
import { ModelTaxonomyProfile } from "./taxonomyTypes.js";

export type ResourceCapability =
  | "TEXT_GENERATION"
  | "STRUCTURED_OUTPUT"
  | "JSON"
  | "VISION"
  | "OCR"
  | "CODE"
  | "REASONING"
  | "MATH"
  | "LONG_CONTEXT"
  | "TOOL_CALLING"
  | "STREAMING"
  | "EMBEDDING";

export type ResourceBillingClass = "FREE" | "PAID" | "BYOK" | "INTERNAL";

export type ResourceHealthState = "HEALTHY" | "DEGRADED" | "COOLDOWN" | "PROBE" | "UNAVAILABLE";

export interface QuotaDimensionState {
  readonly type: "RPM" | "RPD" | "TPM" | "TPD" | "CONCURRENCY";
  readonly limit?: number;
  readonly remaining?: number;
  readonly resetAt?: Date;
  readonly confidence: number; // 0.0 to 1.0
}

export interface RateLimitState {
  readonly isRateLimited: boolean;
  readonly retryAfterMs?: number;
  readonly cooldownUntil?: Date;
  readonly lastRateLimitedAt?: Date;
}

export interface NormalizedResourceCandidate {
  readonly resourceId: string;
  readonly providerId: string;
  readonly providerSlug: string;
  readonly providerName: string;
  readonly modelId: string;
  readonly modelSlug: string;
  readonly modelName: string;
  readonly credentialId?: string;
  readonly credentialType?: string;
  readonly secretReference?: string;
  
  // Normalized State
  readonly billingClass: ResourceBillingClass;
  readonly isPaid: boolean;
  readonly capabilities: ReadonlyArray<ResourceCapability>;
  readonly health: ResourceHealthState;
  readonly status: "active" | "degraded" | "exhausted" | "disabled" | "retired";
  readonly taxonomy?: ModelTaxonomyProfile;
  
  // Capacity & Quota
  readonly quotas: ReadonlyArray<QuotaDimensionState>;
  readonly primaryQuotaRemaining?: number;
  readonly rateLimit: RateLimitState;
  
  // Performance & Freshness
  readonly latencyP50Ms?: number;
  readonly latencyP95Ms?: number;
  readonly successRate?: number;
  readonly qualityEstimate?: number;
  readonly priority: number;
  
  readonly observedAt: Date;
  readonly confidence: number; // 0.0 to 1.0
}

/**
 * Normalizes string capabilities from database or model metadata into canonical ResourceCapability enum.
 */
export function normalizeCapabilities(rawCaps?: ReadonlyArray<string> | string): ResourceCapability[] {
  if (!rawCaps) return ["TEXT_GENERATION"];
  const list = Array.isArray(rawCaps) ? rawCaps : [rawCaps];
  const normalizedSet = new Set<ResourceCapability>();

  for (const c of list) {
    const upper = String(c).trim().toUpperCase();
    if (upper === "TEXT" || upper === "TEXT_GENERATION") normalizedSet.add("TEXT_GENERATION");
    else if (upper === "JSON" || upper === "JSON_OUTPUT") normalizedSet.add("JSON");
    else if (upper === "STRUCTURED_OUTPUT" || upper === "STRUCTURED") normalizedSet.add("STRUCTURED_OUTPUT");
    else if (upper === "VISION" || upper === "IMAGE") normalizedSet.add("VISION");
    else if (upper === "OCR") normalizedSet.add("OCR");
    else if (upper === "CODE" || upper === "CODING") normalizedSet.add("CODE");
    else if (upper === "REASONING") normalizedSet.add("REASONING");
    else if (upper === "MATH") normalizedSet.add("MATH");
    else if (upper === "LONG_CONTEXT") normalizedSet.add("LONG_CONTEXT");
    else if (upper === "TOOL_CALLING" || upper === "TOOLS" || upper === "FUNCTION_CALLING") normalizedSet.add("TOOL_CALLING");
    else if (upper === "STREAMING") normalizedSet.add("STREAMING");
    else if (upper === "EMBEDDING" || upper === "EMBEDDINGS" || upper === "VECTOR" || upper === "VECTORS") normalizedSet.add("EMBEDDING");
  }

  if (normalizedSet.size === 0) {
    normalizedSet.add("TEXT_GENERATION");
  }

  return Array.from(normalizedSet);
}

/**
 * Normalizes billing class from model metadata and credential type.
 */
export function normalizeBillingClass(params: {
  readonly isPaid?: boolean;
  readonly tier?: string;
  readonly credentialType?: string;
}): { billingClass: ResourceBillingClass; isPaid: boolean } {
  if (params.credentialType === "byok") {
    return { billingClass: "BYOK", isPaid: Boolean(params.isPaid) };
  }
  if (params.credentialType === "internal") {
    return { billingClass: "INTERNAL", isPaid: false };
  }
  const isPaid = Boolean(
    params.isPaid === true ||
    params.tier === "paid" ||
    params.credentialType === "paid"
  );
  return {
    billingClass: isPaid ? "PAID" : "FREE",
    isPaid,
  };
}

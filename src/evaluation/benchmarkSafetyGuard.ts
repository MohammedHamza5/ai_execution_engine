/**
 * Economic and Quota Benchmark Safety Guard
 * Milestone M5-J (M5.11): Zero Silent Paid Spend & Quota Starvation Protection
 * Complies with Anti-Monolith File Law (<= 200 lines)
 */

export interface BenchmarkSafetyPolicy {
  readonly allowPaid: boolean;
  readonly maxTokensPerRun?: number;
  readonly maxCasesPerRun?: number;
}

export const DEFAULT_BENCHMARK_SAFETY_POLICY: BenchmarkSafetyPolicy = {
  allowPaid: false, // Strict Zero Silent Paid Spend
  maxTokensPerRun: 10_000,
  maxCasesPerRun: 20,
};

export class BenchmarkSafetyGuard {
  /**
   * Asserts whether a resource is economically and operationally safe for benchmarking.
   * Throws Error if policy is violated.
   */
  public static validateBenchmarkEligibility(
    billingClass: string,
    policy: BenchmarkSafetyPolicy = DEFAULT_BENCHMARK_SAFETY_POLICY
  ): void {
    if (billingClass === "PAID" && !policy.allowPaid) {
      throw new Error(
        "PAID_BENCHMARK_UNAUTHORIZED: Benchmark execution against paid resource is strictly forbidden without explicit allowPaid=true authorization (ADR-007)."
      );
    }
  }

  /**
   * Validates case count and estimated token load to prevent starving production quotas.
   */
  public static validateWorkloadBounds(
    caseCount: number,
    estimatedTokens: number,
    policy: BenchmarkSafetyPolicy = DEFAULT_BENCHMARK_SAFETY_POLICY
  ): void {
    const maxCases = policy.maxCasesPerRun ?? 20;
    const maxTokens = policy.maxTokensPerRun ?? 10_000;

    if (caseCount > maxCases) {
      throw new Error(`BENCHMARK_OVERLOAD: Case count ${caseCount} exceeds maximum allowed limit ${maxCases}`);
    }

    if (estimatedTokens > maxTokens) {
      throw new Error(`BENCHMARK_QUOTA_PROTECTION: Estimated tokens ${estimatedTokens} exceeds run limit ${maxTokens}`);
    }
  }
}

// ─── Forma Intelligence – ETA Calculator ──────────────────────────────────────
// Calculates estimated remaining time using Critical-Path DAG weighting and latency history.
// Pure function, zero side effects.

import type { DAGNode } from "../types";

export interface ETAResult {
  readonly secondsRemaining: number;
  readonly label: string;
  readonly confidence: "low" | "medium" | "high";
  readonly criticalPathLength: number;
}

const CONFIDENCE_THRESHOLDS = { medium: 2, high: 4 } as const;

/**
 * Calculates remaining completion time based on:
 *   1. Critical path depth of remaining dependency graph (series lower bound)
 *   2. Active parallelism degree (concurrency upper bound)
 *   3. Empirical latency metrics from completed steps
 */
export function calculateETA(
  nodes: ReadonlyArray<DAGNode>,
  parallelismDegree: number,
  criticalPathLength: number = 0,
): ETAResult | null {
  const completed = nodes.filter((n) => n.status === "completed" && n.latencyMs != null && n.latencyMs > 0);
  const remaining = nodes.filter((n) => n.status !== "completed" && n.status !== "failed").length;

  if (completed.length === 0 || remaining === 0) return null;

  const avgMs = completed.reduce((s, n) => s + n.latencyMs!, 0) / completed.length;
  const effectiveParallelism = Math.max(1, parallelismDegree);

  // Critical path steps represent the absolute sequential minimum
  const critSteps = Math.max(1, criticalPathLength);
  const throughputSteps = Math.ceil(remaining / effectiveParallelism);
  const effectiveSteps = Math.max(critSteps, throughputSteps);

  const secondsRemaining = Math.round((effectiveSteps * avgMs) / 1000);

  const confidence: ETAResult["confidence"] =
    completed.length >= CONFIDENCE_THRESHOLDS.high
      ? "high"
      : completed.length >= CONFIDENCE_THRESHOLDS.medium
      ? "medium"
      : "low";

  const label =
    secondsRemaining < 3
      ? "< 3s"
      : secondsRemaining < 60
      ? `~${secondsRemaining}s`
      : secondsRemaining < 3600
      ? `~${Math.ceil(secondsRemaining / 60)}m`
      : `~${(secondsRemaining / 3600).toFixed(1)}h`;

  return { secondsRemaining, label, confidence, criticalPathLength: critSteps };
}

export function formatAvgLatency(avgMs: number | null): string {
  if (avgMs == null || avgMs <= 0) return "—";
  return avgMs >= 1000 ? `${(avgMs / 1000).toFixed(1)}s avg` : `${Math.round(avgMs)}ms avg`;
}

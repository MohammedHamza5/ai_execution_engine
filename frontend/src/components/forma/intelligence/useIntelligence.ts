// ─── Forma Intelligence – useIntelligence Hook ───────────────────────────────
// React hook: memoizes DAG analysis + detects node status transitions.
//
// DESIGN — Race-condition-free toast emission:
//   • prevStatusMap is updated via useEffect AFTER commit.
//   • Transition detection runs inside useMemo so it is pure and
//     stable; results are accumulated in a stable ref that resets
//     each render cycle cleanly.
//   • toastSeq uses crypto.randomUUID (or fallback) to avoid
//     module-level mutable globals that break HMR.

import { useMemo, useRef, useEffect, useCallback } from "react";
import type { DAGNode } from "../types";
import { analyzeDag, type DAGInsights } from "./dagAnalyzer";
import { calculateETA, type ETAResult } from "./etaCalculator";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ToastEvent {
  readonly id: string;
  readonly type: "success" | "error" | "info" | "warning";
  readonly message: string;
}

interface IntelligenceResult {
  readonly insights: DAGInsights;
  readonly eta: ETAResult | null;
  readonly toasts: ReadonlyArray<ToastEvent>;
}

type NodeStatus = DAGNode["status"];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function uid(): string {
  try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random()}`; }
}

function makeToast(type: ToastEvent["type"], message: string): ToastEvent {
  return { id: uid(), type, message };
}

/** Pure: given two snapshots, return transition events. No side-effects. */
function detectTransitions(
  prev: ReadonlyMap<string, NodeStatus>,
  curr: ReadonlyArray<DAGNode>,
): ToastEvent[] {
  const events: ToastEvent[] = [];
  for (const node of curr) {
    const prevStatus = prev.get(node.stepKey);
    if (prevStatus === undefined || prevStatus === node.status) continue;

    if (node.status === "completed" && prevStatus === "running") {
      const ms = node.latencyMs != null ? ` in ${node.latencyMs}ms` : "";
      const q  = node.qualityScore   != null ? ` · quality ${node.qualityScore.toFixed(2)}` : "";
      events.push(makeToast("success", `✅ "${node.name}" completed${ms}${q}`));
    } else if (node.status === "failed" && prevStatus !== "failed") {
      events.push(makeToast("error", `❌ "${node.name}" failed after ${node.attemptsCount} attempt(s)`));
    } else if (node.status === "running" && prevStatus !== "running") {
      events.push(makeToast("info", `▶ "${node.name}" started`));
    } else if (node.status === "diagnosing" && prevStatus !== "diagnosing") {
      events.push(makeToast("warning", `🔍 "${node.name}" is being diagnosed`));
    }
  }
  return events;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useIntelligence(nodes: ReadonlyArray<DAGNode>): IntelligenceResult {
  /** Committed snapshot of statuses — updated after every paint. */
  const committedStatuses = useRef<ReadonlyMap<string, NodeStatus>>(new Map());
  /** Toasts emitted this render cycle, consumed by ToastNotifier. */
  const emittedToastsRef  = useRef<ToastEvent[]>([]);

  // Compute insights & ETA (pure, memoized by nodes reference).
  const insights = useMemo(() => analyzeDag(nodes), [nodes]);
  const eta      = useMemo(
    () => calculateETA(nodes, insights.parallelismDegree, insights.criticalPathLength),
    [nodes, insights.parallelismDegree, insights.criticalPathLength],
  );

  // Detect transitions against the COMMITTED (previous-render) snapshot.
  // This runs synchronously during render — safe because committedStatuses
  // is only written in useEffect (after paint), so it always reflects
  // the previous render's state, never the current one.
  const newToasts = useMemo(
    () => detectTransitions(committedStatuses.current, nodes),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes],
  );

  // Accumulate toasts into the stable ref for this render cycle.
  // Reset first to avoid duplicates across re-renders without node changes.
  emittedToastsRef.current = newToasts;

  // After paint: commit the current status snapshot.
  useEffect(() => {
    committedStatuses.current = new Map(nodes.map((n) => [n.stepKey, n.status]));
  });

  return { insights, eta, toasts: emittedToastsRef.current };
}

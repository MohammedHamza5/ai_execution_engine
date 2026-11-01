// ─── Forma Intelligence – DAG Analyzer ────────────────────────────────────────
// Pure function: computes deep telemetry, critical path, bottlenecks, and commentary.
// Hardened against cycles, NaN timestamps, and malformed inputs.

import type { DAGNode } from "../types";

export type RiskLevel = "healthy" | "warning" | "critical";

export interface BottleneckInfo {
  readonly stepKey: string;
  readonly name: string;
  readonly ratio: number;
  readonly latencyMs: number;
}

export interface DAGInsights {
  readonly commentary: string;
  readonly risk: RiskLevel;
  readonly bottlenecks: ReadonlyArray<BottleneckInfo>;
  readonly parallelismDegree: number;
  readonly newlyUnblockedKeys: ReadonlyArray<string>;
  readonly avgLatencyMs: number | null;
  readonly criticalPathLength: number;
  readonly criticalPathKeys: ReadonlyArray<string>;
}

const BOTTLENECK_RATIO = 1.8;

/** Computes the critical path (longest uncompleted dependency chain) with cycle protection. */
function computeCriticalPath(nodes: ReadonlyArray<DAGNode>): { length: number; keys: string[] } {
  const nodeMap = new Map(nodes.map((n) => [n.stepKey, n]));
  const remainingNodes = nodes.filter((n) => n.status !== "completed");
  if (remainingNodes.length === 0) return { length: 0, keys: [] };

  const memo = new Map<string, { length: number; path: string[] }>();
  const visiting = new Set<string>();

  function dfs(stepKey: string): { length: number; path: string[] } {
    if (memo.has(stepKey)) return memo.get(stepKey)!;
    // Cycle detection: break early if node is already on current recursion stack
    if (visiting.has(stepKey)) return { length: 0, path: [] };

    const node = nodeMap.get(stepKey);
    if (!node || node.status === "completed") return { length: 0, path: [] };

    visiting.add(stepKey);
    let maxChild = { length: 0, path: [] as string[] };
    for (const downstreamKey of node.downstream || []) {
      const childRes = dfs(downstreamKey);
      if (childRes.length > maxChild.length) {
        maxChild = childRes;
      }
    }
    visiting.delete(stepKey);

    const current = {
      length: maxChild.length + 1,
      path: [stepKey, ...maxChild.path],
    };
    memo.set(stepKey, current);
    return current;
  }

  let longest = { length: 0, path: [] as string[] };
  for (const n of remainingNodes) {
    const res = dfs(n.stepKey);
    if (res.length > longest.length) longest = res;
  }

  return { length: longest.length, keys: longest.path };
}

function buildCommentary(
  nodes: ReadonlyArray<DAGNode>,
  running: DAGNode[],
  diagnosing: DAGNode[],
  bottlenecks: BottleneckInfo[],
  parallelism: number,
  critLength: number,
): string {
  const total = nodes.length;
  if (total === 0) {
    return "ℹ️ No task nodes defined in this workflow.";
  }

  const completed = nodes.filter((n) => n.status === "completed").length;
  const failed = nodes.filter((n) => n.status === "failed").length;

  if (failed > 0) {
    return `⚠️ ${failed} step${failed > 1 ? "s" : ""} failed — fencing policies activated.`;
  }
  if (diagnosing.length > 0) {
    return `🔍 Step "${diagnosing[0].name}" is actively diagnosing failure recovery.`;
  }
  if (completed === total) {
    return `✅ All ${total} steps completed successfully with zero silent spend.`;
  }
  if (bottlenecks.length > 0) {
    const b = bottlenecks[0];
    return `🐢 "${b.name}" is ${b.ratio.toFixed(1)}× slower than average — bottleneck detected.`;
  }
  if (completed === 0 && running.length === 0) {
    return `⏳ Initializing pipeline — waiting for free-tier worker allocation.`;
  }
  if (running.length === 0) {
    return `⏳ ${total - completed} steps pending upstream dependency completion.`;
  }
  if (parallelism >= 2) {
    return `⚡ ${parallelism} parallel branches executing — critical path depth: ${critLength}.`;
  }
  return `🔄 Executing "${running[0].name}" (${completed}/${total} completed).`;
}

export function analyzeDag(nodes: ReadonlyArray<DAGNode>): DAGInsights {
  const completed = nodes.filter((n) => n.status === "completed");
  const running = nodes.filter((n) => n.status === "running");
  const diagnosing = nodes.filter((n) => n.status === "diagnosing");
  const pending = nodes.filter((n) => n.status === "pending" || n.status === "blocked");

  const withLatency = completed.filter(
    (n) => typeof n.latencyMs === "number" && !Number.isNaN(n.latencyMs) && n.latencyMs > 0,
  );
  const avgLatencyMs = withLatency.length > 0
    ? withLatency.reduce((s, n) => s + n.latencyMs!, 0) / withLatency.length
    : null;

  const now = Date.now();
  const bottlenecks: BottleneckInfo[] = avgLatencyMs
    ? running
        .map((n) => {
          const parsed = n.startedAt ? Date.parse(n.startedAt) : NaN;
          const elapsed = !Number.isNaN(parsed) ? Math.max(0, now - parsed) : 0;
          const effLatency =
            typeof n.latencyMs === "number" && !Number.isNaN(n.latencyMs) && n.latencyMs > 0
              ? n.latencyMs
              : elapsed;
          return { node: n, effLatency };
        })
        .filter(({ effLatency }) => effLatency > avgLatencyMs * BOTTLENECK_RATIO)
        .map(({ node, effLatency }) => ({
          stepKey: node.stepKey,
          name: node.name,
          ratio: effLatency / avgLatencyMs,
          latencyMs: effLatency,
        }))
        .sort((a, b) => b.ratio - a.ratio)
    : [];

  const completedKeys = new Set(completed.map((n) => n.stepKey));
  const newlyUnblockedKeys = pending
    .filter((n) => n.dependencies.length > 0 && n.dependencies.every((d) => completedKeys.has(d)))
    .map((n) => n.stepKey);

  const crit = computeCriticalPath(nodes);

  const risk: RiskLevel =
    nodes.some((n) => n.status === "failed")
      ? "critical"
      : diagnosing.length > 0 || bottlenecks.length > 0
      ? "warning"
      : "healthy";

  const commentary = buildCommentary(
    nodes, running, diagnosing, bottlenecks, running.length, crit.length,
  );

  return {
    commentary,
    risk,
    bottlenecks,
    parallelismDegree: running.length,
    newlyUnblockedKeys,
    avgLatencyMs,
    criticalPathLength: crit.length,
    criticalPathKeys: crit.keys,
  };
}

import { describe, it, expect } from "vitest";
import { computeLayout } from "../frontend/src/components/forma/layoutEngine";
import { analyzeDag } from "../frontend/src/components/forma/intelligence/dagAnalyzer";
import { calculateETA } from "../frontend/src/components/forma/intelligence/etaCalculator";
import type { DAGNode } from "../frontend/src/components/forma/types";

function createMockNode(partial: Partial<DAGNode> & { stepKey: string }): DAGNode {
  return {
    stepKey: partial.stepKey,
    planStepId: `plan-${partial.stepKey}`,
    stepExecutionId: `exec-${partial.stepKey}`,
    name: partial.name ?? `Step ${partial.stepKey}`,
    stepType: partial.stepType ?? "model_inference",
    orderIndex: partial.orderIndex ?? 1,
    status: partial.status ?? "pending",
    dependencies: partial.dependencies ?? [],
    downstream: partial.downstream ?? [],
    attemptsCount: partial.attemptsCount ?? 1,
    fencingToken: partial.fencingToken ?? 1,
    latencyMs: partial.latencyMs,
    startedAt: partial.startedAt,
    completedAt: partial.completedAt,
    qualityScore: partial.qualityScore,
    assignedResource: partial.assignedResource,
  };
}

describe("Forma Layout Engine", () => {
  it("computes deterministic column slots using longest-path BFS", () => {
    const nodes: DAGNode[] = [
      createMockNode({ stepKey: "A", orderIndex: 1, downstream: ["B", "C"] }),
      createMockNode({ stepKey: "B", orderIndex: 2, dependencies: ["A"], downstream: ["D"] }),
      createMockNode({ stepKey: "C", orderIndex: 3, dependencies: ["A"], downstream: ["D"] }),
      createMockNode({ stepKey: "D", orderIndex: 4, dependencies: ["B", "C"] }),
    ];

    const layout = computeLayout(nodes);
    expect(layout.totalCols).toBe(3); // Col 0: A, Col 1: B, C, Col 2: D
    expect(layout.nodes).toHaveLength(4);

    const aLayout = layout.nodes.find((n) => n.node.stepKey === "A");
    const dLayout = layout.nodes.find((n) => n.node.stepKey === "D");
    expect(aLayout?.col).toBe(0);
    expect(dLayout?.col).toBe(2);
    expect(layout.edges).toHaveLength(4);
  });

  it("handles empty node set safely", () => {
    const layout = computeLayout([]);
    expect(layout.totalCols).toBe(0);
    expect(layout.nodes).toHaveLength(0);
  });
});

describe("Forma DAG Intelligence Analyzer", () => {
  it("detects running bottleneck if latency exceeds 1.8x average", () => {
    const nodes: DAGNode[] = [
      createMockNode({ stepKey: "A", status: "completed", latencyMs: 1000 }),
      createMockNode({ stepKey: "B", status: "completed", latencyMs: 1200 }),
      createMockNode({ stepKey: "C", status: "running", latencyMs: 2500 }), // 2500 > 1100 * 1.8 (1980)
    ];

    const insights = analyzeDag(nodes);
    expect(insights.risk).toBe("warning");
    expect(insights.bottlenecks).toHaveLength(1);
    expect(insights.bottlenecks[0].stepKey).toBe("C");
    expect(insights.bottlenecks[0].ratio).toBeGreaterThan(2);
  });

  it("identifies critical path length correctly", () => {
    const nodes: DAGNode[] = [
      createMockNode({ stepKey: "A", status: "completed", downstream: ["B"] }),
      createMockNode({ stepKey: "B", status: "running", dependencies: ["A"], downstream: ["C"] }),
      createMockNode({ stepKey: "C", status: "pending", dependencies: ["B"] }),
    ];

    const insights = analyzeDag(nodes);
    expect(insights.criticalPathLength).toBe(2); // Remaining: B -> C
    expect(insights.criticalPathKeys).toEqual(["B", "C"]);
  });

  it("marks risk as critical if any step fails", () => {
    const nodes: DAGNode[] = [
      createMockNode({ stepKey: "A", status: "failed", attemptsCount: 3 }),
    ];
    const insights = analyzeDag(nodes);
    expect(insights.risk).toBe("critical");
    expect(insights.commentary).toContain("failed");
  });
});

describe("Forma Critical-Path ETA Calculator", () => {
  it("calculates ETA based on critical path lower-bound and concurrency", () => {
    const nodes: DAGNode[] = [
      createMockNode({ stepKey: "A", status: "completed", latencyMs: 2000 }),
      createMockNode({ stepKey: "B", status: "running" }),
      createMockNode({ stepKey: "C", status: "pending" }),
    ];

    const eta = calculateETA(nodes, 1, 2);
    expect(eta).not.toBeNull();
    // 2 remaining steps in series with avg 2000ms = 4 seconds
    expect(eta?.secondsRemaining).toBe(4);
    expect(eta?.label).toBe("~4s");
    expect(eta?.criticalPathLength).toBe(2);
  });

  it("returns null when no steps are completed yet", () => {
    const nodes: DAGNode[] = [
      createMockNode({ stepKey: "A", status: "pending" }),
    ];
    const eta = calculateETA(nodes, 1, 1);
    expect(eta).toBeNull();
  });
});

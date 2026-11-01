import { describe, it, expect } from "vitest";
import { computeLayout } from "../frontend/src/components/forma/layoutEngine";
import { analyzeDag } from "../frontend/src/components/forma/intelligence/dagAnalyzer";
import { calculateETA } from "../frontend/src/components/forma/intelligence/etaCalculator";
import type { DAGNode } from "../frontend/src/components/forma/types";

function mockNode(stepKey: string, overrides: Partial<DAGNode> = {}): DAGNode {
  return {
    stepKey,
    planStepId: `plan-${stepKey}`,
    stepExecutionId: `exec-${stepKey}`,
    name: overrides.name ?? `Step ${stepKey}`,
    stepType: overrides.stepType ?? "model_inference",
    orderIndex: overrides.orderIndex ?? 1,
    status: overrides.status ?? "pending",
    dependencies: overrides.dependencies ?? [],
    downstream: overrides.downstream ?? [],
    attemptsCount: overrides.attemptsCount ?? 1,
    fencingToken: overrides.fencingToken ?? 1,
    latencyMs: overrides.latencyMs,
    startedAt: overrides.startedAt,
    completedAt: overrides.completedAt,
    qualityScore: overrides.qualityScore,
    assignedResource: overrides.assignedResource,
  };
}

describe("Forma Adversarial & Edge Case Stress Matrix", () => {
  describe("1. Cyclic and Malformed Graph Topologies", () => {
    it("handles cyclic dependencies without infinite looping / stack overflow", () => {
      // Malformed input: A depends on B, and B depends on A
      const nodes: DAGNode[] = [
        mockNode("A", { dependencies: ["B"], downstream: ["B"] }),
        mockNode("B", { dependencies: ["A"], downstream: ["A"] }),
      ];

      // Does computeLayout handle cycles gracefully?
      const startTime = Date.now();
      const layout = computeLayout(nodes);
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(1000); // Must not hang
      expect(layout.nodes).toHaveLength(2);

      // Does analyzeDag handle cycles without RangeError: Maximum call stack size exceeded?
      const insights = analyzeDag(nodes);
      expect(insights).toBeDefined();
    });

    it("handles missing/orphan dependency keys in dependencies array", () => {
      const nodes: DAGNode[] = [
        mockNode("A", { dependencies: ["NON_EXISTENT_KEY"] }),
      ];

      const layout = computeLayout(nodes);
      expect(layout.nodes).toHaveLength(1);

      // What does critical path do?
      const insights = analyzeDag(nodes);
      expect(insights.risk).toBeDefined();
    });

    it("handles disconnected islands (multiple independent roots)", () => {
      const nodes: DAGNode[] = [
        mockNode("Island1_A", { orderIndex: 1, downstream: ["Island1_B"] }),
        mockNode("Island1_B", { orderIndex: 2, dependencies: ["Island1_A"] }),
        mockNode("Island2_A", { orderIndex: 3, downstream: ["Island2_B"] }),
        mockNode("Island2_B", { orderIndex: 4, dependencies: ["Island2_A"] }),
      ];

      const layout = computeLayout(nodes);
      expect(layout.totalCols).toBe(2);
      expect(layout.nodes).toHaveLength(4);
    });

    it("handles massive fan-out (1 root -> 50 parallel children -> 1 join)", () => {
      const children: DAGNode[] = [];
      const childKeys: string[] = [];
      for (let i = 0; i < 50; i++) {
        const key = `child_${i}`;
        childKeys.push(key);
        children.push(mockNode(key, { orderIndex: i + 2, dependencies: ["root"], downstream: ["join"] }));
      }

      const nodes: DAGNode[] = [
        mockNode("root", { orderIndex: 1, downstream: childKeys }),
        ...children,
        mockNode("join", { orderIndex: 52, dependencies: childKeys }),
      ];

      const startTime = Date.now();
      const layout = computeLayout(nodes);
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(500);
      expect(layout.totalCols).toBe(3);
      expect(layout.nodes).toHaveLength(52);
      expect(layout.maxRows).toBe(50);
    });

    it("handles deep linear chain (30 sequential nodes)", () => {
      const nodes: DAGNode[] = [];
      for (let i = 0; i < 30; i++) {
        const key = `step_${i}`;
        const prev = i > 0 ? [`step_${i - 1}`] : [];
        const next = i < 29 ? [`step_${i + 1}`] : [];
        nodes.push(mockNode(key, { orderIndex: i + 1, dependencies: prev, downstream: next }));
      }

      const layout = computeLayout(nodes);
      expect(layout.totalCols).toBe(30);
      expect(layout.maxRows).toBe(1);

      const insights = analyzeDag(nodes);
      expect(insights.criticalPathLength).toBe(30);
    });
  });

  describe("2. Clock Skew and Corrupted Latency Timestamps", () => {
    it("handles invalid date strings in startedAt without throwing NaN or crashing", () => {
      const nodes: DAGNode[] = [
        mockNode("A", { status: "completed", latencyMs: 1000 }),
        mockNode("B", { status: "running", startedAt: "NOT_A_VALID_DATE_STRING" }),
      ];

      const insights = analyzeDag(nodes);
      expect(insights).toBeDefined();
      expect(insights.bottlenecks).toBeDefined();
      // Must not throw or produce NaN ratios
      for (const b of insights.bottlenecks) {
        expect(Number.isNaN(b.ratio)).toBe(false);
        expect(Number.isNaN(b.latencyMs)).toBe(false);
      }
    });

    it("handles future startedAt (negative elapsed time from clock drift)", () => {
      const futureTime = new Date(Date.now() + 1000000).toISOString();
      const nodes: DAGNode[] = [
        mockNode("A", { status: "completed", latencyMs: 1000 }),
        mockNode("B", { status: "running", startedAt: futureTime }),
      ];

      const insights = analyzeDag(nodes);
      expect(insights).toBeDefined();
      for (const b of insights.bottlenecks) {
        expect(b.latencyMs).toBeGreaterThanOrEqual(0);
      }
    });

    it("handles zero or negative latencyMs on completed nodes", () => {
      const nodes: DAGNode[] = [
        mockNode("A", { status: "completed", latencyMs: 0 }),
        mockNode("B", { status: "completed", latencyMs: -500 }),
      ];

      const insights = analyzeDag(nodes);
      expect(insights.avgLatencyMs).toBeNull(); // Should ignore 0 and negative latencies

      const eta = calculateETA(nodes, 1, 1);
      expect(eta).toBeNull(); // Can't compute ETA with zero valid latencies
    });
  });

  describe("3. Extreme String and XSS Edge Cases", () => {
    it("handles XSS payloads and HTML tags in stepKey and name safely", () => {
      const maliciousKey = '<script>alert("XSS")</script>';
      const maliciousName = '"><img src=x onerror=alert(1)>';
      const nodes: DAGNode[] = [
        mockNode(maliciousKey, { name: maliciousName, status: "running" }),
      ];

      const layout = computeLayout(nodes);
      expect(layout.nodes).toHaveLength(1);
      expect(layout.nodes[0].node.stepKey).toBe(maliciousKey);

      const insights = analyzeDag(nodes);
      expect(insights.commentary).toContain(maliciousName);
    });

    it("handles Arabic, RTL, and emoji characters properly", () => {
      const nodes: DAGNode[] = [
        mockNode("step_ar", { name: "توليد كود الـ PostgreSQL 🔥", status: "running" }),
      ];

      const insights = analyzeDag(nodes);
      expect(insights.commentary).toContain("توليد كود الـ PostgreSQL 🔥");
    });
  });
});

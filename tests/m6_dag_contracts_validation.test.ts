import { describe, it, expect } from "vitest";
import { DAGValidator } from "../src/engine/dagValidator.js";
import { DAGNodeContract, DAGPlanContract } from "../src/domain/dag/types.js";

describe("Milestone M6.1 — DAG Contracts & Validation Suite", () => {
  it("enforces 100% deterministic topological ordering via tie-breaking", () => {
    // 4 independent root nodes in random order
    const nodes: DAGNodeContract[] = [
      { stepKey: "delta", name: "D", stepType: "model_inference", dependencies: [] },
      { stepKey: "alpha", name: "A", stepType: "model_inference", dependencies: [] },
      { stepKey: "gamma", name: "C", stepType: "model_inference", dependencies: [] },
      { stepKey: "beta", name: "B", stepType: "model_inference", dependencies: [] },
    ];

    // Running multiple times must yield exact same alphabetical order
    for (let i = 0; i < 5; i++) {
      const res = DAGValidator.validate(nodes);
      expect(res.valid).toBe(true);
      expect(res.sortedStepKeys).toEqual(["alpha", "beta", "delta", "gamma"]);
    }
  });

  it("calculates exact graph depth and enforces depth limits", () => {
    // Linear chain of 4 steps: depth = 4
    const nodes: DAGNodeContract[] = [
      { stepKey: "s1", name: "1", stepType: "model_inference", dependencies: [] },
      { stepKey: "s2", name: "2", stepType: "transformation", dependencies: ["s1"] },
      { stepKey: "s3", name: "3", stepType: "transformation", dependencies: ["s2"] },
      { stepKey: "s4", name: "4", stepType: "synthesis", dependencies: ["s3"] },
    ];

    const plan: DAGPlanContract = {
      planId: "plan-1",
      planVersion: 1,
      nodes,
      maxDepthLimit: 3, // Strict limit of 3
    };

    const failedRes = DAGValidator.validate(plan);
    expect(failedRes.valid).toBe(false);
    expect(failedRes.errors[0]).toContain("exceeds maximum allowed depth limit of 3");

    // Pass when limit is 5
    const passedRes = DAGValidator.validate({ ...plan, maxDepthLimit: 5 });
    expect(passedRes.valid).toBe(true);
    expect(passedRes.maxDepth).toBe(4);
  });

  it("enforces maximum step count limits", () => {
    const nodes: DAGNodeContract[] = [
      { stepKey: "s1", name: "1", stepType: "model_inference", dependencies: [] },
      { stepKey: "s2", name: "2", stepType: "model_inference", dependencies: [] },
      { stepKey: "s3", name: "3", stepType: "model_inference", dependencies: [] },
    ];

    const plan: DAGPlanContract = {
      planId: "plan-2",
      planVersion: 1,
      nodes,
      maxStepLimit: 2, // Limit is 2 but 3 nodes given
    };

    const res = DAGValidator.validate(plan);
    expect(res.valid).toBe(false);
    expect(res.errors[0]).toContain("exceeds maximum allowed step count of 2");
  });

  it("rejects blank or invalid step keys", () => {
    const nodes: DAGNodeContract[] = [
      { stepKey: "   ", name: "Blank", stepType: "model_inference", dependencies: [] },
    ];
    const res = DAGValidator.validate(nodes);
    expect(res.valid).toBe(false);
    expect(res.errors[0]).toContain("empty or blank");
  });

  it("rejects unknown step types", () => {
    const nodes: any[] = [
      { stepKey: "s1", name: "Invalid", stepType: "unsupported_magic_type", dependencies: [] },
    ];
    const res = DAGValidator.validate(nodes);
    expect(res.valid).toBe(false);
    expect(res.errors[0]).toContain("Unknown stepType");
  });

  it("rejects duplicate dependencies on the same step", () => {
    const nodes: DAGNodeContract[] = [
      { stepKey: "root", name: "Root", stepType: "model_inference", dependencies: [] },
      { stepKey: "child", name: "Child", stepType: "transformation", dependencies: ["root", "root"] },
    ];
    const res = DAGValidator.validate(nodes);
    expect(res.valid).toBe(false);
    expect(res.errors[0]).toContain("Duplicate dependency");
  });

  it("rejects inputReferences that are not declared as dependencies", () => {
    const nodes: DAGNodeContract[] = [
      { stepKey: "s1", name: "1", stepType: "model_inference", dependencies: [] },
      { stepKey: "s2", name: "2", stepType: "model_inference", dependencies: [] },
      {
        stepKey: "s3",
        name: "3",
        stepType: "synthesis",
        dependencies: ["s1"], // Declares s1 only
        inputReferences: [{ sourceStepKey: "s2", artifactType: "text" }], // Requires s2 without dependency!
      },
    ];
    const res = DAGValidator.validate(nodes);
    expect(res.valid).toBe(false);
    expect(res.errors[0]).toContain("without declaring it as a dependency");
  });

  it("validates complex diamond fork-join workflow", () => {
    // A -> (B, C) -> D -> E
    const nodes: DAGNodeContract[] = [
      { stepKey: "start", name: "A", stepType: "model_inference", dependencies: [] },
      { stepKey: "worker_1", name: "B", stepType: "model_inference", dependencies: ["start"] },
      { stepKey: "worker_2", name: "C", stepType: "model_inference", dependencies: ["start"] },
      { stepKey: "join", name: "D", stepType: "aggregation", dependencies: ["worker_1", "worker_2"] },
      { stepKey: "final_report", name: "E", stepType: "synthesis", dependencies: ["join"] },
    ];

    const res = DAGValidator.validate(nodes);
    expect(res.valid).toBe(true);
    expect(res.rootStepKeys).toEqual(["start"]);
    expect(res.terminalStepKeys).toEqual(["final_report"]);
    expect(res.maxDepth).toBe(4);
    expect(res.sortedStepKeys).toEqual(["start", "worker_1", "worker_2", "join", "final_report"]);
  });
});

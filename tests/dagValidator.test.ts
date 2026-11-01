import { describe, it, expect } from "vitest";
import { DAGValidator, DAGNode } from "../src/engine/dagValidator.js";

describe("DAGValidator Tests (M4.1)", () => {
  it("validates and sorts a linear DAG: A -> B -> C", () => {
    const nodes: DAGNode[] = [
      { stepKey: "step_c", dependencies: ["step_b"] },
      { stepKey: "step_a", dependencies: [] },
      { stepKey: "step_b", dependencies: ["step_a"] },
    ];

    const result = DAGValidator.validate(nodes);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.sortedStepKeys).toEqual(["step_a", "step_b", "step_c"]);
    expect(result.rootStepKeys).toEqual(["step_a"]);
    expect(result.terminalStepKeys).toEqual(["step_c"]);
  });

  it("validates and sorts a diamond DAG: A -> (B, C) -> D", () => {
    const nodes: DAGNode[] = [
      { stepKey: "step_a", dependencies: [] },
      { stepKey: "step_b", dependencies: ["step_a"] },
      { stepKey: "step_c", dependencies: ["step_a"] },
      { stepKey: "step_d", dependencies: ["step_b", "step_c"] },
    ];

    const result = DAGValidator.validate(nodes);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.rootStepKeys).toEqual(["step_a"]);
    expect(result.terminalStepKeys).toEqual(["step_d"]);
    expect(result.sortedStepKeys[0]).toBe("step_a");
    expect(result.sortedStepKeys[3]).toBe("step_d");
    expect(result.sortedStepKeys.slice(1, 3)).toEqual(expect.arrayContaining(["step_b", "step_c"]));
  });

  it("validates independent parallel nodes without dependencies", () => {
    const nodes: DAGNode[] = [
      { stepKey: "step_1", dependencies: [] },
      { stepKey: "step_2", dependencies: [] },
      { stepKey: "step_3", dependencies: [] },
    ];

    const result = DAGValidator.validate(nodes);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.rootStepKeys).toEqual(expect.arrayContaining(["step_1", "step_2", "step_3"]));
    expect(result.terminalStepKeys).toEqual(expect.arrayContaining(["step_1", "step_2", "step_3"]));
    expect(result.sortedStepKeys).toHaveLength(3);
  });

  it("rejects direct circular cycle: A -> B -> A", () => {
    const nodes: DAGNode[] = [
      { stepKey: "step_a", dependencies: ["step_b"] },
      { stepKey: "step_b", dependencies: ["step_a"] },
    ];

    const result = DAGValidator.validate(nodes);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/cycle/i);
  });

  it("rejects indirect circular cycle: A -> B -> C -> A", () => {
    const nodes: DAGNode[] = [
      { stepKey: "step_a", dependencies: ["step_c"] },
      { stepKey: "step_b", dependencies: ["step_a"] },
      { stepKey: "step_c", dependencies: ["step_b"] },
    ];

    const result = DAGValidator.validate(nodes);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/cycle/i);
  });

  it("rejects self-dependency: A -> A", () => {
    const nodes: DAGNode[] = [
      { stepKey: "step_a", dependencies: ["step_a"] },
    ];

    const result = DAGValidator.validate(nodes);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/self-dependency/i);
  });

  it("rejects reference to non-existent step", () => {
    const nodes: DAGNode[] = [
      { stepKey: "step_a", dependencies: ["step_unknown"] },
    ];

    const result = DAGValidator.validate(nodes);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/non-existent step/i);
  });

  it("rejects duplicate step keys", () => {
    const nodes: DAGNode[] = [
      { stepKey: "step_a", dependencies: [] },
      { stepKey: "step_a", dependencies: [] },
    ];

    const result = DAGValidator.validate(nodes);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/duplicate stepKey/i);
  });

  it("rejects empty node array", () => {
    const result = DAGValidator.validate([]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/at least one step/i);
  });
});

import type {
  DAGNodeContract,
  DAGPlanContract,
  DAGValidationResult,
} from "../domain/dag/types.js";

export type DAGNode = DAGNodeContract;
export type { DAGValidationResult };

const VALID_STEP_TYPES: Set<string> = new Set([
  "model_inference",
  "transformation",
  "validation",
  "synthesis",
  "aggregation",
  "tool_call",
]);

export class DAGValidator {
  public static readonly DEFAULT_MAX_STEPS = 100;
  public static readonly DEFAULT_MAX_DEPTH = 20;

  public static validate(
    nodesOrPlan: ReadonlyArray<DAGNodeContract> | DAGPlanContract
  ): DAGValidationResult {
    const isPlan = !Array.isArray(nodesOrPlan);
    const nodes: ReadonlyArray<DAGNodeContract> = isPlan
      ? (nodesOrPlan as DAGPlanContract).nodes
      : (nodesOrPlan as ReadonlyArray<DAGNodeContract>);
    const maxSteps =
      (isPlan && (nodesOrPlan as DAGPlanContract).maxStepLimit) || this.DEFAULT_MAX_STEPS;
    const maxDepthLimit =
      (isPlan && (nodesOrPlan as DAGPlanContract).maxDepthLimit) || this.DEFAULT_MAX_DEPTH;
    const errors: string[] = [];

    if (!nodes || nodes.length === 0) {
      return this.failResult(["DAG must contain at least one step."]);
    }
    if (nodes.length > maxSteps) {
      return this.failResult([`DAG exceeds maximum allowed step count of ${maxSteps} (received ${nodes.length}).`]);
    }

    // 1. Check for empty keys, invalid identifiers, and duplicates
    const nodeMap = new Map<string, DAGNodeContract>();
    for (const node of nodes) {
      if (!node.stepKey || typeof node.stepKey !== "string" || node.stepKey.trim() === "") {
        errors.push("Step key cannot be empty or blank.");
        continue;
      }
      if (nodeMap.has(node.stepKey)) {
        errors.push(`Duplicate stepKey detected: "${node.stepKey}". Step keys must be unique within a plan.`);
      }
      if (node.stepType && !VALID_STEP_TYPES.has(node.stepType)) {
        errors.push(`Unknown stepType "${node.stepType}" on step "${node.stepKey}".`);
      }
      nodeMap.set(node.stepKey, node);
    }
    if (errors.length > 0) return this.failResult(errors);

    // 2. Build graph adjacency list and calculate in-degrees
    const inDegreeMap: Record<string, number> = {};
    const downstreamMap: Record<string, string[]> = {};
    for (const node of nodes) {
      inDegreeMap[node.stepKey] = 0;
      downstreamMap[node.stepKey] = [];
    }

    for (const node of nodes) {
      const deps = node.dependencies || [];
      const seenDeps = new Set<string>();

      for (const depKey of deps) {
        if (depKey === node.stepKey) {
          errors.push(`Self-dependency detected on step "${node.stepKey}". A step cannot depend on itself.`);
          continue;
        }
        if (!nodeMap.has(depKey)) {
          errors.push(`Step "${node.stepKey}" depends on non-existent step "${depKey}".`);
          continue;
        }
        if (seenDeps.has(depKey)) {
          errors.push(`Duplicate dependency "${depKey}" detected on step "${node.stepKey}".`);
          continue;
        }
        seenDeps.add(depKey);
        downstreamMap[depKey].push(node.stepKey);
        inDegreeMap[node.stepKey] = (inDegreeMap[node.stepKey] || 0) + 1;
      }

      if (node.inputReferences) {
        for (const inputRef of node.inputReferences) {
          if (!nodeMap.has(inputRef.sourceStepKey)) {
            errors.push(`Step "${node.stepKey}" references non-existent input step "${inputRef.sourceStepKey}".`);
          } else if (!deps.includes(inputRef.sourceStepKey)) {
            errors.push(`Step "${node.stepKey}" requires input from "${inputRef.sourceStepKey}" without declaring it as a dependency.`);
          }
        }
      }
    }
    if (errors.length > 0) return this.failResult(errors, inDegreeMap, downstreamMap);

    // 3. Kahn's Algorithm with Deterministic Tie-Breaking (Alphabetical)
    const availableRoots: string[] = [];
    const rootStepKeys: string[] = [];
    const terminalStepKeys: string[] = [];

    for (const [stepKey, inDegree] of Object.entries(inDegreeMap)) {
      if (inDegree === 0) {
        availableRoots.push(stepKey);
        rootStepKeys.push(stepKey);
      }
      if (downstreamMap[stepKey].length === 0) terminalStepKeys.push(stepKey);
    }

    if (availableRoots.length === 0) {
      return this.failResult(
        ["Circular dependency cycle detected: no root step with 0 dependencies found."],
        inDegreeMap,
        downstreamMap,
        terminalStepKeys,
        nodes.map((n: DAGNodeContract) => n.stepKey)
      );
    }

    availableRoots.sort();
    const sortedStepKeys: string[] = [];
    const currentInDegrees = { ...inDegreeMap };
    const stepDepthMap: Record<string, number> = {};
    for (const root of availableRoots) stepDepthMap[root] = 1;

    const queue = [...availableRoots];
    let maxCalculatedDepth = 1;

    while (queue.length > 0) {
      const current = queue.shift()!;
      sortedStepKeys.push(current);
      const currentDepth = stepDepthMap[current] || 1;

      const nextReady: string[] = [];
      for (const downstream of downstreamMap[current]) {
        currentInDegrees[downstream]--;
        stepDepthMap[downstream] = Math.max(stepDepthMap[downstream] || 1, currentDepth + 1);
        maxCalculatedDepth = Math.max(maxCalculatedDepth, stepDepthMap[downstream]);
        if (currentInDegrees[downstream] === 0) nextReady.push(downstream);
      }
      nextReady.sort();
      queue.push(...nextReady);
    }

    if (maxCalculatedDepth > maxDepthLimit) {
      errors.push(`DAG depth ${maxCalculatedDepth} exceeds maximum allowed depth limit of ${maxDepthLimit}.`);
    }

    if (sortedStepKeys.length !== nodes.length) {
      const unvisited = nodes
        .filter((n: DAGNodeContract) => !sortedStepKeys.includes(n.stepKey))
        .map((n: DAGNodeContract) => n.stepKey);
      errors.push(`Circular dependency cycle detected involving steps: ${unvisited.join(", ")}.`);
      return this.failResult(errors, inDegreeMap, downstreamMap, terminalStepKeys, unvisited, maxCalculatedDepth);
    }

    if (errors.length > 0) {
      return this.failResult(errors, inDegreeMap, downstreamMap, terminalStepKeys, [], maxCalculatedDepth);
    }

    return {
      valid: true,
      errors: [],
      sortedStepKeys,
      rootStepKeys: rootStepKeys.sort(),
      terminalStepKeys: terminalStepKeys.sort(),
      inDegreeMap,
      downstreamMap,
      maxDepth: maxCalculatedDepth,
    };
  }

  private static failResult(
    errors: string[],
    inDegreeMap: Record<string, number> = {},
    downstreamMap: Record<string, string[]> = {},
    terminalStepKeys: string[] = [],
    cycleNodes: string[] = [],
    maxDepth: number = 0
  ): DAGValidationResult {
    return {
      valid: false,
      errors,
      sortedStepKeys: [],
      rootStepKeys: [],
      terminalStepKeys,
      inDegreeMap,
      downstreamMap,
      maxDepth,
      cycleNodes: cycleNodes.length > 0 ? cycleNodes : undefined,
    };
  }
}

// ─── Forma Canvas – Layout Engine ──────────────────────────────────────────────
// Pure deterministic layout algorithm.
// Input: flat DAGNode array  →  Output: LayoutResult with (col, row) per node.
// Algorithm: Kahn's BFS topological sort, column = longest-path from roots.
// Hardened against cycles, orphan dependencies, and disconnected subgraphs.

import type { DAGNode, CanvasEdge, LayoutResult, NodeLayout } from "./types";

/** Build an adjacency map: stepKey → downstream stepKeys */
function buildAdjacency(nodes: ReadonlyArray<DAGNode>): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const n of nodes) map.set(n.stepKey, []);
  for (const n of nodes) {
    for (const dep of n.dependencies) {
      const arr = map.get(dep);
      if (arr) arr.push(n.stepKey);
    }
  }
  return map;
}

/** Assign each node a column = longest path from any root with cycle fallback. */
function computeColumns(nodes: ReadonlyArray<DAGNode>): Map<string, number> {
  const col = new Map<string, number>();
  const inDeg = new Map<string, number>();
  const validKeys = new Set(nodes.map((n) => n.stepKey));

  for (const n of nodes) {
    col.set(n.stepKey, 0);
    // Only count dependencies that exist in the active node graph
    const validDeps = n.dependencies.filter((d) => validKeys.has(d));
    inDeg.set(n.stepKey, validDeps.length);
  }

  const adj = buildAdjacency(nodes);
  const queue: string[] = [];

  for (const [key, deg] of inDeg) {
    if (deg === 0) queue.push(key);
  }

  let processedCount = 0;
  while (queue.length > 0) {
    const key = queue.shift()!;
    processedCount++;
    const c = col.get(key) ?? 0;
    for (const child of adj.get(key) ?? []) {
      const prev = col.get(child) ?? 0;
      col.set(child, Math.max(prev, c + 1));
      const newDeg = (inDeg.get(child) ?? 1) - 1;
      inDeg.set(child, newDeg);
      if (newDeg === 0) queue.push(child);
    }
  }

  // Cycle recovery: if circular dependencies prevented some nodes from reaching inDeg=0,
  // distribute unplaced nodes to prevent overlapping collisions at column 0.
  if (processedCount < nodes.length) {
    let fallbackCol = Math.max(0, ...col.values()) + 1;
    for (const n of nodes) {
      if ((inDeg.get(n.stepKey) ?? 0) > 0) {
        col.set(n.stepKey, fallbackCol++);
      }
    }
  }

  return col;
}

/** Main export: compute a deterministic 2-D grid layout for the DAG. */
export function computeLayout(nodes: ReadonlyArray<DAGNode>): LayoutResult {
  if (nodes.length === 0) {
    return { nodes: [], edges: [], totalCols: 0, maxRows: 0 };
  }

  const colMap = computeColumns(nodes);
  const rowCountPerCol = new Map<number, number>();
  const layouts: NodeLayout[] = [];

  // Sort by orderIndex so rows within a column are completely stable.
  const sorted = [...nodes].sort((a, b) => a.orderIndex - b.orderIndex);

  for (const node of sorted) {
    const c = colMap.get(node.stepKey) ?? 0;
    const r = rowCountPerCol.get(c) ?? 0;
    rowCountPerCol.set(c, r + 1);
    layouts.push({ node, col: c, row: r });
  }

  const validKeys = new Set(nodes.map((n) => n.stepKey));
  const edges: CanvasEdge[] = [];
  for (const node of nodes) {
    for (const dep of node.dependencies) {
      if (validKeys.has(dep)) {
        edges.push({ fromKey: dep, toKey: node.stepKey });
      }
    }
  }

  const totalCols = colMap.size > 0 ? Math.max(...colMap.values()) + 1 : 0;
  const maxRows = rowCountPerCol.size > 0 ? Math.max(...rowCountPerCol.values()) : 0;

  return { nodes: layouts, edges, totalCols, maxRows };
}

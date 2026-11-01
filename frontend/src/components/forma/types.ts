// ─── Forma Canvas – Shared Types ───────────────────────────────────────────────
// All types shared across the Forma sub-components live here.
// No logic, no side-effects — pure type declarations only.

import type { DAGDetails, DAGNode } from "../../types";

export type { DAGDetails, DAGNode };

/** Layout slot for a rendered DAG node on the visual canvas. */
export interface NodeLayout {
  readonly node: DAGNode;
  /** Column index (0-based), derived from topological sort. */
  readonly col: number;
  /** Row index within its column (0-based). */
  readonly row: number;
}

/** Edge connecting two DAG nodes on the canvas. */
export interface CanvasEdge {
  readonly fromKey: string;
  readonly toKey: string;
}

/** Result of the layout computation. */
export interface LayoutResult {
  readonly nodes: ReadonlyArray<NodeLayout>;
  readonly edges: ReadonlyArray<CanvasEdge>;
  readonly totalCols: number;
  readonly maxRows: number;
}

/** Shared callback props injected top-down. */
export interface FormaCallbacks {
  onSelectNode: (node: DAGNode | null) => void;
  onInspectArtifact?: (artifactId: string) => void;
}

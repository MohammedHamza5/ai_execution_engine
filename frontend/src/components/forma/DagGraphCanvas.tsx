// ─── Forma Canvas – DAG Graph Canvas (v2 — Intelligent) ───────────────────────
// Renders animated edges (AnimatedEdge) and live-pulse halos (LivePulse).
// Features:
//   • Multiple SVG marker definitions for distinct status flows
//   • Edge animations mapped by unique step keys
//   • Layout slot rendering with interactive nodes

import React, { useMemo } from "react";
import type { DAGNode, FormaCallbacks } from "./types";
import { computeLayout } from "./layoutEngine";
import { NodeCard } from "./NodeCard";
import { AnimatedEdge } from "./animated/AnimatedEdge";
import { LivePulse } from "./animated/LivePulse";

interface Props {
  nodes: ReadonlyArray<DAGNode>;
  selectedKey: string | null;
  bottleneckKeys: ReadonlySet<string>;
  callbacks: FormaCallbacks;
}

const COL_WIDTH = 300;
const ROW_HEIGHT = 96;
const CARD_H = 78;

export const DagGraphCanvas: React.FC<Props> = ({
  nodes, selectedKey, bottleneckKeys, callbacks,
}) => {
  const layout = useMemo(() => computeLayout(nodes), [nodes]);

  if (layout.nodes.length === 0) return null;

  const nodeMap = useMemo(
    () => new Map(nodes.map((n) => [n.stepKey, n])),
    [nodes],
  );
  const posMap = useMemo(
    () => new Map(layout.nodes.map((n) => [n.node.stepKey, n])),
    [layout.nodes],
  );

  const svgW = layout.totalCols * COL_WIDTH;
  const svgH = Math.max(layout.maxRows * ROW_HEIGHT, ROW_HEIGHT);

  return (
    <div className="relative overflow-x-auto rounded-xl">
      {/* ── SVG Layer (edges & flow markers) ── */}
      <svg
        width={svgW}
        height={svgH}
        className="absolute top-0 left-0 pointer-events-none"
        aria-hidden="true"
      >
        <defs>
          <marker id="arrowhead-default" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="rgba(100,116,139,0.5)" />
          </marker>
          <marker id="arrowhead-running" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="rgba(34,211,238,0.9)" />
          </marker>
          <marker id="arrowhead-completed" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="rgba(16,185,129,0.85)" />
          </marker>
          <marker id="arrowhead-failed" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="rgba(244,63,94,0.85)" />
          </marker>
          <marker id="arrowhead-diagnosing" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="rgba(168,85,247,0.85)" />
          </marker>
        </defs>

        {layout.edges.map(({ fromKey, toKey }) => {
          const from = posMap.get(fromKey);
          const to = posMap.get(toKey);
          const fromNode = nodeMap.get(fromKey);
          const toNode = nodeMap.get(toKey);
          if (!from || !to || !fromNode || !toNode) return null;
          return (
            <AnimatedEdge
              key={`${fromKey}->${toKey}`}
              fromKey={fromKey}
              toKey={toKey}
              fromCol={from.col}
              fromRow={from.row}
              toCol={to.col}
              toRow={to.row}
              fromStatus={fromNode.status}
              toStatus={toNode.status}
              colWidth={COL_WIDTH}
              rowHeight={ROW_HEIGHT}
              cardHeight={CARD_H}
            />
          );
        })}
      </svg>

      {/* ── Node Cards Layer ── */}
      <div className="relative" style={{ width: svgW, height: svgH }}>
        {layout.nodes.map(({ node, col, row }) => (
          <div
            key={node.stepKey}
            className="absolute"
            style={{ left: col * COL_WIDTH, top: row * ROW_HEIGHT, width: COL_WIDTH - 20 }}
          >
            <LivePulse
              status={node.status}
              isBottleneck={bottleneckKeys.has(node.stepKey)}
            >
              <NodeCard
                node={node}
                isSelected={selectedKey === node.stepKey}
                onClick={callbacks.onSelectNode}
              />
            </LivePulse>
          </div>
        ))}
      </div>
    </div>
  );
};

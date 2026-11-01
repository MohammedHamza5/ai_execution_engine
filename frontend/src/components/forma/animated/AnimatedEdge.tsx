// ─── Forma Animated – Animated SVG Edge ───────────────────────────────────────
// Renders a single Bezier edge between two layout positions.
// Features:
//   • Dynamic markers and flowing dash animation for active pathways
//   • Unique key-based pathId to prevent collision in re-renders
//   • Diagnostics and failure coloration

import React from "react";
import type { DAGNode } from "../types";

interface Props {
  fromKey: string;
  toKey: string;
  fromCol: number;
  fromRow: number;
  toCol: number;
  toRow: number;
  fromStatus: DAGNode["status"];
  toStatus: DAGNode["status"];
  colWidth: number;
  rowHeight: number;
  cardHeight: number;
}

function getEdgeStyle(fromStatus: DAGNode["status"], toStatus: DAGNode["status"]): {
  stroke: string;
  strokeWidth: number;
  animate: boolean;
  dasharray: string;
  opacity: number;
  marker: string;
} {
  if (fromStatus === "failed" || toStatus === "failed") {
    return {
      stroke: "rgba(244,63,94,0.7)",
      strokeWidth: 1.5,
      animate: false,
      dasharray: "4 3",
      opacity: 0.85,
      marker: "url(#arrowhead-failed)",
    };
  }
  if (fromStatus === "diagnosing" || toStatus === "diagnosing") {
    return {
      stroke: "rgba(168,85,247,0.8)",
      strokeWidth: 1.8,
      animate: true,
      dasharray: "5 3",
      opacity: 0.9,
      marker: "url(#arrowhead-diagnosing)",
    };
  }
  if (fromStatus === "completed" && toStatus === "running") {
    return {
      stroke: "rgba(34,211,238,0.95)",
      strokeWidth: 2,
      animate: true,
      dasharray: "6 3",
      opacity: 1,
      marker: "url(#arrowhead-running)",
    };
  }
  if (fromStatus === "completed" && toStatus === "completed") {
    return {
      stroke: "rgba(16,185,129,0.75)",
      strokeWidth: 1.5,
      animate: false,
      dasharray: "0",
      opacity: 0.9,
      marker: "url(#arrowhead-completed)",
    };
  }
  if (fromStatus === "running") {
    return {
      stroke: "rgba(34,211,238,0.6)",
      strokeWidth: 1.5,
      animate: true,
      dasharray: "5 3",
      opacity: 0.8,
      marker: "url(#arrowhead-running)",
    };
  }
  return {
    stroke: "rgba(100,116,139,0.35)",
    strokeWidth: 1.2,
    animate: false,
    dasharray: "4 4",
    opacity: 0.5,
    marker: "url(#arrowhead-default)",
  };
}

export const AnimatedEdge: React.FC<Props> = ({
  fromKey, toKey,
  fromCol, fromRow, toCol, toRow,
  fromStatus, toStatus,
  colWidth, rowHeight, cardHeight,
}) => {
  const x1 = fromCol * colWidth + (colWidth - 20);
  const y1 = fromRow * rowHeight + cardHeight / 2;
  const x2 = toCol * colWidth - 4;
  const y2 = toRow * rowHeight + cardHeight / 2;

  let d: string;
  if (toCol > fromCol) {
    const mx = (x1 + x2) / 2;
    d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  } else if (toCol === fromCol) {
    const arcX = x1 + 32;
    d = `M ${x1} ${y1} C ${arcX} ${y1}, ${arcX} ${y2}, ${x1} ${y2}`;
  } else {
    const loopX = Math.max(x1, x2) + 40;
    d = `M ${x1} ${y1} C ${loopX} ${y1}, ${loopX} ${y2}, ${x2} ${y2}`;
  }

  const style = getEdgeStyle(fromStatus, toStatus);
  const pathId = `edge-${fromKey}-${toKey}`;

  return (
    <g>
      {/* Outer glow layer for active pipeline flow */}
      {style.animate && (
        <path d={d} fill="none" stroke={style.stroke} strokeWidth={5} opacity={0.12} />
      )}

      {/* Main vector edge path */}
      <path
        id={pathId}
        d={d}
        fill="none"
        stroke={style.stroke}
        strokeWidth={style.strokeWidth}
        strokeDasharray={style.dasharray}
        opacity={style.opacity}
        markerEnd={style.marker}
      >
        {style.animate && (
          <animate
            attributeName="stroke-dashoffset"
            from="20"
            to="0"
            dur="0.8s"
            repeatCount="indefinite"
          />
        )}
      </path>

      {/* Travelling particle for active flow */}
      {style.animate && (
        <circle r={2.5} fill={style.stroke} opacity={0.9}>
          <animateMotion dur="1.2s" repeatCount="indefinite" rotate="auto">
            <mpath href={`#${pathId}`} />
          </animateMotion>
        </circle>
      )}
    </g>
  );
};

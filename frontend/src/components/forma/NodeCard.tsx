// ─── Forma Canvas – Node Card ──────────────────────────────────────────────────
// Renders a single DAG node as a clickable card.
// Props: node data + selection state + click handler. Pure presentational.

import React from "react";
import type { DAGNode } from "./types";
import { StatusBadge } from "./StatusBadge";

interface Props {
  node: DAGNode;
  isSelected: boolean;
  onClick: (node: DAGNode) => void;
}

export const NodeCard: React.FC<Props> = ({ node, isSelected, onClick }) => {
  const handleClick = () => onClick(node);
  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") onClick(node);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKey}
      aria-selected={isSelected}
      className={[
        "p-4 rounded-xl border transition-all cursor-pointer",
        "flex items-center justify-between gap-3 outline-none",
        "focus-visible:ring-2 focus-visible:ring-brand-cyan",
        isSelected
          ? "bg-bg-hover border-brand-cyan shadow-md shadow-cyan-950/30"
          : "bg-bg-card border-border-dark hover:border-slate-600 hover:bg-bg-hover",
      ].join(" ")}
    >
      {/* Order badge + name */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 shrink-0 rounded-lg bg-bg-dark border border-border-dark flex items-center justify-center font-mono text-xs text-brand-cyan">
          #{node.orderIndex}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-white text-sm truncate">{node.name}</span>
            <span className="text-[10px] font-mono text-slate-500">({node.stepKey})</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-[11px] font-mono text-slate-400">
            <span>
              Provider:{" "}
              <span className="text-slate-200">{node.assignedResource?.provider ?? "dynamic"}</span>
            </span>
            {node.latencyMs != null && <span>• {node.latencyMs}ms</span>}
          </div>
        </div>
      </div>

      {/* Status pill */}
      <StatusBadge status={node.status} />
    </div>
  );
};

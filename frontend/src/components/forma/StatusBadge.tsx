// ─── Forma Canvas – Status Badge ───────────────────────────────────────────────
// Renders the coloured status pill for any DAG node status string.
// Pure presentational — no state, no side-effects.

import React from "react";
import { CheckCircle2, Clock, Lock, AlertCircle, PlayCircle, Activity } from "lucide-react";
import type { DAGNode } from "./types";

interface Props {
  status: DAGNode["status"];
  size?: "sm" | "md";
}

const CONFIG: Record<
  DAGNode["status"],
  { label: string; icon: React.ReactNode; cls: string }
> = {
  completed: {
    label: "COMPLETED",
    icon: <CheckCircle2 className="w-3 h-3" />,
    cls: "text-brand-emerald bg-brand-emerald/10 border-brand-emerald/30",
  },
  running: {
    label: "RUNNING",
    icon: <PlayCircle className="w-3 h-3 animate-spin" />,
    cls: "text-brand-cyan bg-brand-cyan/10 border-brand-cyan/30 animate-pulse",
  },
  pending: {
    label: "PENDING",
    icon: <Clock className="w-3 h-3" />,
    cls: "text-brand-amber bg-brand-amber/10 border-brand-amber/30",
  },
  blocked: {
    label: "BLOCKED",
    icon: <Lock className="w-3 h-3" />,
    cls: "text-slate-400 bg-slate-800/60 border-slate-700",
  },
  failed: {
    label: "FAILED",
    icon: <AlertCircle className="w-3 h-3" />,
    cls: "text-brand-rose bg-brand-rose/10 border-brand-rose/30",
  },
  diagnosing: {
    label: "DIAGNOSING",
    icon: <Activity className="w-3 h-3 animate-pulse" />,
    cls: "text-purple-400 bg-purple-400/10 border-purple-400/30",
  },
};

export const StatusBadge: React.FC<Props> = ({ status, size = "sm" }) => {
  const cfg = CONFIG[status] ?? {
    label: status.toUpperCase(),
    icon: null,
    cls: "text-slate-400 bg-slate-800 border-slate-700",
  };

  const textSize = size === "md" ? "text-xs" : "text-[11px]";

  return (
    <span
      className={`flex items-center gap-1 ${textSize} font-mono border px-2 py-0.5 rounded ${cfg.cls}`}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
};

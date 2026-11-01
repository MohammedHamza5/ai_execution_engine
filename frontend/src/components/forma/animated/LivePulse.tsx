// ─── Forma Animated – Live Pulse ──────────────────────────────────────────────
// Wraps a node card with a status-aware animated halo effect.
// Running → glowing cyan ring + animated ticker.
// Failed → rose ring. Completed → subtle emerald border indicator.

import React from "react";
import type { DAGNode } from "../types";

interface Props {
  status: DAGNode["status"];
  isBottleneck?: boolean;
  children: React.ReactNode;
}

const RING_CONFIG: Partial<Record<DAGNode["status"], string>> = {
  running: "shadow-[0_0_0_2px_rgba(34,211,238,0.4)] animate-glow-pulse",
  failed: "shadow-[0_0_0_2px_rgba(244,63,94,0.5)]",
  diagnosing: "shadow-[0_0_0_2px_rgba(168,85,247,0.4)] animate-pulse",
  completed: "hover:shadow-[0_0_0_1px_rgba(16,185,129,0.3)]",
};

export const LivePulse: React.FC<Props> = ({ status, isBottleneck = false, children }) => {
  const ring = RING_CONFIG[status] ?? "";
  const bottleneckRing = isBottleneck ? "ring-2 ring-brand-amber ring-offset-1 ring-offset-bg-dark" : "";

  return (
    <div className={`relative rounded-xl transition-all duration-300 ${ring} ${bottleneckRing}`}>
      {/* Bottleneck warning badge */}
      {isBottleneck && (
        <div className="absolute -top-2 -right-2 z-10 flex items-center gap-1 bg-brand-amber text-bg-dark text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow-md">
          ⚠ SLOW
        </div>
      )}

      {/* Running indicator — top ticker line */}
      {status === "running" && (
        <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-xl overflow-hidden pointer-events-none">
          <div className="h-full w-full bg-gradient-to-r from-brand-indigo via-brand-cyan to-brand-emerald animate-slide-right" />
        </div>
      )}

      {children}
    </div>
  );
};

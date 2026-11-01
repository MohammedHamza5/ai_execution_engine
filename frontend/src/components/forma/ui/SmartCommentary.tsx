// ─── Forma UI – Smart Commentary ─────────────────────────────────────────────
// Displays the one-line intelligence commentary + ETA + avg latency chips.
// Adapts its color/icon to the current risk level.

import React from "react";
import type { DAGInsights } from "../intelligence/dagAnalyzer";
import type { ETAResult } from "../intelligence/etaCalculator";
import { formatAvgLatency } from "../intelligence/etaCalculator";
import { Brain, Clock, Zap } from "lucide-react";

interface Props {
  insights: DAGInsights;
  eta: ETAResult | null;
}

const RISK_STYLE: Record<DAGInsights["risk"], string> = {
  healthy: "border-brand-cyan/30 bg-brand-cyan/5 text-brand-cyan",
  warning: "border-brand-amber/40 bg-brand-amber/5 text-brand-amber",
  critical: "border-brand-rose/40 bg-brand-rose/5 text-brand-rose",
};

const ETA_CONFIDENCE: Record<NonNullable<ETAResult>["confidence"], string> = {
  low: "text-slate-500",
  medium: "text-slate-400",
  high: "text-brand-emerald",
};

export const SmartCommentary: React.FC<Props> = ({ insights, eta }) => {
  const riskStyle = RISK_STYLE[insights.risk];

  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 rounded-xl border font-mono ${riskStyle}`}
    >
      {/* Commentary text */}
      <div className="flex items-start sm:items-center gap-2 text-sm font-medium">
        <Brain className="w-4 h-4 shrink-0 mt-0.5 sm:mt-0" />
        <span>{insights.commentary}</span>
      </div>

      {/* Chips row */}
      <div className="flex items-center gap-3 text-[11px] shrink-0 pl-6 sm:pl-0">
        {/* ETA chip */}
        {eta && (
          <span className={`flex items-center gap-1 ${ETA_CONFIDENCE[eta.confidence]}`}>
            <Clock className="w-3 h-3" />
            ETA&nbsp;{eta.label}
            {eta.confidence === "low" && (
              <span className="text-slate-600 text-[9px]">(est.)</span>
            )}
          </span>
        )}

        {/* Avg latency chip */}
        {insights.avgLatencyMs != null && (
          <span className="flex items-center gap-1 text-slate-500">
            <Zap className="w-3 h-3" />
            {formatAvgLatency(insights.avgLatencyMs)}
          </span>
        )}

        {/* Parallelism chip */}
        {insights.parallelismDegree >= 2 && (
          <span className="px-2 py-0.5 rounded bg-brand-indigo/20 text-brand-cyan border border-brand-indigo/30 text-[10px]">
            ×{insights.parallelismDegree} parallel
          </span>
        )}
      </div>
    </div>
  );
};

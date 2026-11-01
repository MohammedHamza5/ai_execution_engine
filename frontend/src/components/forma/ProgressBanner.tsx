// ─── Forma Canvas – Progress Banner (v2) ──────────────────────────────────────
// Displays workflow execution progression, step counters, and critical path depth.

import React from "react";
import type { DAGDetails } from "./types";
import type { ETAResult } from "./intelligence/etaCalculator";
import { GitCommit } from "lucide-react";

interface Props {
  dag: DAGDetails;
  eta?: ETAResult | null;
}

interface MetricChipProps { label: string; value: number; color: string; }
const MetricChip: React.FC<MetricChipProps> = ({ label, value, color }) => (
  <div>
    <span className={`${color} block text-[10px] font-mono`}>{label}</span>
    <span className={`${color} font-bold font-mono text-sm`}>{value}</span>
  </div>
);

export const ProgressBanner: React.FC<Props> = ({ dag, eta }) => {
  const { metrics, plan, taskId } = dag;
  const pct = metrics.totalSteps > 0
    ? Math.round((metrics.completedSteps / metrics.totalSteps) * 100)
    : 0;

  const barColor = metrics.failedSteps > 0
    ? "from-brand-rose to-brand-rose/60"
    : pct === 100
    ? "from-brand-emerald to-brand-emerald/70"
    : "from-brand-indigo via-brand-cyan to-brand-emerald";

  return (
    <div className="bg-bg-card border border-border-dark rounded-xl p-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Identity */}
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-brand-indigo/20 text-brand-cyan border border-brand-indigo/30">
              {taskId.slice(0, 18)}…
            </span>
            <span className="text-xs font-mono text-slate-400">Plan v{plan.version}</span>
            <span className="text-xs font-mono text-slate-500 uppercase">{dag.status}</span>
          </div>
          <h2 className="text-base font-bold text-white mt-1">DAG Execution Engine</h2>
        </div>

        {/* Metrics + Depth */}
        <div className="flex items-center gap-5 flex-wrap">
          <MetricChip label="TOTAL" value={metrics.totalSteps} color="text-slate-400" />
          <MetricChip label="DONE" value={metrics.completedSteps} color="text-brand-emerald" />
          <MetricChip label="RUNNING" value={metrics.runningSteps} color="text-brand-cyan" />
          <MetricChip label="BLOCKED" value={metrics.blockedSteps} color="text-slate-500" />
          {metrics.failedSteps > 0 && (
            <MetricChip label="FAILED" value={metrics.failedSteps} color="text-brand-rose" />
          )}
          {eta && (
            <div className="flex items-center gap-1.5 text-xs font-mono text-cyan-300 border border-cyan-800/40 bg-cyan-950/20 px-2.5 py-1 rounded-lg">
              <GitCommit className="w-3.5 h-3.5 text-brand-cyan" />
              Path Depth: {eta.criticalPathLength}
            </div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-4 space-y-1">
        <div className="flex justify-between text-[11px] font-mono text-slate-400">
          <span>Workflow Completion</span>
          <span className={pct === 100 ? "text-brand-emerald font-bold" : ""}>{pct}%</span>
        </div>
        <div className="w-full bg-bg-dark h-2 rounded-full overflow-hidden border border-border-dark">
          <div
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            className={`h-full bg-gradient-to-r ${barColor} transition-all duration-700 rounded-full`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
};

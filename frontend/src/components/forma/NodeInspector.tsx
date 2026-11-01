// ─── Forma Canvas – Node Inspector ─────────────────────────────────────────────
// Shows deep telemetry and AI execution diagnostics for the selected node.
// Pure presentational, max ~135 lines.

import React from "react";
import type { DAGNode, FormaCallbacks } from "./types";
import { StatusBadge } from "./StatusBadge";
import { ArrowRight, Zap, Lightbulb, Clock } from "lucide-react";

interface Props {
  node: DAGNode | null;
  callbacks: Pick<FormaCallbacks, "onInspectArtifact">;
}

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex justify-between items-start gap-2">
    <span className="text-slate-400 shrink-0">{label}:</span>
    <span className="text-slate-200 text-right break-all">{value}</span>
  </div>
);

function getRecommendation(node: DAGNode): string {
  if (node.status === "failed") {
    return `Failure recorded (attempt #${node.attemptsCount}). Monotonic fencing token preserves DB consistency.`;
  }
  if (node.status === "diagnosing") {
    return "Self-healing supervisor active: evaluating error pattern against fallback fleet models.";
  }
  if (node.status === "running") {
    return "Executing within lease window. Output will be committed using transaction outbox.";
  }
  if (node.status === "completed") {
    return "Verified output committed. Downstream dependency gates unlocked.";
  }
  if (node.status === "blocked") {
    return `Blocked awaiting completion of: ${node.dependencies.join(", ")}`;
  }
  return "Queued for scheduling in priority order.";
}

export const NodeInspector: React.FC<Props> = ({ node, callbacks }) => (
  <div className="bg-bg-card border border-border-dark rounded-xl p-5 h-fit sticky top-4">
    <h3 className="text-xs uppercase font-mono tracking-wider text-brand-cyan mb-4 flex items-center gap-1.5">
      <Zap className="w-4 h-4" /> Node Inspector
    </h3>

    {!node ? (
      <p className="text-xs text-slate-500 font-mono py-8 text-center">
        Click any node to inspect execution telemetry.
      </p>
    ) : (
      <div className="space-y-4 text-xs font-mono">
        {/* Core Attributes */}
        <div className="space-y-1.5">
          <Row label="Step Key" value={node.stepKey} />
          <Row label="Step Type" value={node.stepType} />
          <Row label="Order Index" value={`#${node.orderIndex}`} />
        </div>

        {/* Status & Latency */}
        <div className="pt-3 border-t border-border-dark/60 space-y-1.5">
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Status:</span>
            <StatusBadge status={node.status} size="md" />
          </div>
          <Row label="Attempts" value={node.attemptsCount} />
          <Row label="Fencing Token" value={<span className="text-brand-emerald">{node.fencingToken}</span>} />
          {typeof node.qualityScore === "number" && !Number.isNaN(node.qualityScore) && (
            <Row label="Quality Score" value={<span className="text-brand-amber font-bold">{(node.qualityScore * 100).toFixed(0)}%</span>} />
          )}
          {typeof node.latencyMs === "number" && !Number.isNaN(node.latencyMs) && node.latencyMs > 0 && (
            <Row label="Latency" value={`${node.latencyMs}ms`} />
          )}
          {node.startedAt && !Number.isNaN(Date.parse(node.startedAt)) && (
            <Row label="Started" value={new Date(node.startedAt).toLocaleTimeString()} />
          )}
        </div>

        {/* Assigned Resource */}
        {node.assignedResource && (
          <div className="pt-3 border-t border-border-dark/60 space-y-1.5">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider block">Assigned Resource</span>
            <Row label="Provider" value={node.assignedResource.provider} />
            <Row label="Model" value={node.assignedResource.model} />
          </div>
        )}

        {/* AI Supervisor Diagnostics */}
        <div className="pt-3 border-t border-border-dark/60">
          <div className="p-2.5 rounded-lg bg-bg-dark border border-brand-indigo/30 text-[11px] space-y-1">
            <div className="flex items-center gap-1.5 text-brand-cyan font-semibold">
              <Lightbulb className="w-3.5 h-3.5 text-brand-amber" /> Engine Intelligence
            </div>
            <p className="text-slate-300 leading-relaxed">{getRecommendation(node)}</p>
          </div>
        </div>

        {/* Artifact Action */}
        {node.outputArtifactId && callbacks.onInspectArtifact && (
          <button
            onClick={() => callbacks.onInspectArtifact!(node.outputArtifactId!)}
            className="w-full mt-1 py-1.5 px-3 rounded-lg bg-brand-indigo/20 border border-brand-indigo/40 text-brand-cyan hover:bg-brand-indigo/30 transition-colors flex items-center justify-center gap-1.5 text-xs"
          >
            View Output Artifact <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    )}
  </div>
);

// ─── Forma Canvas – Main Orchestrator (v2 — Intelligent) ──────────────────────
// Wires together:
//   • FormaErrorBoundary → crash fencing & visual recovery
//   • useIntelligence    → analysis, critical-path ETA, transition toasts
//   • SmartCommentary    → one-line context-aware description
//   • ToastNotifier      → real-time node-transition alerts
//   • DagGraphCanvas     → animated edges + live pulse halos
//   • NodeInspector      → detailed telemetry panel & self-healing suggestions
//   • ProgressBanner     → global progress + ETA bar

import React, { useState, useEffect, useMemo } from "react";
import type { DAGDetails, DAGNode } from "./types";
import { fetchArtifact } from "../../api";
import { FormaErrorBoundary } from "./FormaErrorBoundary";
import { ProgressBanner } from "./ProgressBanner";
import { ArtifactResultCard } from "./ArtifactResultCard";
import { DagGraphCanvas } from "./DagGraphCanvas";
import { NodeInspector } from "./NodeInspector";
import { SmartCommentary } from "./ui/SmartCommentary";
import { ToastNotifier } from "./ui/ToastNotifier";
import { useIntelligence } from "./intelligence/useIntelligence";
import { Layers } from "lucide-react";

interface FormaCanvasProps {
  dag: DAGDetails | null;
  loading: boolean;
  onInspectArtifact?: (artifactId: string) => void;
}

const LoadingSkeleton: React.FC = () => (
  <div className="space-y-4 animate-pulse">
    <div className="h-28 rounded-xl bg-bg-card border border-border-dark" />
    <div className="h-10 rounded-xl bg-bg-card border border-border-dark" />
    <div className="h-64 rounded-xl bg-bg-card border border-border-dark" />
  </div>
);

const EmptyState: React.FC = () => (
  <div className="h-96 rounded-xl bg-bg-card border border-border-dark flex flex-col items-center justify-center p-8 text-center">
    <Layers className="w-12 h-12 text-slate-600 mb-3" />
    <h3 className="text-sm font-semibold text-white">No Active DAG Loaded</h3>
    <p className="text-xs text-slate-400 max-w-sm mt-1">
      Submit a workflow in the Workbench or select a task from History.
    </p>
  </div>
);

// ─── Inner component (receives a guaranteed non-null dag) ─────────────────────
const FormaInner: React.FC<{ dag: DAGDetails; onInspectArtifact?: (id: string) => void }> = ({
  dag, onInspectArtifact,
}) => {
  const nodes = dag.steps as DAGNode[];
  const [selectedNode, setSelectedNode] = useState<DAGNode | null>(null);
  const [finalArtifact, setFinalArtifact] = useState<any | null>(null);

  const { insights, eta, toasts } = useIntelligence(nodes);

  const bottleneckKeys = useMemo(
    () => new Set(insights.bottlenecks.map((b) => b.stepKey)),
    [insights.bottlenecks],
  );

  useEffect(() => {
    const active =
      nodes.find((n) => n.status === "running") ??
      [...nodes].reverse().find((n) => n.status === "completed") ??
      nodes[0] ?? null;
    setSelectedNode(active);
  }, [dag.taskId]);

  useEffect(() => {
    let isCancelled = false;
    const isComplete = dag.metrics.isComplete || dag.status === "completed";
    if (isComplete || dag.outputArtifactId) {
      fetchArtifact(dag.taskId)
        .then((art) => { if (!isCancelled) setFinalArtifact(art); })
        .catch(() => { if (!isCancelled) setFinalArtifact(null); });
    } else {
      setFinalArtifact(null);
    }
    return () => { isCancelled = true; };
  }, [dag.taskId, dag.metrics.isComplete, dag.status, dag.outputArtifactId]);

  const callbacks = { onSelectNode: setSelectedNode, onInspectArtifact };

  return (
    <>
      <div className="space-y-4">
        <ProgressBanner dag={dag} eta={eta} />
        <SmartCommentary insights={insights} eta={eta} />
        <ArtifactResultCard
          artifact={finalArtifact}
          taskId={dag.taskId}
          onInspectArtifact={onInspectArtifact}
        />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <h3 className="text-xs uppercase font-mono tracking-wider text-slate-400 mb-3">
              Live Dependency Graph
            </h3>
            <DagGraphCanvas
              nodes={nodes}
              selectedKey={selectedNode?.stepKey ?? null}
              bottleneckKeys={bottleneckKeys}
              callbacks={callbacks}
            />
          </div>
          <NodeInspector node={selectedNode} callbacks={callbacks} />
        </div>
      </div>
      <ToastNotifier toasts={toasts} />
    </>
  );
};

// ─── Public export ────────────────────────────────────────────────────────────
export const FormaCanvas: React.FC<FormaCanvasProps> = ({ dag, loading, onInspectArtifact }) => {
  if (loading) return <LoadingSkeleton />;
  if (!dag) return <EmptyState />;
  return (
    <FormaErrorBoundary fallbackTitle="Forma Canvas Rendering Issue">
      <FormaInner dag={dag} onInspectArtifact={onInspectArtifact} />
    </FormaErrorBoundary>
  );
};

export default FormaCanvas;

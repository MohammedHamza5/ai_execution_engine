import React, { useState, useEffect } from "react";
import type { DAGDetails, DAGNode } from "../types";
import { fetchArtifact } from "../api";
import {
  CheckCircle2,
  Clock,
  Lock,
  AlertCircle,
  PlayCircle,
  Layers,
  ArrowRight,
  ShieldCheck,
  Zap,
  Sparkles,
  Copy,
  Check,
  FileText,
} from "lucide-react";

interface DagViewerProps {
  dag: DAGDetails | null;
  loading: boolean;
  onInspectArtifact?: (artifactId: string) => void;
}

export const DagViewer: React.FC<DagViewerProps> = ({ dag, loading, onInspectArtifact }) => {
  const [selectedNode, setSelectedNode] = useState<DAGNode | null>(null);
  const [finalArtifact, setFinalArtifact] = useState<any | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    if (!dag) {
      setFinalArtifact(null);
      setSelectedNode(null);
      return;
    }

    // Auto-select the active or last completed node so inspector is never blank
    if (dag.steps.length > 0) {
      const activeOrLast =
        dag.steps.find((s) => s.status === "running") ||
        [...dag.steps].reverse().find((s) => s.status === "completed") ||
        dag.steps[0];
      setSelectedNode(activeOrLast || null);
    }

    // Auto-fetch final output artifact if task completed
    if (dag.outputArtifactId || dag.metrics.isComplete || dag.status === "completed") {
      fetchArtifact(dag.taskId)
        .then((art) => setFinalArtifact(art))
        .catch(() => setFinalArtifact(null));
    } else {
      setFinalArtifact(null);
    }
  }, [dag?.taskId, dag?.metrics.isComplete, dag?.status]);

  if (loading) {
    return (
      <div className="h-96 rounded-xl bg-bg-card border border-border-dark flex items-center justify-center text-slate-400 font-mono text-xs animate-pulse">
        Polling DAG execution graph from PostgreSQL...
      </div>
    );
  }

  if (!dag) {
    return (
      <div className="h-96 rounded-xl bg-bg-card border border-border-dark flex flex-col items-center justify-center p-8 text-center">
        <Layers className="w-12 h-12 text-slate-600 mb-3" />
        <h3 className="text-sm font-semibold text-white">No Active DAG Loaded</h3>
        <p className="text-xs text-slate-400 max-w-sm mt-1">
          Submit a new workflow in the Workbench or select a recent DAG execution from Task History.
        </p>
      </div>
    );
  }

  const getNodeStatusBadge = (status: DAGNode["status"]) => {
    switch (status) {
      case "completed":
        return <span className="flex items-center gap-1 text-[11px] font-mono text-brand-emerald bg-brand-emerald/10 border border-brand-emerald/30 px-2 py-0.5 rounded"><CheckCircle2 className="w-3 h-3" /> COMPLETED</span>;
      case "running":
        return <span className="flex items-center gap-1 text-[11px] font-mono text-brand-cyan bg-brand-cyan/10 border border-brand-cyan/30 px-2 py-0.5 rounded animate-pulse"><PlayCircle className="w-3 h-3 animate-spin" /> RUNNING</span>;
      case "pending":
        return <span className="flex items-center gap-1 text-[11px] font-mono text-brand-amber bg-brand-amber/10 border border-brand-amber/30 px-2 py-0.5 rounded"><Clock className="w-3 h-3" /> PENDING</span>;
      case "blocked":
        return <span className="flex items-center gap-1 text-[11px] font-mono text-slate-400 bg-slate-800/60 border border-slate-700 px-2 py-0.5 rounded"><Lock className="w-3 h-3" /> BLOCKED</span>;
      case "failed":
        return <span className="flex items-center gap-1 text-[11px] font-mono text-brand-rose bg-brand-rose/10 border border-brand-rose/30 px-2 py-0.5 rounded"><AlertCircle className="w-3 h-3" /> FAILED</span>;
      default:
        return <span className="text-[11px] font-mono text-slate-400">{status}</span>;
    }
  };

  const progressPercent = dag.metrics.totalSteps > 0
    ? Math.round((dag.metrics.completedSteps / dag.metrics.totalSteps) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Execution Control Banner */}
      <div className="bg-bg-card border border-border-dark rounded-xl p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-brand-indigo/20 text-brand-cyan border border-brand-indigo/30">
                TASK ID: {dag.taskId.slice(0, 18)}...
              </span>
              <span className="text-xs font-mono text-slate-400">Plan v{dag.plan.version}</span>
            </div>
            <h2 className="text-base font-bold text-white mt-1">DAG Progression Engine</h2>
          </div>

          {/* Quick Metrics */}
          <div className="flex items-center gap-6 text-xs font-mono">
            <div>
              <span className="text-slate-400 block text-[10px]">TOTAL STEPS</span>
              <span className="text-white font-bold">{dag.metrics.totalSteps}</span>
            </div>
            <div>
              <span className="text-brand-emerald block text-[10px]">COMPLETED</span>
              <span className="text-brand-emerald font-bold">{dag.metrics.completedSteps}</span>
            </div>
            <div>
              <span className="text-brand-cyan block text-[10px]">RUNNING</span>
              <span className="text-brand-cyan font-bold">{dag.metrics.runningSteps}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px]">BLOCKED</span>
              <span className="text-slate-300 font-bold">{dag.metrics.blockedSteps}</span>
            </div>
          </div>
        </div>

        {/* Global Progress Bar */}
        <div className="mt-4 space-y-1">
          <div className="flex justify-between text-[11px] font-mono text-slate-400">
            <span>Workflow Completion</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="w-full bg-bg-dark h-2 rounded-full overflow-hidden border border-border-dark">
            <div
              className="h-full bg-gradient-to-r from-brand-indigo via-brand-cyan to-brand-emerald transition-all duration-500 rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Final Synthesized Output Card (Prominently displayed on completion) */}
      {finalArtifact?.inline_content && (
        <div className="bg-gradient-to-r from-bg-card via-brand-indigo/10 to-bg-card border border-brand-cyan/40 rounded-xl p-5 shadow-lg shadow-cyan-950/20 animate-fade-in">
          <div className="flex items-center justify-between pb-3 border-b border-border-dark/60">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-brand-cyan/10 border border-brand-cyan/30 flex items-center justify-center text-brand-cyan">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  Final Synthesized Artifact
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-brand-emerald/10 text-brand-emerald border border-brand-emerald/30">
                    VERIFIED RESULT
                  </span>
                </h3>
                <p className="text-[11px] font-mono text-slate-400">
                  SHA-256: {finalArtifact.content_hash?.slice(0, 24)}...
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(finalArtifact.inline_content);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono border border-border-dark bg-bg-dark hover:bg-bg-hover text-slate-200 transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-brand-emerald" /> : <Copy className="w-3.5 h-3.5 text-brand-cyan" />}
                {copied ? "Copied" : "Copy Result"}
              </button>
              {onInspectArtifact && (
                <button
                  onClick={() => onInspectArtifact(dag.taskId)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono border border-brand-indigo/40 bg-brand-indigo/20 text-brand-cyan hover:bg-brand-indigo/30 transition-colors"
                >
                  <FileText className="w-3.5 h-3.5" />
                  Full Drawer
                </button>
              )}
            </div>
          </div>

          <div className="mt-4">
            <pre className="p-4 rounded-xl bg-bg-dark/80 border border-border-dark text-xs font-mono text-slate-200 overflow-x-auto whitespace-pre-wrap max-h-80 leading-relaxed selection:bg-brand-cyan/30">
              {finalArtifact.inline_content}
            </pre>
          </div>
        </div>
      )}

      {/* DAG Node Graph Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          <h3 className="text-xs uppercase font-mono tracking-wider text-slate-400">Dependency Nodes</h3>
          <div className="space-y-2">
            {dag.steps.map((node) => {
              const isSelected = selectedNode?.stepKey === node.stepKey;
              return (
                <div
                  key={node.stepKey}
                  onClick={() => setSelectedNode(node)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                    isSelected
                      ? "bg-bg-hover border-brand-cyan shadow-md shadow-cyan-950/30"
                      : "bg-bg-card border-border-dark hover:border-slate-600 hover:bg-bg-hover"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-bg-dark border border-border-dark flex items-center justify-center font-mono text-xs text-brand-cyan">
                      #{node.orderIndex}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white text-sm">{node.name}</span>
                        <span className="text-[10px] font-mono text-slate-400">({node.stepKey})</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[11px] font-mono text-slate-400">
                        <span>Provider: <span className="text-slate-200">{node.assignedResource?.provider || "dynamic"}</span></span>
                        {node.latencyMs && <span>• {node.latencyMs}ms</span>}
                      </div>
                    </div>
                  </div>
                  <div>{getNodeStatusBadge(node.status)}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Selected Node Inspector Drawer */}
        <div className="bg-bg-card border border-border-dark rounded-xl p-5 h-fit">
          <h3 className="text-xs uppercase font-mono tracking-wider text-brand-cyan mb-3 flex items-center gap-1.5">
            <Zap className="w-4 h-4" /> Node Inspector
          </h3>
          {selectedNode ? (
            <div className="space-y-4 text-xs font-mono">
              <div>
                <span className="text-slate-400 text-[10px] block">STEP KEY & TYPE</span>
                <span className="text-white font-semibold">{selectedNode.stepKey}</span> ({selectedNode.stepType})
              </div>
              <div>
                <span className="text-slate-400 text-[10px] block">DEPENDENCIES (UPSTREAM)</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {selectedNode.dependencies.length > 0 ? (
                    selectedNode.dependencies.map((dep) => (
                      <span key={dep} className="px-2 py-0.5 rounded bg-bg-dark border border-border-dark text-[10px] text-cyan-300">
                        {dep}
                      </span>
                    ))
                  ) : (
                    <span className="text-slate-500 text-[11px]">Root node (None)</span>
                  )}
                </div>
              </div>
              <div className="pt-2 border-t border-border-dark/60 space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-400">Fencing Token:</span>
                  <span className="text-brand-emerald">{selectedNode.fencingToken}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Attempts Count:</span>
                  <span className="text-slate-200">{selectedNode.attemptsCount}</span>
                </div>
                {selectedNode.outputArtifactId && (
                  <button
                    onClick={() => onInspectArtifact && onInspectArtifact(selectedNode.outputArtifactId!)}
                    className="w-full mt-3 py-1.5 px-3 rounded-lg bg-brand-indigo/20 border border-brand-indigo/40 text-brand-cyan hover:bg-brand-indigo/30 transition-colors flex items-center justify-center gap-1.5"
                  >
                    View Output Artifact <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500 font-mono py-8 text-center">Click any node to inspect execution telemetry.</p>
          )}
        </div>
      </div>
    </div>
  );
};

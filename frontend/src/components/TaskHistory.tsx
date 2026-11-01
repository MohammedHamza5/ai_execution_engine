import React, { useState } from "react";
import type { TaskSummary } from "../types";
import { Clock, CheckCircle2, AlertCircle, PlayCircle, Eye, FileText, ChevronRight } from "lucide-react";

interface TaskHistoryProps {
  tasks: TaskSummary[];
  loading: boolean;
  onSelectTask: (taskId: string) => void;
  onInspectArtifact: (artifactId: string) => void;
}

export const TaskHistory: React.FC<TaskHistoryProps> = ({
  tasks,
  loading,
  onSelectTask,
  onInspectArtifact,
}) => {
  const [filter, setFilter] = useState<string>("all");

  const filteredTasks = tasks.filter((t) => {
    if (filter === "all") return true;
    return t.status.toLowerCase() === filter.toLowerCase();
  });

  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case "completed":
        return <span className="flex items-center gap-1 text-[10px] font-mono text-brand-emerald bg-brand-emerald/10 border border-brand-emerald/30 px-2 py-0.5 rounded"><CheckCircle2 className="w-3 h-3" /> COMPLETED</span>;
      case "running":
        return <span className="flex items-center gap-1 text-[10px] font-mono text-brand-cyan bg-brand-cyan/10 border border-brand-cyan/30 px-2 py-0.5 rounded animate-pulse"><PlayCircle className="w-3 h-3 animate-spin" /> RUNNING</span>;
      case "pending":
        return <span className="flex items-center gap-1 text-[10px] font-mono text-brand-amber bg-brand-amber/10 border border-brand-amber/30 px-2 py-0.5 rounded"><Clock className="w-3 h-3" /> PENDING</span>;
      case "failed":
        return <span className="flex items-center gap-1 text-[10px] font-mono text-brand-rose bg-brand-rose/10 border border-brand-rose/30 px-2 py-0.5 rounded"><AlertCircle className="w-3 h-3" /> FAILED</span>;
      default:
        return <span className="text-[10px] font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded">{status}</span>;
    }
  };

  return (
    <div className="space-y-4">
      {/* Filter Tabs */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-white font-mono uppercase tracking-wider">
          Task Execution History ({tasks.length})
        </h2>
        <div className="flex items-center gap-1 bg-bg-card p-1 rounded-lg border border-border-dark text-xs">
          {["all", "completed", "running", "failed"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 rounded text-xs capitalize font-mono transition-colors ${
                filter === f
                  ? "bg-brand-indigo text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Task List */}
      <div className="bg-bg-card border border-border-dark rounded-xl divide-y divide-border-dark/60 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500 font-mono animate-pulse">
            Loading recent execution records from PostgreSQL...
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 font-mono">
            No tasks found matching the filter.
          </div>
        ) : (
          filteredTasks.map((t) => (
            <div
              key={t.id}
              className="p-4 hover:bg-bg-hover transition-colors flex items-center justify-between gap-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-bg-dark border border-border-dark flex items-center justify-center font-mono text-xs text-slate-300">
                  <Clock className="w-4 h-4 text-brand-cyan" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-white">
                      {t.id.slice(0, 18)}...
                    </span>
                    <span className="text-[10px] font-mono text-slate-400 uppercase px-1.5 py-0.5 bg-bg-dark rounded border border-border-dark">
                      {t.taskType}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono mt-1">
                    {t.stepCount ? `${t.completedStepCount ?? 0}/${t.stepCount} Steps` : "Single Model Step"} • Created {new Date(t.createdAt).toLocaleTimeString()}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {getStatusBadge(t.status)}

                {t.outputArtifactId && (
                  <button
                    onClick={() => onInspectArtifact(t.outputArtifactId!)}
                    className="p-1.5 rounded-lg border border-border-dark bg-bg-dark hover:border-brand-emerald text-brand-emerald transition-colors"
                    title="View Output Artifact"
                  >
                    <FileText className="w-3.5 h-3.5" />
                  </button>
                )}

                <button
                  onClick={() => onSelectTask(t.id)}
                  className="p-1.5 rounded-lg border border-border-dark bg-bg-dark hover:border-brand-indigo text-slate-300 hover:text-white transition-colors"
                  title="Inspect DAG"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

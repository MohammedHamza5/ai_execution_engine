import React from "react";
import type { TabType } from "../types";
import { Workflow, Cpu, Play, Clock, Activity, RefreshCw } from "lucide-react";

interface HeaderProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  onRefresh,
  isRefreshing,
}) => {
  const navItems: Array<{ id: TabType; label: string; icon: React.ReactNode }> = [
    { id: "dag", label: "DAG Studio", icon: <Workflow className="w-4 h-4" /> },
    { id: "fleet", label: "Fleet Radar", icon: <Cpu className="w-4 h-4" /> },
    { id: "workbench", label: "Workbench", icon: <Play className="w-4 h-4" /> },
    { id: "history", label: "Task History", icon: <Clock className="w-4 h-4" /> },
    { id: "telemetry", label: "Telemetry", icon: <Activity className="w-4 h-4" /> },
  ];

  return (
    <header className="border-b border-border-dark bg-bg-card/80 backdrop-blur sticky top-0 z-50 px-6 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Brand Identity */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-brand-indigo to-brand-cyan flex items-center justify-center shadow-lg shadow-brand-cyan/20">
            <Workflow className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-white tracking-wider text-sm font-mono">
                AI-EXECUTION-ENGINE
              </span>
              <span className="px-1.5 py-0.5 text-[10px] font-mono bg-brand-emerald/10 text-brand-emerald border border-brand-emerald/30 rounded-full flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-emerald animate-pulse" />
                M6 ACTIVE
              </span>
            </div>
            <p className="text-[11px] text-slate-400">Resource Orchestration & DAG Runtime</p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center gap-1 bg-bg-dark/60 p-1 rounded-xl border border-border-dark">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? "bg-brand-indigo text-white shadow-md shadow-brand-indigo/30"
                    : "text-slate-400 hover:text-slate-200 hover:bg-bg-hover"
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Quick Action Refresh */}
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono border border-border-dark bg-bg-card hover:bg-bg-hover text-slate-300 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-brand-cyan" : ""}`} />
            Sync
          </button>
        </div>
      </div>
    </header>
  );
};

import React, { useState, useEffect, useCallback } from "react";
import type { TabType, FleetResource, TaskSummary, DAGDetails, TelemetryData } from "./types";
import { fetchFleet, fetchTasks, fetchDAGDetails, fetchArtifact, fetchTelemetry } from "./api";
import { Header } from "./components/Header";
import { FleetRadar } from "./components/FleetRadar";
import { FormaCanvas } from "./components/forma";
import { TaskWorkbench } from "./components/TaskWorkbench";
import { TaskHistory } from "./components/TaskHistory";
import { ArtifactDrawer } from "./components/ArtifactDrawer";
import { SystemTelemetry } from "./components/SystemTelemetry";

export function App() {
  const [activeTab, setActiveTab] = useState<TabType>("fleet");
  const [fleet, setFleet] = useState<FleetResource[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [activeDag, setActiveDag] = useState<DAGDetails | null>(null);
  const [activeArtifact, setActiveArtifact] = useState<any | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);

  const [loadingFleet, setLoadingFleet] = useState(false);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [loadingDag, setLoadingDag] = useState(false);
  const [loadingArtifact, setLoadingArtifact] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Sync All Data
  const refreshAll = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [fleetData, tasksData, telemetryData] = await Promise.all([
        fetchFleet().catch(() => []),
        fetchTasks().catch(() => []),
        fetchTelemetry().catch(() => null),
      ]);
      setFleet(fleetData);
      setTasks(tasksData);
      setTelemetry(telemetryData);

      // If active DAG is running, refresh it too
      if (activeDag && (activeDag.status === "running" || activeDag.status === "pending")) {
        const freshDag = await fetchDAGDetails(activeDag.taskId).catch(() => null);
        if (freshDag) setActiveDag(freshDag);
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [activeDag]);

  // Initial Load
  useEffect(() => {
    refreshAll();
  }, []);

  // Polling Interval for live updates
  useEffect(() => {
    const timer = setInterval(() => {
      refreshAll();
    }, 4000);
    return () => clearInterval(timer);
  }, [refreshAll]);

  // Select Task to view DAG
  const handleSelectTask = async (taskId: string) => {
    setLoadingDag(true);
    setActiveTab("dag");
    try {
      const dagData = await fetchDAGDetails(taskId);
      setActiveDag(dagData);
    } catch (err) {
      console.warn("Could not load DAG for task, loading basic view:", err);
    } finally {
      setLoadingDag(false);
    }
  };

  // Inspect Artifact
  const handleInspectArtifact = async (artifactId: string) => {
    setLoadingArtifact(true);
    try {
      const art = await fetchArtifact(artifactId);
      setActiveArtifact(art);
    } catch {
      setActiveArtifact({ id: artifactId, inline_content: "Artifact pending or not found." });
    } finally {
      setLoadingArtifact(false);
    }
  };

  // On Task Created from Workbench
  const handleTaskCreated = async (taskId: string) => {
    await refreshAll();
    handleSelectTask(taskId);
  };

  return (
    <div className="min-h-screen bg-bg-dark text-slate-100 font-sans flex flex-col selection:bg-brand-cyan/30">
      {/* Top Bar */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onRefresh={refreshAll}
        isRefreshing={isRefreshing}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6">
        {activeTab === "fleet" && (
          <FleetRadar fleet={fleet} loading={loadingFleet} />
        )}

        {activeTab === "dag" && (
          <FormaCanvas
            dag={activeDag}
            loading={loadingDag}
            onInspectArtifact={handleInspectArtifact}
          />
        )}

        {activeTab === "workbench" && (
          <TaskWorkbench onTaskCreated={handleTaskCreated} />
        )}

        {activeTab === "history" && (
          <TaskHistory
            tasks={tasks}
            loading={loadingTasks}
            onSelectTask={handleSelectTask}
            onInspectArtifact={handleInspectArtifact}
          />
        )}

        {activeTab === "telemetry" && (
          <SystemTelemetry telemetry={telemetry} loading={isRefreshing} />
        )}
      </main>

      {/* Artifact Inspector Drawer */}
      <ArtifactDrawer
        artifact={activeArtifact}
        loading={loadingArtifact}
        onClose={() => setActiveArtifact(null)}
      />

      {/* Footer */}
      <footer className="border-t border-border-dark py-4 text-center text-xs text-slate-500 font-mono">
        AI-Execution-Engine • PostgreSQL 18.1 Kernel • Fencing Tokens • Zero Silent Spend
      </footer>
    </div>
  );
}

export default App;

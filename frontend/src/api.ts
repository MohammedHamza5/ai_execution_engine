import type { FleetResource, DAGDetails, TaskSummary, TelemetryData } from "./types";

const BASE_URL = "";

export async function fetchFleet(): Promise<FleetResource[]> {
  const res = await fetch(`${BASE_URL}/v1/fleet`);
  if (!res.ok) throw new Error("Failed to fetch fleet");
  const data = await res.json();
  return data.resources || [];
}

export async function fetchTasks(status?: string): Promise<TaskSummary[]> {
  const query = status ? `?status=${status}` : "";
  const res = await fetch(`${BASE_URL}/v1/tasks${query}`);
  if (!res.ok) throw new Error("Failed to fetch tasks");
  const data = await res.json();
  return data.tasks || [];
}

export async function fetchDAGDetails(taskId: string): Promise<DAGDetails> {
  const res = await fetch(`${BASE_URL}/v1/tasks/${taskId}/dag`);
  if (!res.ok) throw new Error("Failed to fetch DAG details");
  return res.json();
}

export async function fetchArtifact(taskId: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/v1/tasks/${taskId}/artifact`);
  if (!res.ok) throw new Error("Failed to fetch artifact");
  return res.json();
}

export async function fetchTelemetry(): Promise<TelemetryData> {
  const res = await fetch(`${BASE_URL}/v1/telemetry`);
  if (!res.ok) throw new Error("Failed to fetch telemetry");
  return res.json();
}

export async function submitDAGTask(payload: any): Promise<any> {
  const res = await fetch(`${BASE_URL}/v1/tasks/dag`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `dashboard-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to submit DAG task");
  }
  return res.json();
}

export async function submitStandardTask(payload: any): Promise<any> {
  const res = await fetch(`${BASE_URL}/v1/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `dashboard-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to submit task");
  }
  return res.json();
}

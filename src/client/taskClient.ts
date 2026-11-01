import {
  ClientConfig,
  TaskSubmitParams,
  TaskStatusResponse,
  DAGSubmitParams,
  DAGStatusResponse,
} from "./types.js";
import { parseSSEStream } from "./sseClient.js";

export class TaskClient {
  constructor(private readonly config: ClientConfig) {}

  public async submit(params: TaskSubmitParams): Promise<{ taskId: string; status: string }> {
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/v1/tasks`;
    const headers = this.buildHeaders();

    const body = {
      taskType: "general_execution",
      strategy: "single_model",
      prompt: params.prompt,
      priority: params.priority ?? 0,
      inputPayload: { prompt: params.prompt },
      requirements: {
        allowPaid: params.allowPaid ?? false,
        requiredCapabilities: params.requiredCapabilities ?? [],
      },
      policy: {
        allowPaid: params.allowPaid ?? false,
      },
    };

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`Task Submission Failed [HTTP ${res.status}]: ${err}`);
    }

    return (await res.json()) as { taskId: string; status: string };
  }

  public async get(taskId: string): Promise<TaskStatusResponse> {
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/v1/tasks/${taskId}`;
    const res = await fetch(url, { headers: this.buildHeaders() });
    if (!res.ok) {
      throw new Error(`Failed to get task [HTTP ${res.status}]`);
    }
    return (await res.json()) as TaskStatusResponse;
  }

  public async getArtifact(taskIdOrArtifactId: string): Promise<any> {
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/v1/tasks/${taskIdOrArtifactId}/artifact`;
    const res = await fetch(url, { headers: this.buildHeaders() });
    if (!res.ok) {
      throw new Error(`Failed to get artifact [HTTP ${res.status}]`);
    }
    return res.json();
  }

  public async waitForCompletion(
    taskId: string,
    pollIntervalMs = 500,
    timeoutMs = 30_000
  ): Promise<TaskStatusResponse> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const task = await this.get(taskId);
      if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
        return task;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    throw new Error(`Task '${taskId}' timed out after ${timeoutMs}ms.`);
  }

  public async stream(taskId: string): Promise<AsyncIterable<any>> {
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/v1/tasks/${taskId}/stream`;
    const res = await fetch(url, { headers: this.buildHeaders() });
    if (!res.ok) {
      throw new Error(`Failed to open task stream [HTTP ${res.status}]`);
    }
    return parseSSEStream<any>(res);
  }

  public readonly dag = {
    submit: async (params: DAGSubmitParams): Promise<{ taskId: string; status: string }> => {
      const url = `${this.config.baseUrl.replace(/\/+$/, "")}/v1/tasks/dag`;
      const steps = params.nodes.map((n) => ({
        stepKey: n.nodeId,
        name: n.name,
        dependencies: n.dependencies,
        requiredCapability: n.requiredCapabilities?.[0],
        inputPayload: { prompt: n.prompt },
      }));

      const res = await fetch(url, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({
          taskType: "dag_workflow",
          strategy: "dag_workflow",
          steps,
          requirements: { allowPaid: params.allowPaid ?? false },
          policy: { allowPaid: params.allowPaid ?? false },
        }),
      });

      if (!res.ok) {
        const err = await res.text().catch(() => "");
        throw new Error(`DAG Submission Failed [HTTP ${res.status}]: ${err}`);
      }
      return (await res.json()) as { taskId: string; status: string };
    },

    get: async (taskId: string): Promise<DAGStatusResponse> => {
      const url = `${this.config.baseUrl.replace(/\/+$/, "")}/v1/tasks/${taskId}/dag`;
      const res = await fetch(url, { headers: this.buildHeaders() });
      if (!res.ok) {
        throw new Error(`Failed to get DAG [HTTP ${res.status}]`);
      }
      const data = (await res.json()) as any;
      return {
        ...data,
        steps: data.steps || [],
        nodes: data.steps || [],
      };
    },
  };

  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
      ...(this.config.tenantId ? { "X-Tenant-Id": this.config.tenantId } : {}),
    };
  }
}

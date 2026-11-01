import { ClientConfig } from "./types.js";
import { ChatClient, ModelsClient } from "./chatClient.js";
import { TaskClient } from "./taskClient.js";
import { MemoryClient } from "./memoryClient.js";

export class AIExecutionEngineClient {
  public readonly chat: {
    completions: ChatClient;
  };
  public readonly models: ModelsClient;
  public readonly tasks: TaskClient;
  public readonly memory: MemoryClient;

  constructor(private readonly config: ClientConfig) {
    const sanitizedConfig = {
      ...config,
      baseUrl: config.baseUrl.replace(/\/+$/, ""),
    };

    const chatClient = new ChatClient(sanitizedConfig);
    this.chat = {
      completions: chatClient,
    };
    this.models = new ModelsClient(sanitizedConfig);
    this.tasks = new TaskClient(sanitizedConfig);
    this.memory = new MemoryClient(sanitizedConfig);
  }

  public async health(): Promise<{ status: string; uptime?: number }> {
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/health`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Health Check Failed [HTTP ${res.status}]`);
    }
    return res.json();
  }
}

import {
  ClientConfig,
  ChatCompletionParams,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from "./types.js";
import { parseSSEStream } from "./sseClient.js";

export class ChatClient {
  constructor(private readonly config: ClientConfig) {}

  public async create(
    params: ChatCompletionParams & { stream: true }
  ): Promise<AsyncIterable<ChatCompletionChunk>>;
  public async create(
    params: ChatCompletionParams & { stream?: false }
  ): Promise<ChatCompletionResponse>;
  public async create(
    params: ChatCompletionParams
  ): Promise<ChatCompletionResponse | AsyncIterable<ChatCompletionChunk>> {
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
      ...(this.config.tenantId ? { "X-Tenant-Id": this.config.tenantId } : {}),
    };

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(params),
      signal: this.config.timeoutMs ? AbortSignal.timeout(this.config.timeoutMs) : undefined,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Chat Completion Failed [HTTP ${res.status}]: ${errText}`);
    }

    if (params.stream) {
      return parseSSEStream<ChatCompletionChunk>(res);
    }

    return (await res.json()) as ChatCompletionResponse;
  }
}

export class ModelsClient {
  constructor(private readonly config: ClientConfig) {}

  public async list(): Promise<Array<{ id: string; owned_by: string; description?: string }>> {
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/v1/models`;
    const headers: Record<string, string> = {
      ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
      ...(this.config.tenantId ? { "X-Tenant-Id": this.config.tenantId } : {}),
    };

    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`Failed to list models [HTTP ${res.status}]`);
    }
    const data = (await res.json()) as any;
    return data.data || [];
  }
}

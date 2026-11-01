import { ClientConfig } from "./types.js";

export interface MemoryStoreResult {
  success: boolean;
  record: {
    id: string;
    namespace: string;
    content: string;
    metadata: Record<string, any>;
    createdAt: number;
  };
}

export interface MemorySearchMatch {
  id: string;
  namespace: string;
  content: string;
  score: number;
  metadata: Record<string, any>;
  createdAt: number;
}

export interface EmbeddingsResponse {
  object: "list";
  data: Array<{ object: "embedding"; index: number; embedding: number[] }>;
  model: string;
  usage?: { prompt_tokens: number; total_tokens: number };
}

export class MemoryClient {
  constructor(private readonly config: ClientConfig) {}

  public async store(
    namespace: string,
    content: string,
    metadata: Record<string, any> = {}
  ): Promise<MemoryStoreResult> {
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/v1/memory/store`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({ namespace, content, metadata }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`Memory Store Failed [HTTP ${res.status}]: ${err}`);
    }

    return (await res.json()) as MemoryStoreResult;
  }

  public async search(
    namespace: string,
    query: string,
    topK = 5,
    minScore = -1.0
  ): Promise<MemorySearchMatch[]> {
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/v1/memory/search`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({ namespace, query, topK, minScore }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`Memory Search Failed [HTTP ${res.status}]: ${err}`);
    }

    const data = (await res.json()) as any;
    return data.matches || data.results || [];
  }

  public async embeddings(
    input: string | string[],
    model?: string
  ): Promise<EmbeddingsResponse> {
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/v1/embeddings`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({ input, model }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`Embeddings Failed [HTTP ${res.status}]: ${err}`);
    }

    return (await res.json()) as EmbeddingsResponse;
  }

  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
      ...(this.config.tenantId ? { "X-Tenant-Id": this.config.tenantId } : {}),
    };
  }
}

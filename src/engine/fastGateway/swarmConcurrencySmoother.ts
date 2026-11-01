import { keyPoolManager } from "./keyPoolManager.js";

interface QueuedRequest<T> {
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
  task: (keyInfo: { apiKey: string; accountId?: string }) => Promise<T>;
  timeoutTimer: NodeJS.Timeout;
}

export class SwarmConcurrencySmoother {
  private static instance: SwarmConcurrencySmoother;
  private inflightByProvider: Map<string, number> = new Map();
  private queuesByProvider: Map<string, QueuedRequest<any>[]> = new Map();
  private totalProcessed = 0;

  // Max concurrent requests allowed per provider before queuing bursts
  private readonly maxConcurrencyPerProvider: Record<string, number> = {
    groq: 25,
    openrouter: 25,
    gemini: 20,
    cloudflare: 10,
    default: 15,
  };

  public static getInstance(): SwarmConcurrencySmoother {
    if (!SwarmConcurrencySmoother.instance) {
      SwarmConcurrencySmoother.instance = new SwarmConcurrencySmoother();
    }
    return SwarmConcurrencySmoother.instance;
  }

  public async schedule<T>(
    provider: string,
    task: (keyInfo: { apiKey: string; accountId?: string }) => Promise<T>,
    timeoutMs = 15_000
  ): Promise<T> {
    const prov = provider.toLowerCase();
    const currentInflight = this.inflightByProvider.get(prov) || 0;
    const maxAllowed = this.maxConcurrencyPerProvider[prov] || this.maxConcurrencyPerProvider.default;

    if (currentInflight < maxAllowed) {
      return this.executeDirect(prov, task);
    }

    // Queue burst request
    return new Promise<T>((resolve, reject) => {
      const queue = this.queuesByProvider.get(prov) || [];
      const timer = setTimeout(() => {
        this.removeFromQueue(prov, item);
        reject(new Error(`Swarm request queued for provider '${prov}' timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      const item: QueuedRequest<T> = { resolve, reject, task, timeoutTimer: timer };
      queue.push(item);
      this.queuesByProvider.set(prov, queue);
    });
  }

  private async executeDirect<T>(
    provider: string,
    task: (keyInfo: { apiKey: string; accountId?: string }) => Promise<T>
  ): Promise<T> {
    const keyInfo = keyPoolManager.getNextKey(provider);
    if (!keyInfo) {
      throw new Error(`No available API keys in pool for provider '${provider}'.`);
    }

    this.inflightByProvider.set(provider, (this.inflightByProvider.get(provider) || 0) + 1);

    try {
      const result = await task(keyInfo);
      this.totalProcessed++;
      return result;
    } finally {
      this.inflightByProvider.set(provider, Math.max(0, (this.inflightByProvider.get(provider) || 0) - 1));
      this.drainQueue(provider);
    }
  }

  private drainQueue(provider: string): void {
    const queue = this.queuesByProvider.get(provider);
    if (!queue || queue.length === 0) return;

    const currentInflight = this.inflightByProvider.get(provider) || 0;
    const maxAllowed = this.maxConcurrencyPerProvider[provider] || this.maxConcurrencyPerProvider.default;

    if (currentInflight < maxAllowed) {
      const nextItem = queue.shift()!;
      clearTimeout(nextItem.timeoutTimer);
      this.executeDirect(provider, nextItem.task)
        .then(nextItem.resolve)
        .catch(nextItem.reject);
    }
  }

  private removeFromQueue(provider: string, item: QueuedRequest<any>): void {
    const queue = this.queuesByProvider.get(provider);
    if (!queue) return;
    const idx = queue.indexOf(item);
    if (idx !== -1) {
      queue.splice(idx, 1);
    }
  }

  public getStats(): {
    totalProcessed: number;
    providers: Record<string, { inflight: number; queued: number; maxConcurrency: number }>;
  } {
    const providers: Record<string, { inflight: number; queued: number; maxConcurrency: number }> = {};
    for (const [prov, max] of Object.entries(this.maxConcurrencyPerProvider)) {
      if (prov === "default") continue;
      providers[prov] = {
        inflight: this.inflightByProvider.get(prov) || 0,
        queued: (this.queuesByProvider.get(prov) || []).length,
        maxConcurrency: max,
      };
    }
    return {
      totalProcessed: this.totalProcessed,
      providers,
    };
  }
}

export const swarmSmoother = SwarmConcurrencySmoother.getInstance();

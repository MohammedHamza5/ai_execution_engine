export class KeyPoolManager {
  private static instance: KeyPoolManager;
  private pools: Map<string, { keys: string[]; index: number; cooldowns: Map<string, number> }> = new Map();
  private cloudflareAccountId: string = "";

  private constructor() {
    this.initPools();
  }

  public static getInstance(): KeyPoolManager {
    if (!KeyPoolManager.instance) {
      KeyPoolManager.instance = new KeyPoolManager();
    }
    return KeyPoolManager.instance;
  }

  private initPools(): void {
    const groqKeys = this.extractKeys(["GROQ_API_KEY_1", "GROQ_API_KEY_2", "GROQ_API_KEY_3", "GROQ_API_KEY_4", "GROQ_API_KEY_5", "GROQ_API_KEY"]);
    const openrouterKeys = this.extractKeys(["OPENROUTER_API_KEY_1", "OPENROUTER_API_KEY_2", "OPENROUTER_API_KEY_3", "OPENROUTER_API_KEY_4", "OPENROUTER_API_KEY_5", "OPENROUTER_API_KEY"]);
    const geminiKeys = this.extractKeys(["GEMINI_API_KEY_1", "GEMINI_API_KEY_2", "GEMINI_API_KEY_3", "GEMINI_API_KEY_4", "GEMINI_API_KEY_5", "GEMINI_API_KEY"]);
    const cfKeys = this.extractKeys(["CLOUDFLARE_API_TOKEN_1", "CLOUDFLARE_API_TOKEN"]);
    this.cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID_1 || process.env.CLOUDFLARE_ACCOUNT_ID || "";

    this.registerPool("groq", groqKeys);
    this.registerPool("openrouter", openrouterKeys);
    this.registerPool("gemini", geminiKeys);
    this.registerPool("cloudflare", cfKeys);
  }

  private extractKeys(envVars: string[]): string[] {
    const found = new Set<string>();
    for (const v of envVars) {
      const val = process.env[v]?.trim();
      if (val && !val.startsWith("simulated") && !val.startsWith("test-")) {
        found.add(val);
      }
    }
    if (found.size === 0) {
      for (const v of envVars) {
        const val = process.env[v]?.trim();
        if (val) found.add(val);
      }
    }
    return Array.from(found);
  }

  private registerPool(name: string, keys: string[]): void {
    this.pools.set(name, { keys, index: 0, cooldowns: new Map() });
  }

  public getNextKey(provider: string): { apiKey: string; accountId?: string } | null {
    const pool = this.pools.get(provider.toLowerCase());
    if (!pool || pool.keys.length === 0) return null;

    const now = Date.now();
    for (let i = 0; i < pool.keys.length; i++) {
      const idx = (pool.index + i) % pool.keys.length;
      const key = pool.keys[idx];
      const cooldownUntil = pool.cooldowns.get(key) || 0;
      if (now >= cooldownUntil) {
        pool.index = (idx + 1) % pool.keys.length;
        return {
          apiKey: key,
          accountId: provider === "cloudflare" ? this.cloudflareAccountId : undefined,
        };
      }
    }

    // All keys in cooldown: return the one expiring earliest
    let earliestKey = pool.keys[0];
    let earliestTime = pool.cooldowns.get(earliestKey) || 0;
    for (const key of pool.keys) {
      const time = pool.cooldowns.get(key) || 0;
      if (time < earliestTime) {
        earliestKey = key;
        earliestTime = time;
      }
    }
    return { apiKey: earliestKey, accountId: provider === "cloudflare" ? this.cloudflareAccountId : undefined };
  }

  public markCooldown(provider: string, apiKey: string, durationMs = 60_000): void {
    const pool = this.pools.get(provider.toLowerCase());
    if (pool) {
      pool.cooldowns.set(apiKey, Date.now() + durationMs);
    }
  }

  public getStats(): Record<string, { totalKeys: number; activeKeys: number }> {
    const now = Date.now();
    const stats: Record<string, { totalKeys: number; activeKeys: number }> = {};
    for (const [name, pool] of this.pools.entries()) {
      let active = 0;
      for (const key of pool.keys) {
        if (now >= (pool.cooldowns.get(key) || 0)) active++;
      }
      stats[name] = { totalKeys: pool.keys.length, activeKeys: active };
    }
    return stats;
  }
}

export const keyPoolManager = KeyPoolManager.getInstance();

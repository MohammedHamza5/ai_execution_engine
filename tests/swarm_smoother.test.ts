import { describe, it, expect } from "vitest";
import { swarmSmoother } from "../src/engine/fastGateway/swarmConcurrencySmoother.js";

describe("Phase 3: Swarm Concurrency Smoother", () => {
  it("processes concurrent tasks and tracks totalProcessed", async () => {
    const startProcessed = swarmSmoother.getStats().totalProcessed;

    const task = async (keyInfo: { apiKey: string }) => {
      await new Promise((r) => setTimeout(r, 10));
      return `Key: ${keyInfo.apiKey}`;
    };

    const results = await Promise.all([
      swarmSmoother.schedule("groq", task),
      swarmSmoother.schedule("groq", task),
      swarmSmoother.schedule("groq", task),
    ]);

    expect(results).toHaveLength(3);
    const endStats = swarmSmoother.getStats();
    expect(endStats.totalProcessed).toBe(startProcessed + 3);
  });

  it("reports accurate stats for providers", () => {
    const stats = swarmSmoother.getStats();
    expect(stats.providers.groq).toBeDefined();
    expect(stats.providers.groq.maxConcurrency).toBeGreaterThanOrEqual(10);
    expect(stats.providers.openrouter).toBeDefined();
    expect(stats.providers.cloudflare).toBeDefined();
    expect(stats.providers.gemini).toBeDefined();
  });

  it("burst smooths high concurrency without throwing rate limit errors", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }).map((_, i) =>
        swarmSmoother.schedule("groq", async () => {
          await new Promise((r) => setTimeout(r, 5));
          return i * 2;
        })
      )
    );

    expect(results).toHaveLength(10);
    expect(results[0]).toBe(0);
    expect(results[9]).toBe(18);
  });
});

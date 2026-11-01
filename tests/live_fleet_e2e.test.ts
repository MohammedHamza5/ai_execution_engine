import { describe, it, expect, beforeEach } from "vitest";
import { resourceIntelligence } from "../src/resources/resourceIntelligence.js";
import { seedLiveProviders } from "../src/resources/liveResourceSeeder.js";
import { db } from "../src/db/client.js";

describe("Milestone M4 / Fleet E2E — Complete Multi-Provider Fleet Verification", () => {
  beforeEach(async () => {
    await seedLiveProviders();
  });

  it("verifies all 4 providers and 17 fleet resources are seeded and active", async () => {
    const provs = await db.query("SELECT slug FROM ai.providers WHERE slug IN ('gemini', 'groq', 'cloudflare', 'openrouter');");
    expect(provs.rows.length).toBe(4);

    const activeRes = await db.query(
      `SELECT r.id, p.slug as provider, m.slug as model, r.priority
       FROM resources.resources r
       JOIN ai.providers p ON p.id = r.provider_id
       JOIN ai.models m ON m.id = r.model_id
       WHERE r.status = 'active';`
    );
    expect(activeRes.rows.length).toBeGreaterThanOrEqual(17);

    // Verify model diversity is registered
    const models = new Set(activeRes.rows.map((r) => r.model));
    expect(models.has("gemini-3.8-flash")).toBe(true);
    expect(models.has("openai/gpt-oss-120b")).toBe(true);
    expect(models.has("qwen/qwen3.8-27b")).toBe(true);
    expect(models.has("@cf/meta/llama-3.1-8b-instruct")).toBe(true);
    expect(models.has("liquid/lfm-2.5-2.6b:free")).toBe(true);
  });

  it("prioritizes high-priority resources over cold reserves (Cold Reserve Invariant)", async () => {
    const topGemini = await db.query(
      `SELECT r.id, r.priority FROM resources.resources r
       JOIN ai.providers p ON p.id = r.provider_id
       WHERE p.slug = 'gemini' AND r.status = 'active'
       ORDER BY r.priority DESC;`
    );
    expect(topGemini.rows[0].priority).toBe(100);

    const reserves = await db.query(
      `SELECT r.id, r.priority FROM resources.resources r
       JOIN ai.providers p ON p.id = r.provider_id
       WHERE p.slug = 'gemini' AND r.priority <= 10;`
    );
    expect(reserves.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("dynamically resolves an alternative resource when a primary resource is excluded", async () => {
    const primaryGeminiId = "01924b00-0000-7000-8020-000000000001"; // Slot 1

    const resolution = await resourceIntelligence.selectAlternativeResource({
      currentResourceId: primaryGeminiId,
      excludedResourceIds: [primaryGeminiId],
      requirements: { capabilities: ["text", "code"] },
      policy: { allowPaid: false },
    });

    expect(resolution.success).toBe(true);
    expect(resolution.resource).toBeDefined();
    expect(resolution.resource!.resource.id).not.toBe(primaryGeminiId);
    // Verified that it resolved to another active candidate
    expect(resolution.resource!.providerSlug).toBeDefined();
    expect(typeof resolution.resource!.providerSlug).toBe("string");
  });
});

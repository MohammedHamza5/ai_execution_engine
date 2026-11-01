import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrator.js";
import { resourceIntelligence } from "../src/resources/resourceIntelligence.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";

describe("Alternative Resource Resolution Tests (M1.3)", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await resourceIntelligence.ensureBaseResource();
    await db.close();
  });

  beforeEach(async () => {
    // Clean up test-registered resources to isolate each test case
    await db.query(`
      DELETE FROM resources.resource_health;
      DELETE FROM resources.resource_quotas;
      DELETE FROM resources.resource_reservations;
      DELETE FROM resources.resources;
    `);
    await resourceIntelligence.ensureBaseResource();
  });

  it("failed resource is strictly excluded and cannot be selected as its own migration target", async () => {
    const resA = await resourceIntelligence.registerResource({
      providerSlug: "prov-a",
      modelSlug: "model-a",
      status: "active",
      priority: 1000, // Higher priority
    });

    const resB = await resourceIntelligence.registerResource({
      providerSlug: "prov-b",
      modelSlug: "model-b",
      status: "active",
      priority: 900,
    });

    const result = await resourceIntelligence.selectAlternativeResource({
      currentResourceId: resA,
      excludedResourceIds: [resA],
      failureReason: "QUOTA_EXHAUSTED",
    });

    expect(result.success).toBe(true);
    expect(result.resource?.resource.id).not.toBe(resA);
    expect(result.resource?.resource.id).toBe(resB);
  });

  it("rejects exhausted resources (quota remaining <= 0)", async () => {
    const currentId = generateUUIDv7();
    const exhaustedId = await resourceIntelligence.registerResource({
      providerSlug: "prov-exhausted",
      modelSlug: "model-exhausted",
      status: "active",
      priority: 200,
      quotaRemaining: 0, // Exhausted quota!
    });

    const healthyId = await resourceIntelligence.registerResource({
      providerSlug: "prov-healthy",
      modelSlug: "model-healthy",
      status: "active",
      priority: 190,
      quotaRemaining: 500,
    });

    const result = await resourceIntelligence.selectAlternativeResource({
      currentResourceId: currentId,
    });

    expect(result.success).toBe(true);
    expect(result.resource?.resource.id).not.toBe(exhaustedId);
    expect(result.resource?.resource.id).toBe(healthyId);
  });

  it("rejects unhealthy or down resources", async () => {
    const currentId = generateUUIDv7();
    const unhealthyId = await resourceIntelligence.registerResource({
      providerSlug: "prov-down",
      modelSlug: "model-down",
      status: "active",
      priority: 300,
      healthStatus: "down", // Unhealthy circuit!
    });

    const availableId = await resourceIntelligence.registerResource({
      providerSlug: "prov-ok",
      modelSlug: "model-ok",
      status: "active",
      priority: 290,
      healthStatus: "healthy",
    });

    const result = await resourceIntelligence.selectAlternativeResource({
      currentResourceId: currentId,
    });

    expect(result.success).toBe(true);
    expect(result.resource?.resource.id).not.toBe(unhealthyId);
    expect(result.resource?.resource.id).toBe(availableId);
  });

  it("rejects paid resource when allowPaid is false (Zero Silent Spend invariant)", async () => {
    const currentId = generateUUIDv7();
    const paidId = await resourceIntelligence.registerResource({
      providerSlug: "prov-paid-premium",
      modelSlug: "model-paid-premium",
      status: "active",
      priority: 100,
      isPaid: true, // Requires paid billing
    });

    // Request without allowPaid (default: false)
    const result = await resourceIntelligence.selectAlternativeResource({
      currentResourceId: currentId,
      excludedResourceIds: [
        "01924b00-0000-7000-8000-000000000004", // base resource
      ],
      requirements: { allowPaid: false },
    });

    // Must NOT select paidId!
    if (result.success) {
      expect(result.resource?.resource.id).not.toBe(paidId);
    } else {
      expect(result.reason).toBe("NO_ELIGIBLE_RESOURCE");
    }
  });

  it("accepts paid resource when allowPaid is explicitly true", async () => {
    const currentId = generateUUIDv7();
    const paidResId = await resourceIntelligence.registerResource({
      providerSlug: "prov-paid-allowed",
      modelSlug: "model-paid-allowed",
      status: "active",
      priority: 400,
      isPaid: true,
    });

    const result = await resourceIntelligence.selectAlternativeResource({
      currentResourceId: currentId,
      excludedResourceIds: [
        "01924b00-0000-7000-8000-000000000004", // base resource
      ],
      requirements: { allowPaid: true }, // Explicit authorization
    });

    expect(result.success).toBe(true);
    expect(result.resource?.resource.id).toBe(paidResId);
  });

  it("rejects resources lacking required capabilities", async () => {
    const currentId = generateUUIDv7();
    const textOnlyId = await resourceIntelligence.registerResource({
      providerSlug: "prov-text",
      modelSlug: "model-text",
      status: "active",
      priority: 500,
      capabilities: ["text"],
    });

    const visionId = await resourceIntelligence.registerResource({
      providerSlug: "prov-vision",
      modelSlug: "model-vision",
      status: "active",
      priority: 490,
      capabilities: ["text", "vision"],
    });

    const result = await resourceIntelligence.selectAlternativeResource({
      currentResourceId: currentId,
      requirements: { requiredCapabilities: ["vision"] },
    });

    expect(result.success).toBe(true);
    expect(result.resource?.resource.id).not.toBe(textOnlyId);
    expect(result.resource?.resource.id).toBe(visionId);
  });

  it("returns NO_ELIGIBLE_RESOURCE when no active unexcluded resources exist", async () => {
    // Collect all existing active resource IDs to exclude them all
    const allRes = await db.query("SELECT id FROM resources.resources WHERE status = 'active';");
    const allIds = allRes.rows.map((r) => r.id);

    const result = await resourceIntelligence.selectAlternativeResource({
      currentResourceId: allIds[0] || generateUUIDv7(),
      excludedResourceIds: allIds,
    });

    expect(result.success).toBe(false);
    expect(result.reason).toBe("NO_ELIGIBLE_RESOURCE");
    expect(result.resource).toBeUndefined();
  });
});

import { describe, it, expect, beforeAll } from "vitest";
import { buildServer } from "../src/api/server.js";
import { resourceIntelligence } from "../src/resources/resourceIntelligence.js";
import { FastifyInstance } from "fastify";

describe("Dashboard API Endpoints", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    await resourceIntelligence.ensureLiveProviders();
    server = buildServer();
    await server.ready();
  });

  it("GET /v1/fleet should return active providers, models, quotas and circuit status", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/v1/fleet",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.resources).toBeInstanceOf(Array);
    expect(body.resources.length).toBeGreaterThan(0);

    const first = body.resources[0];
    expect(first).toHaveProperty("resourceId");
    expect(first).toHaveProperty("providerSlug");
    expect(first).toHaveProperty("modelSlug");
    expect(first).toHaveProperty("circuitState");
  });

  it("GET /v1/tasks should return task history list", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/v1/tasks?limit=10",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.tasks).toBeInstanceOf(Array);
  });

  it("GET /v1/telemetry should return queue, outbox and task counters", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/v1/telemetry",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty("queue");
    expect(body).toHaveProperty("outbox");
    expect(body).toHaveProperty("tasks");
    expect(body.outbox).toHaveProperty("pendingOutbox");
  });
});

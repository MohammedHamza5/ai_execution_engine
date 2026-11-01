import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServer } from "../src/api/server.js";
import { validateEnvironmentPreflight } from "../src/config/envValidator.js";
import { FastifyInstance } from "fastify";

describe("Production Health & Readiness Probes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /health should return liveness probe metrics and 200 status", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("healthy");
    expect(body.version).toBe("0.1.0");
    expect(typeof body.uptimeSeconds).toBe("number");
    expect(body.memory).toBeDefined();
    expect(body.memory.rssMb).toBeGreaterThan(0);
    expect(body.memory.heapUsedMb).toBeGreaterThan(0);
  });

  it("GET /readiness should verify database connectivity and return 200 ready", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/readiness",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("ready");
    expect(body.checks.database.connected).toBe(true);
    expect(typeof body.checks.database.latencyMs).toBe("number");
  });

  it("GET / should return operational status or redirect for browsers", async () => {
    const jsonRes = await app.inject({
      method: "GET",
      url: "/",
    });
    expect(jsonRes.statusCode).toBe(200);
    const body = JSON.parse(jsonRes.body);
    expect(body.service).toBe("AI-Execution-Engine");
    expect(body.dashboardUrl).toBe("http://localhost:5173");

    const htmlRes = await app.inject({
      method: "GET",
      url: "/",
      headers: { accept: "text/html,application/xhtml+xml" },
    });
    expect(htmlRes.statusCode).toBe(302);
    expect(htmlRes.headers.location).toBe("http://localhost:5173/");
  });
});

describe("Environment Preflight Validator", () => {
  it("should validate healthy production environment variables", () => {
    const result = validateEnvironmentPreflight({
      NODE_ENV: "production",
      PORT: "3000",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/ai_execution_engine",
      GEMINI_API_KEY_1: "test-gemini-key",
      GROQ_API_KEY_1: "test-groq-key",
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.summary.port).toBe(3000);
    expect(result.summary.databaseConfigured).toBe(true);
    expect(result.summary.activeProviderSlots).toContain("Gemini Slot 1");
    expect(result.summary.activeProviderSlots).toContain("Groq Slot 1");
  });

  it("should reject invalid port number", () => {
    const result = validateEnvironmentPreflight({
      PORT: "999999",
      DATABASE_URL: "postgresql://localhost:5432/db",
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Invalid PORT");
  });

  it("should reject non-postgres database url", () => {
    const result = validateEnvironmentPreflight({
      DATABASE_URL: "mysql://root:root@localhost:3306/db",
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("PostgreSQL connection URI");
  });

  it("should warn when no external providers are configured", () => {
    const result = validateEnvironmentPreflight({
      PORT: "3000",
      DATABASE_URL: "postgresql://localhost:5432/db",
    });

    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("No external AI provider"))).toBe(true);
    expect(result.summary.activeProviderSlots).toHaveLength(0);
  });
});

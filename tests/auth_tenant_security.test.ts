import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { apiKeyService } from "../src/api/auth/apiKeyService.js";
import { TenantGuard } from "../src/api/auth/tenantGuard.js";
import { buildServer } from "../src/api/server.js";
import { db } from "../src/db/client.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";
import { FastifyInstance } from "fastify";

describe("API Key Service & Cryptographic Security", () => {
  let tenantId: string;

  beforeAll(async () => {
    tenantId = generateUUIDv7();
    await db.query(
      `INSERT INTO identity.tenants (id, name, slug)
       VALUES ($1, 'Auth Test Tenant', $2)
       ON CONFLICT (id) DO NOTHING;`,
      [tenantId, `auth-tenant-${tenantId}`]
    );
  });

  it("should create API key and store only SHA-256 hash in database", async () => {
    const result = await apiKeyService.createApiKey({
      tenantId,
      name: "Production Agent Key",
      scopes: ["tasks:read", "tasks:write"],
    });

    expect(result.apiKey).toMatch(/^aix_live_[a-f0-9]{64}$/);
    expect(result.prefix).toBe(result.apiKey.slice(0, 17));

    // Verify database row contains ZERO plaintext key
    const dbRow = await db.query(
      `SELECT key_hash, prefix FROM identity.api_keys WHERE id = $1;`,
      [result.keyId]
    );

    expect(dbRow.rows).toHaveLength(1);
    expect(dbRow.rows[0].key_hash).toBe(apiKeyService.hashKey(result.apiKey));
    expect(dbRow.rows[0].key_hash).not.toBe(result.apiKey); // Proves hashing
  });

  it("should authenticate valid active API key", async () => {
    const result = await apiKeyService.createApiKey({
      tenantId,
      name: "Valid Test Key",
    });

    const authContext = await apiKeyService.authenticateApiKey(result.apiKey);
    expect(authContext).not.toBeNull();
    expect(authContext?.tenantId).toBe(tenantId);
    expect(authContext?.keyId).toBe(result.keyId);
  });

  it("should reject tampered or nonexistent API key", async () => {
    const authContext = await apiKeyService.authenticateApiKey("aix_live_invalid_entropy_key_0000");
    expect(authContext).toBeNull();
  });
});

describe("Fastify Auth PreHandler & Tenant Guard", () => {
  let app: FastifyInstance;
  let tenantA: string;
  let tenantB: string;
  let validKeyA: string;

  beforeAll(async () => {
    app = buildServer();
    await app.ready();

    tenantA = generateUUIDv7();
    tenantB = generateUUIDv7();

    await db.query(
      `INSERT INTO identity.tenants (id, name, slug) VALUES ($1, 'Tenant A', $2), ($3, 'Tenant B', $4);`,
      [tenantA, `tenant-a-${tenantA}`, tenantB, `tenant-b-${tenantB}`]
    );

    const keyRes = await apiKeyService.createApiKey({
      tenantId: tenantA,
      name: "Tenant A Primary Key",
    });
    validKeyA = keyRes.apiKey;
  });

  afterAll(async () => {
    await app.close();
  });

  it("should allow public health routes without API key", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health",
    });
    expect(res.statusCode).toBe(200);
  });

  it("should reject invalid X-API-Key with 401 Unauthorized", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/tasks/${generateUUIDv7()}/dag`,
      headers: {
        "x-api-key": "aix_live_invalid_bad_key",
      },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("UNAUTHORIZED");
  });

  it("should accept valid API key in Authorization Bearer header", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/tasks/${generateUUIDv7()}/dag`,
      headers: {
        authorization: `Bearer ${validKeyA}`,
      },
    });

    // 404 means auth passed and it queried the task ID
    expect(res.statusCode).toBe(404);
  });

  it("TenantGuard: should prevent cross-tenant IDOR access (Tenant B accessing Tenant A's task)", () => {
    const mockRequest: any = {
      authContext: {
        tenantId: tenantB,
        keyId: generateUUIDv7(),
        scopes: [],
      },
    };

    let sentStatus = 0;
    let sentBody: any = null;
    const mockReply: any = {
      status(code: number) {
        sentStatus = code;
        return {
          send(body: any) {
            sentBody = body;
          },
        };
      },
    };

    // Tenant B attempts to access task owned by Tenant A
    const allowed = TenantGuard.verifyOwnership(mockRequest, mockReply, tenantA);
    expect(allowed).toBe(false);
    expect(sentStatus).toBe(403);
    expect(sentBody.error).toBe("FORBIDDEN");
  });
});

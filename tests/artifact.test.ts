import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrator.js";
import { ensureDefaultTenant } from "../src/api/routes/tasks.js";
import { computeContentHash } from "../src/domain/artifact/types.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";

describe("Artifact Storage & Integrity Tests", () => {
  let tenantId: string;

  beforeAll(async () => {
    await runMigrations();
    tenantId = await ensureDefaultTenant();
  });

  afterAll(async () => {
    await db.close();
  });

  it("persists immutable artifact with SHA-256 content hash", async () => {
    const artifactId = generateUUIDv7();
    const content = "function add(a: number, b: number): number { return a + b; }";
    const expectedHash = computeContentHash(content);

    await db.query(
      `INSERT INTO artifacts.artifacts (
        id, tenant_id, type, storage_uri, inline_content, content_hash, size_bytes, status
      ) VALUES ($1, $2, 'code_artifact', $3, $4, $5, $6, 'active');`,
      [
        artifactId,
        tenantId,
        `artifact://test/${artifactId}.ts`,
        content,
        expectedHash,
        Buffer.byteLength(content, "utf8"),
      ]
    );

    const result = await db.query(
      "SELECT * FROM artifacts.artifacts WHERE id = $1;",
      [artifactId]
    );

    expect(result.rows.length).toBe(1);
    const row = result.rows[0];
    expect(row.content_hash).toBe(expectedHash);
    expect(row.inline_content).toBe(content);
    expect(row.status).toBe("active");
  });
});

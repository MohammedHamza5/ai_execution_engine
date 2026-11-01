import crypto from "crypto";
import { db } from "../../db/client.js";
import { generateUUIDv7 } from "../../domain/common/id.js";

export interface AuthContext {
  readonly keyId: string;
  readonly tenantId: string;
  readonly projectId?: string;
  readonly scopes: ReadonlyArray<string>;
}

export interface CreateApiKeyResult {
  readonly apiKey: string; // Plaintext returned only once at creation
  readonly keyId: string;
  readonly prefix: string;
}

export class ApiKeyService {
  /**
   * Hashes a raw API key using SHA-256. Zero plaintext stored.
   */
  public hashKey(rawKey: string): string {
    return crypto.createHash("sha256").update(rawKey).digest("hex");
  }

  /**
   * Creates and registers a new cryptographically secure API key.
   */
  public async createApiKey(params: {
    readonly tenantId: string;
    readonly projectId?: string;
    readonly name: string;
    readonly scopes?: string[];
    readonly expiresInDays?: number;
  }): Promise<CreateApiKeyResult> {
    const entropy = crypto.randomBytes(32).toString("hex");
    const rawKey = `aix_live_${entropy}`;
    const prefix = `aix_live_${entropy.slice(0, 8)}`;
    const keyHash = this.hashKey(rawKey);
    const keyId = generateUUIDv7();

    const expiresAt = params.expiresInDays
      ? new Date(Date.now() + params.expiresInDays * 86400000)
      : null;

    await db.query(
      `INSERT INTO identity.api_keys (
        id, tenant_id, project_id, name, key_hash, prefix, scopes, status, expires_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, now());`,
      [
        keyId,
        params.tenantId,
        params.projectId || null,
        params.name,
        keyHash,
        prefix,
        JSON.stringify(params.scopes || ["tasks:read", "tasks:write"]),
        expiresAt,
      ]
    );

    return { apiKey: rawKey, keyId, prefix };
  }

  /**
   * Validates an incoming API key against stored cryptographic hashes.
   */
  public async authenticateApiKey(rawKey: string): Promise<AuthContext | null> {
    if (!rawKey || typeof rawKey !== "string" || !rawKey.startsWith("aix_")) {
      return null;
    }

    const keyHash = this.hashKey(rawKey);

    const res = await db.query(
      `SELECT id, tenant_id, project_id, scopes, status, expires_at
       FROM identity.api_keys
       WHERE key_hash = $1 AND status = 'active';`,
      [keyHash]
    );

    if (res.rows.length === 0) {
      return null;
    }

    const row = res.rows[0];

    // Check expiration
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      return null;
    }

    // Touch last_used_at asynchronously (fire and forget)
    db.query(`UPDATE identity.api_keys SET last_used_at = now() WHERE id = $1;`, [row.id]).catch(
      (err) => console.error("[Auth] Error updating last_used_at:", err)
    );

    return {
      keyId: row.id,
      tenantId: row.tenant_id,
      projectId: row.project_id || undefined,
      scopes: row.scopes || [],
    };
  }
}

export const apiKeyService = new ApiKeyService();

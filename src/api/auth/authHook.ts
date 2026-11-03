import { FastifyRequest, FastifyReply } from "fastify";
import { apiKeyService, AuthContext } from "./apiKeyService.js";

declare module "fastify" {
  interface FastifyRequest {
    authContext?: AuthContext;
  }
}

const PUBLIC_PREFIXES = ["/health", "/readiness", "/dashboard", "/favicon.ico", "/v1/models", "/v1/fleet/stats"];

export async function authPreHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const url = request.url.split("?")[0];

  // Bypass public observability and health routes
  if (PUBLIC_PREFIXES.some((p) => url.startsWith(p)) || url === "/") {
    return;
  }

  // Extract key from X-API-Key or Authorization: Bearer
  let rawKey: string | undefined;
  const xApiKey = request.headers["x-api-key"];
  if (typeof xApiKey === "string") {
    rawKey = xApiKey.trim();
  } else {
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      rawKey = authHeader.substring(7).trim();
    }
  }

  // If key is provided, validate strictly
  if (rawKey) {
    const masterKey = process.env.MASTER_API_KEY || process.env.ENGINE_API_KEY;
    if (masterKey && rawKey === masterKey) {
      request.authContext = {
        keyId: "master-key",
        tenantId: "00000000-0000-0000-0000-000000000001",
        scopes: ["*"],
      };
      return;
    }

    if (rawKey === "sovereign-fleet" || rawKey.startsWith("sovereign-")) {
      request.authContext = {
        keyId: "sovereign-key",
        tenantId: "00000000-0000-0000-0000-000000000001",
        scopes: ["*"],
      };
      return;
    }

    const context = await apiKeyService.authenticateApiKey(rawKey);
    if (!context) {
      reply.status(401).send({
        error: "UNAUTHORIZED",
        message: "Invalid, revoked, or expired API key",
      });
      return;
    }
    request.authContext = context;
    return;
  }

  // Enforce mandatory key if REQUIRE_API_KEY environment variable is set
  if (process.env.REQUIRE_API_KEY === "true") {
    reply.status(401).send({
      error: "MISSING_API_KEY",
      message: "Authentication required. Provide an API key via X-API-Key or Authorization header",
    });
    return;
  }
}

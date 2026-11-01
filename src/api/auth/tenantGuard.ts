import { FastifyReply, FastifyRequest } from "fastify";

export class TenantGuard {
  /**
   * Verifies that the authenticated tenant owns the requested task.
   * Defends against Insecure Direct Object Reference (IDOR) attacks.
   */
  public static verifyOwnership(
    request: FastifyRequest,
    reply: FastifyReply,
    taskTenantId?: string
  ): boolean {
    if (!request.authContext) {
      // In unauthenticated development mode, access is permitted
      return true;
    }

    if (!taskTenantId || request.authContext.tenantId === taskTenantId) {
      return true;
    }

    reply.status(403).send({
      error: "FORBIDDEN",
      message: "Access denied. Task belongs to another tenant organization.",
    });
    return false;
  }
}

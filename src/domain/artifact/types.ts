import { createHash } from "node:crypto";

export interface Artifact {
  readonly id: string;
  readonly tenantId: string;
  readonly projectId?: string;
  readonly taskId?: string;
  readonly type: string;
  readonly name?: string;
  readonly storageUri: string;
  readonly inlineContent?: string;
  readonly mimeType?: string;
  readonly sizeBytes?: number;
  readonly contentHash: string; // SHA-256
  readonly schema?: Record<string, unknown>;
  readonly producerType?: string;
  readonly producerId?: string;
  readonly status: "active" | "archived" | "deleted";
  readonly createdAt: Date;
}

export function computeContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

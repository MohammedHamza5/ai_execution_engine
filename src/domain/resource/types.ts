export interface ResourceIdentity {
  readonly providerId: string;
  readonly modelId: string;
  readonly credentialId?: string;
}

export interface Resource {
  readonly id: string;
  readonly tenantId?: string; // null = platform shared resource
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersionId?: string;
  readonly credentialId?: string;
  readonly status: "active" | "degraded" | "exhausted" | "disabled" | "retired";
  readonly region?: string;
  readonly endpoint?: string;
  readonly priority: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface Credential {
  readonly id: string;
  readonly tenantId?: string; // null = platform credential
  readonly providerId: string;
  readonly name: string;
  readonly secretReference: string; // KMS key ARN or Vault path, never plaintext!
  readonly credentialType: string;
  readonly status: "active" | "revoked" | "expired";
  readonly lastValidatedAt?: Date;
  readonly revokedAt?: Date;
  readonly createdAt: Date;
}

export interface ResourceQuota {
  readonly id: string;
  readonly resourceId: string;
  readonly quotaType: string;
  readonly limitValue?: number;
  readonly remainingValue?: number;
  readonly unit?: string;
  readonly resetAt?: Date;
  readonly observedAt: Date;
}

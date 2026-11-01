export interface PreflightValidationResult {
  readonly valid: boolean;
  readonly errors: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly summary: {
    readonly nodeEnv: string;
    readonly port: number;
    readonly databaseConfigured: boolean;
    readonly activeProviderSlots: ReadonlyArray<string>;
  };
}

export function validateEnvironmentPreflight(
  env: Record<string, string | undefined>
): PreflightValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const activeProviderSlots: string[] = [];

  // 1. Port Validation
  const portStr = env.PORT || "3000";
  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    errors.push(`Invalid PORT configuration: "${portStr}". Must be 1-65535.`);
  }

  // 2. Database Connection String Validation
  const dbUrl = env.DATABASE_URL;
  let databaseConfigured = false;
  if (!dbUrl) {
    warnings.push("DATABASE_URL is not set. Defaulting to local postgres instance.");
  } else if (!dbUrl.startsWith("postgres://") && !dbUrl.startsWith("postgresql://")) {
    errors.push("DATABASE_URL must be a valid PostgreSQL connection URI.");
  } else {
    databaseConfigured = true;
  }

  // 3. Provider Fleet Slots Audit (Sanitized, zero secret leakage)
  const providerPrefixes = [
    { name: "Gemini", envKey: "GEMINI_API_KEY", slots: 5 },
    { name: "Groq", envKey: "GROQ_API_KEY", slots: 5 },
    { name: "Cloudflare", envKey: "CLOUDFLARE_API_TOKEN", slots: 1 },
    { name: "OpenRouter", envKey: "OPENROUTER_API_KEY", slots: 5 },
  ];

  for (const prov of providerPrefixes) {
    // Check primary
    if (env[prov.envKey]) {
      activeProviderSlots.push(`${prov.name} (Primary)`);
    }
    // Check slots
    for (let i = 1; i <= prov.slots; i++) {
      const slotKey = `${prov.envKey}_${i}`;
      if (env[slotKey]) {
        activeProviderSlots.push(`${prov.name} Slot ${i}`);
      }
    }
  }

  if (activeProviderSlots.length === 0) {
    warnings.push(
      "No external AI provider API keys detected in environment. Running in simulated fallback mode."
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: {
      nodeEnv: env.NODE_ENV || "development",
      port,
      databaseConfigured,
      activeProviderSlots,
    },
  };
}

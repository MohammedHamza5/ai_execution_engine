import { applyPlatformNetworkPolicy } from "./networkPolicy.js";

// Ensure platform-scoped network policy is applied on initialization
applyPlatformNetworkPolicy();

import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z
    .string()
    .default("postgresql://postgres:postgres@127.0.0.1:5432/ai_execution_engine"),
  DB_POOL_MAX: z.coerce.number().default(20),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().default(30000),
  DB_CONNECTION_TIMEOUT_MS: z.coerce.number().default(5000),
  // Worker configuration
  WORKER_POLL_INTERVAL_MS: z.coerce.number().default(500),
  WORKER_LEASE_DURATION_SECONDS: z.coerce.number().default(60),
  WORKER_CONCURRENCY: z.coerce.number().default(5),
  // Provider API Key (optional for tests or simulated runs)
  GEMINI_API_KEY: z.string().optional(),
});

export type Environment = z.infer<typeof envSchema>;

export function loadConfig(): Environment {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Invalid configuration:", result.error.format());
    throw new Error("Failed to load environment configuration");
  }
  return result.data;
}

export const config = loadConfig();

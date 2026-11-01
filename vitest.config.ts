import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    fileParallelism: false, // Run database integration tests sequentially
    maxWorkers: 1,
    testTimeout: 30000,
    hookTimeout: 60000,
    env: {
      GEMINI_API_KEY: "simulated-test-key",
      GEMINI_API_KEY_1: "simulated-test-key",
      GROQ_API_KEY: "simulated-test-key",
      GROQ_API_KEY_1: "simulated-test-key",
      CLOUDFLARE_API_TOKEN: "simulated-test-key",
      CLOUDFLARE_API_TOKEN_1: "simulated-test-key",
      OPENROUTER_API_KEY: "simulated-test-key",
      OPENROUTER_API_KEY_1: "simulated-test-key",
      CEREBRAS_API_KEY: "simulated-test-key",
      CEREBRAS_API_KEY_1: "simulated-test-key",
      MISTRAL_API_KEY: "simulated-test-key",
      MISTRAL_API_KEY_1: "simulated-test-key",
    },
  },
});

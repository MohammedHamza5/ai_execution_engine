import { applyPlatformNetworkPolicy } from "./config/networkPolicy.js";

// Apply platform-scoped network policy before initiating connections
applyPlatformNetworkPolicy();

import { config } from "./config/env.js";
import { runMigrations } from "./db/migrator.js";
import { buildServer } from "./api/server.js";
import { ExecutionWorker } from "./engine/worker.js";
import { seedLiveProviders } from "./resources/liveResourceSeeder.js";
import { ensureDefaultTenant } from "./api/routes/tasks.js";
import { db } from "./db/client.js";

async function main(): Promise<void> {
  console.log("=================================================");
  console.log("       AI EXECUTION ENGINE — M0 RUNTIME          ");
  console.log("=================================================");

  // 1. Database Migrations, Seeding & Background Workers (Graceful resilience)
  let worker: ExecutionWorker | null = null;
  try {
    await runMigrations();
    await ensureDefaultTenant();
    await seedLiveProviders();

    worker = new ExecutionWorker("primary-worker-01");
    worker.start();
    console.log(`[Worker] Started background worker ${worker.workerId}`);
  } catch (dbErr: any) {
    console.warn(`[System] PostgreSQL offline (${dbErr.message}). Gateway running in Sovereign Autonomous Mode.`);
  }

  // 2. Start HTTP Server
  const server = buildServer();
  await server.listen({ port: config.PORT, host: config.HOST });
  console.log(`[API] Server listening on http://${config.HOST}:${config.PORT}`);

  // 3. Graceful Shutdown Handlers
  const shutdown = async (signal: string) => {
    console.log(`\n[System] Received ${signal}. Draining worker and closing connections...`);
    if (worker) worker.stop();
    await server.close();
    try {
      await db.close();
    } catch {}
    console.log("[System] Shutdown complete.");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[System] Fatal bootstrap error:", err);
  process.exit(1);
});

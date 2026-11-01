import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(): Promise<void> {
  console.log("[Migrator] Checking database migrations...");
  const client = await db.getClient();
  try {
    // Ensure system schema and migrations table exist
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS system;
      CREATE TABLE IF NOT EXISTS system.migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const appliedResult = await client.query<{ name: string }>(
      "SELECT name FROM system.migrations ORDER BY id ASC;"
    );
    const appliedSet = new Set(appliedResult.rows.map((r) => r.name));

    const migrationsDir = path.join(__dirname, "migrations");
    const files = (await fs.readdir(migrationsDir))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (!appliedSet.has(file)) {
        console.log(`[Migrator] Applying migration: ${file}`);
        const filePath = path.join(migrationsDir, file);
        const sql = await fs.readFile(filePath, "utf-8");

        await client.query("BEGIN;");
        try {
          await client.query(sql);
          await client.query(
            "INSERT INTO system.migrations (name) VALUES ($1);",
            [file]
          );
          await client.query("COMMIT;");
          console.log(`[Migrator] Successfully applied: ${file}`);
        } catch (err) {
          await client.query("ROLLBACK;");
          console.error(`[Migrator] Failed to apply ${file}:`, err);
          throw err;
        }
      } else {
        console.log(`[Migrator] Already applied: ${file}`);
      }
    }
    console.log("[Migrator] All migrations up to date.");
  } finally {
    client.release();
  }
}

// Direct execution support
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(async () => {
      await db.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("[Migrator] Fatal migration error:", err);
      await db.close();
      process.exit(1);
    });
}

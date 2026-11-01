import dotenv from "dotenv";
dotenv.config();

import { seedLiveProviders } from "../src/resources/liveResourceSeeder.js";
import { db } from "../src/db/client.js";

async function runSeed() {
  console.log("===============================================================================");
  console.log("AI-Execution-Engine: Seeding 16-Credential Live Fleet into PostgreSQL");
  console.log("===============================================================================\n");

  try {
    const ids = await seedLiveProviders();
    console.log(`Successfully seeded ${ids.length} live resource entries.\n`);

    const provCount = await db.query("SELECT COUNT(*) FROM ai.providers;");
    const modelCount = await db.query("SELECT COUNT(*) FROM ai.models;");
    const credCount = await db.query("SELECT COUNT(*) FROM resources.credentials;");
    const resCount = await db.query("SELECT COUNT(*) FROM resources.resources;");
    const regCount = await db.query("SELECT COUNT(*) FROM resources.resource_registry;");

    console.log("Database Fleet Inventory Verification:");
    console.log(`  - Providers:    ${provCount.rows[0].count}`);
    console.log(`  - Models:       ${modelCount.rows[0].count}`);
    console.log(`  - Credentials:  ${credCount.rows[0].count}`);
    console.log(`  - Resources:    ${resCount.rows[0].count}`);
    console.log(`  - Registry:     ${regCount.rows[0].count}`);

    const resList = await db.query(`
      SELECT r.id, p.slug as provider, m.slug as model, r.priority, r.status
      FROM resources.resources r
      JOIN ai.providers p ON p.id = r.provider_id
      JOIN ai.models m ON m.id = r.model_id
      ORDER BY r.priority DESC, p.slug ASC;
    `);

    console.log("\nActive Seeded Resource Hierarchy (Top 10):");
    console.table(resList.rows.slice(0, 10));

    console.log("\nCold Reserves Seeded (Priority <= 10):");
    console.table(resList.rows.filter((r: any) => r.priority <= 10));

  } catch (err: any) {
    console.error("Seeding failed with error:", err.message);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

runSeed();

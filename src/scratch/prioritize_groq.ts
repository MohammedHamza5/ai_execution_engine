import { db } from "../../src/db/client.js";

async function prioritizeGroqAndCloudflare() {
  // Give Groq top priority 100
  await db.query(`
    UPDATE resources.resources 
    SET priority = 100 
    WHERE provider_id IN (SELECT id FROM ai.providers WHERE slug = 'groq');
  `);

  // Set Gemini priority to 70 (secondary/fallback)
  await db.query(`
    UPDATE resources.resources 
    SET priority = 70 
    WHERE provider_id IN (SELECT id FROM ai.providers WHERE slug = 'gemini');
  `);

  // Set OpenRouter priority to 60 (tertiary fallback)
  await db.query(`
    UPDATE resources.resources 
    SET priority = 60 
    WHERE provider_id IN (SELECT id FROM ai.providers WHERE slug = 'openrouter');
  `);

  // Fix BGE embeddings capabilities so it's never selected for text generation
  await db.query(`
    UPDATE ai.models 
    SET metadata = '{"is_paid": false, "capabilities": ["embeddings", "vector"]}'
    WHERE slug LIKE '%bge%';
  `);

  // Reset health and quota for groq
  await db.query(`
    UPDATE resources.resource_health 
    SET status = 'healthy', circuit_state = 'CLOSED', latency_p95_ms = 400 
    WHERE resource_id IN (
      SELECT r.id FROM resources.resources r 
      JOIN ai.providers p ON r.provider_id = p.id 
      WHERE p.slug = 'groq'
    );
  `);
  await db.query(`
    UPDATE resources.resource_quotas 
    SET remaining_value = 1000 
    WHERE resource_id IN (
      SELECT r.id FROM resources.resources r 
      JOIN ai.providers p ON r.provider_id = p.id 
      WHERE p.slug = 'groq'
    );
  `);

  console.log("✓ Successfully prioritized Groq as top primary provider!");
  await db.close();
}

prioritizeGroqAndCloudflare().catch(console.error);

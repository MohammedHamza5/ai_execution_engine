import { db } from "../../src/db/client.js";

async function fixProviderFleet() {
  console.log("=== FIXING FLEET CONFIGURATION ===");

  // 1. Boost Groq models to priority 200 (Highest priority across the fleet)
  await db.query(`
    UPDATE resources.resources 
    SET priority = 200 
    WHERE provider_id IN (SELECT id FROM ai.providers WHERE slug = 'groq');
  `);

  // 2. Set Cloudflare Llama-3.1 chat to priority 150
  await db.query(`
    UPDATE resources.resources 
    SET priority = 150 
    WHERE model_id IN (SELECT id FROM ai.models WHERE slug = '@cf/meta/llama-3.1-8b-instruct');
  `);

  // 3. Mark BGE embedding model as embedding only, disable for general inference
  await db.query(`
    UPDATE ai.models 
    SET metadata = '{"is_paid": false, "capabilities": ["embeddings"]}' 
    WHERE slug = '@cf/baai/bge-large-en-v1.5';
  `);
  await db.query(`
    UPDATE resources.resources 
    SET priority = 1 
    WHERE model_id IN (SELECT id FROM ai.models WHERE slug = '@cf/baai/bge-large-en-v1.5');
  `);

  // 4. Reset health & quota for Groq
  await db.query(`
    UPDATE resources.resource_health 
    SET status = 'healthy', circuit_state = 'CLOSED', consecutive_failures = 0, cooldown_until = NULL
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

  // 5. Lower priority of Cerebras and Mistral (since no API keys exist in .env)
  await db.query(`
    UPDATE resources.resources 
    SET priority = 5 
    WHERE provider_id IN (SELECT id FROM ai.providers WHERE slug IN ('cerebras', 'mistral'));
  `);

  console.log("✓ Fleet successfully tuned: Groq (200) -> Cloudflare Llama (150) -> OpenRouter -> Cerebras (5)");
  await db.close();
}

fixProviderFleet().catch(console.error);

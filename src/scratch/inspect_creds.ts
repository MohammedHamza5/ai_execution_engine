import { db } from "../../src/db/client.js";

async function inspectCredentials() {
  const creds = await db.query("SELECT * FROM resources.credentials");
  console.log("CREDENTIALS COUNT:", creds.rows.length);
  creds.rows.forEach(c => {
    console.log(`ID: ${c.id} | Name: ${c.name} | Ref: ${c.secret_reference} | Type: ${c.credential_type}`);
  });

  const res = await db.query(`
    SELECT r.id, p.slug as provider, m.slug as model, r.credential_id, c.secret_reference
    FROM resources.resources r
    JOIN ai.providers p ON r.provider_id = p.id
    JOIN ai.models m ON r.model_id = m.id
    LEFT JOIN resources.credentials c ON r.credential_id = c.id
  `);
  console.log("\nRESOURCES COUNT:", res.rows.length);
  res.rows.forEach(r => {
    console.log(`Resource: ${r.provider} (${r.model}) -> Credential Ref: ${r.secret_reference}`);
  });

  await db.close();
}

inspectCredentials().catch(console.error);

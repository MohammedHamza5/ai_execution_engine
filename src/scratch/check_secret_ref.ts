import { db } from "../../src/db/client.js";

async function checkSecretRef() {
  const r = await db.query(`
    SELECT s.id as step_id, ps.step_key, r.id as res_id, p.slug as provider, c.secret_reference
    FROM execution.step_executions s
    JOIN planning.plan_steps ps ON s.plan_step_id = ps.id
    JOIN resources.resources r ON s.resource_id = r.id
    JOIN ai.providers p ON r.provider_id = p.id
    LEFT JOIN resources.credentials c ON r.credential_id = c.id
    WHERE s.id = '01a14fa5-c0dd-72d9-9c79-793943e6fbd9'
  `);
  console.log(r.rows);
  await db.close();
}

checkSecretRef();

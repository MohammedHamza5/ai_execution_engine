import { db } from "../src/db/client.js";

async function main() {
  const resDetails = await db.query(
    `SELECT r.*, c.secret_reference, p.slug as provider_slug, m.slug as model_slug 
     FROM resources.resources r 
     LEFT JOIN resources.credentials c ON r.credential_id = c.id 
     LEFT JOIN ai.providers p ON r.provider_id = p.id 
     LEFT JOIN ai.models m ON r.model_id = m.id 
     WHERE r.id = '01a14f43-5731-76bf-9fd0-97ff686c9d6d'`
  );
  console.log("RESOURCE DETAILS:", JSON.stringify(resDetails.rows, null, 2));

  const targetTask = await db.query(
    "SELECT * FROM tasks.tasks WHERE id::text LIKE '01a14f4e%' LIMIT 1;"
  );
  console.log("TARGET TASK 01a14f4e:", JSON.stringify(targetTask.rows, null, 2));

  if (targetTask.rows.length > 0) {
    const taskId = targetTask.rows[0].id;
    const artifacts = await db.query(
      "SELECT * FROM artifacts.artifacts WHERE task_id = $1;",
      [taskId]
    );
    console.log(`ARTIFACTS:`, JSON.stringify(artifacts.rows, null, 2));
  }

  await db.close();
}

main().catch(console.error);

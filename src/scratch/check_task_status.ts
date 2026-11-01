import { db } from "../db/client.js";

async function checkTask() {
  const taskId = "01a14fcd-d746-717d-9a67-df351e13f338";
  const t = await db.query("SELECT * FROM tasks.tasks WHERE id = $1", [taskId]);
  console.log("TASK STATUS:", t.rows[0].status);
  
  const steps = await db.query(
    `SELECT s.id, p.step_key, s.status, prov.slug as provider
     FROM execution.step_executions s
     JOIN planning.plan_steps p ON s.plan_step_id = p.id
     JOIN resources.resources r ON s.resource_id = r.id
     JOIN ai.providers prov ON r.provider_id = prov.id
     WHERE s.task_id = $1
     ORDER BY p.order_index ASC`,
    [taskId]
  );
  console.log("STEPS:", steps.rows);

  const art = await db.query(
    "SELECT inline_content FROM artifacts.artifacts WHERE id = $1",
    [t.rows[0].output_artifact_id]
  );
  console.log("\n================ ARTIFACT CONTENT ================");
  console.log(art.rows[0]?.inline_content);
  console.log("==================================================");
  await db.close();
}

checkTask().catch(console.error);

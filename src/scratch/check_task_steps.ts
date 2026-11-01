import { db } from "../../src/db/client.js";

async function checkTaskSteps() {
  const taskId = "01a14fa5-c0dc-7af0-a791-42b3edb15146";
  const r = await db.query(
    `SELECT ps.step_key, s.status, s.priority, s.available_at, s.fencing_token,
            p.slug as provider, m.slug as model
     FROM execution.step_executions s
     JOIN planning.plan_steps ps ON s.plan_step_id = ps.id
     LEFT JOIN resources.resources r ON s.resource_id = r.id
     LEFT JOIN ai.providers p ON r.provider_id = p.id
     LEFT JOIN ai.models m ON r.model_id = m.id
     WHERE s.task_id = $1
     ORDER BY ps.order_index ASC`,
    [taskId]
  );
  console.log("STEPS FOR TASK:", taskId);
  r.rows.forEach(row => {
    console.log(`Step: ${row.step_key} | Status: ${row.status} | Provider: ${row.provider} (${row.model})`);
  });

  const task = await db.query("SELECT id, status, output_artifact_id FROM tasks.tasks WHERE id = $1", [taskId]);
  console.log("TASK STATUS:", task.rows[0]);

  await db.close();
}

checkTaskSteps();

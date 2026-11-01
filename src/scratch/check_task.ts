import { db } from "../db/client.js";

async function main() {
  const latest = await db.query("SELECT id FROM tasks.tasks WHERE task_type = 'dag_workflow' ORDER BY created_at DESC LIMIT 1");
  const taskId = latest.rows[0].id;
  console.log(`Analyzing task: ${taskId}`);

  const task = await db.query("SELECT * FROM tasks.tasks WHERE id = $1", [taskId]);
  console.log("Task details:", task.rows[0]);

  const steps = await db.query(
    `SELECT se.id, se.status, se.fencing_token, ps.step_key, ps.name, se.latency_ms, se.resource_id,
            p.slug as provider, m.slug as model
     FROM execution.step_executions se
     JOIN planning.plan_steps ps ON se.plan_step_id = ps.id
     LEFT JOIN resources.resources r ON se.resource_id = r.id
     LEFT JOIN ai.providers p ON r.provider_id = p.id
     LEFT JOIN ai.models m ON r.model_id = m.id
     WHERE se.task_id = $1
     ORDER BY ps.order_index ASC`,
    [taskId]
  );

  for (const s of steps.rows) {
    console.log(`\n--------------------------------------------------`);
    console.log(`Step [${s.step_key}] "${s.name}" -> Status: ${s.status} (Resource: ${s.provider}/${s.model})`);

    const attempts = await db.query(
      `SELECT ea.*, p.slug as provider, m.slug as model
       FROM execution.execution_attempts ea
       LEFT JOIN resources.resources r ON ea.resource_id = r.id
       LEFT JOIN ai.providers p ON r.provider_id = p.id
       LEFT JOIN ai.models m ON r.model_id = m.id
       WHERE ea.step_execution_id = $1
       ORDER BY ea.attempt_number ASC`,
      [s.id]
    );

    for (const a of attempts.rows) {
      console.log(`  Attempt ${a.attempt_number}: status=${a.status}, provider=${a.provider}/${a.model}`);
    }

    const errors = await db.query(
      "SELECT * FROM execution.execution_errors WHERE step_execution_id = $1",
      [s.id]
    );
    for (const e of errors.rows) {
      console.log(`  Error: category=${e.category}, code=${e.code}, msg=${e.message}`);
      console.log(`  Details:`, JSON.stringify(e.details));
    }
  }

  process.exit(0);
}

main().catch(console.error);

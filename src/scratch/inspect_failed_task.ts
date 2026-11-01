import { db } from "../../src/db/client.js";

async function inspectFailedTask() {
  const taskId = "01a14fc4-ad07-7734-8254-dc71d22df16e";
  const attempts = await db.query(
    `SELECT a.attempt_number, a.status, p.slug as provider, m.slug as model, e.code, e.message
     FROM execution.execution_attempts a
     LEFT JOIN resources.resources r ON a.resource_id = r.id
     LEFT JOIN ai.providers p ON a.provider_id = p.id
     LEFT JOIN ai.models m ON a.model_id = m.id
     LEFT JOIN execution.execution_errors e ON a.error_id = e.id
     WHERE a.step_execution_id IN (
       SELECT id FROM execution.step_executions WHERE task_id = $1
     )
     ORDER BY a.started_at ASC`,
    [taskId]
  );
  console.log("ATTEMPTS:", attempts.rows);

  const steps = await db.query(
    `SELECT id, status, quality_score FROM execution.step_executions WHERE task_id = $1`,
    [taskId]
  );
  console.log("STEPS:", steps.rows);

  await db.close();
}

inspectFailedTask();

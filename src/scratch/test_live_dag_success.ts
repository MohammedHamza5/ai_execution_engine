import { dagService } from "../engine/dagService.js";
import { ExecutionWorker } from "../engine/worker.js";
import { generateUUIDv7 } from "../domain/common/id.js";
import { db } from "../db/client.js";

async function main() {
  console.log("Submitting test DAG task: 'هل الاهرامات حقيقة'...");

  const prompt = "هل الاهرامات حقيقة";
  const result = await dagService.createDAGTask({
    tenantId: "01924b00-0000-7000-8000-000000000000",
    taskType: "dag_workflow",
    initialPayload: { prompt },
    steps: [
      {
        stepKey: "research_step",
        name: "1. Core Research",
        stepType: "model_inference",
        dependencies: [],
        inputPayload: { prompt: `Research and outline core concepts for: "${prompt}"` },
      },
      {
        stepKey: "analysis_a",
        name: "2a. Technical Analysis",
        stepType: "model_inference",
        dependencies: ["research_step"],
        inputPayload: { prompt: `Analyze technical architecture & trade-offs for: "${prompt}"` },
      },
      {
        stepKey: "analysis_b",
        name: "2b. Reliability Analysis",
        stepType: "model_inference",
        dependencies: ["research_step"],
        inputPayload: { prompt: `Analyze failure recovery & checkpoints for: "${prompt}"` },
      },
      {
        stepKey: "synthesis_join",
        name: "3. Synthesis Join",
        stepType: "model_inference",
        dependencies: ["analysis_a", "analysis_b"],
        inputPayload: { prompt: `Synthesize a comprehensive, executive answer for: "${prompt}"` },
      },
    ],
    requirements: { allowPaid: false, requiredCapabilities: ["text"] },
    policy: { allowPaid: false, maxAttemptsPerStep: 3 },
    priority: 10,
  });

  console.log(`Task created: ${result.taskId}`);
  console.log(`Steps to execute: ${result.steps.length}`);

  const worker = new ExecutionWorker(generateUUIDv7());

  // Execute steps until complete
  let maxCycles = 10;
  while (maxCycles-- > 0) {
    const executed = await worker.claimAndExecuteNext();
    if (!executed) {
      console.log("No more executable steps currently in queue.");
      break;
    }
  }

  // Check final status
  const task = await db.query("SELECT * FROM tasks.tasks WHERE id = $1", [result.taskId]);
  console.log(`\nFinal Task Status: ${task.rows[0].status}`);

  const steps = await db.query(
    `SELECT ps.step_key, se.status, se.latency_ms, p.slug as provider, m.slug as model
     FROM execution.step_executions se
     JOIN planning.plan_steps ps ON se.plan_step_id = ps.id
     LEFT JOIN resources.resources r ON se.resource_id = r.id
     LEFT JOIN ai.providers p ON r.provider_id = p.id
     LEFT JOIN ai.models m ON r.model_id = m.id
     WHERE se.task_id = $1
     ORDER BY ps.order_index ASC`,
    [result.taskId]
  );
  console.table(steps.rows);

  if (task.rows[0].output_artifact_id) {
    const art = await db.query("SELECT * FROM artifacts.artifacts WHERE id = $1", [task.rows[0].output_artifact_id]);
    console.log("\nFINAL SYNTHESIZED ARTIFACT CONTENT:");
    console.log(art.rows[0].inline_content);
  }

  process.exit(0);
}

main().catch(console.error);

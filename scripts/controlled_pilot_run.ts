import dns from "node:dns";
import net from "node:net";
net.setDefaultAutoSelectFamily(false);
dns.setDefaultResultOrder("ipv4first");

import dotenv from "dotenv";
dotenv.config();

import { db } from "../src/db/client.js";
import { ExecutionWorker } from "../src/engine/worker.js";
import { executionEngine } from "../src/engine/executionEngine.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";
import { seedLiveProviders } from "../src/resources/liveResourceSeeder.js";
import { GeminiProviderAdapter } from "../src/adapters/geminiAdapter.js";
import { ProviderErrorCode } from "../src/adapters/types.js";
import { EligibilityEngine } from "../src/engine/eligibilityEngine.js";
import { ResourceDecisionEngine } from "../src/engine/resourceDecisionEngine.js";
import { NormalizedResourceCandidate } from "../src/domain/resource/stateTypes.js";

interface PilotTestResult {
  step: string;
  name: string;
  passed: boolean;
  evidence: string;
  details?: Record<string, unknown>;
}

const pilotResults: PilotTestResult[] = [];

async function runControlledPilot() {
  console.log("===============================================================================");
  console.log("AI-Execution-Engine: Controlled Pilot Run & Operational Verification");
  console.log("===============================================================================");

  await seedLiveProviders();
  const tenantId = "01924b00-0000-7000-8000-000000000000";

  // --------------------------------------------------------------------------
  // Pilot Test 1: Simple Live Text Task on Provider 1 (Groq Qwen 27B)
  // --------------------------------------------------------------------------
  console.log("\n[Pilot Test 1] Live Execution on Provider 1 (Groq Qwen 27B)...");
  try {
    const taskId1 = generateUUIDv7();
    const planId1 = generateUUIDv7();
    const executionId1 = generateUUIDv7();
    const planStepId1 = generateUUIDv7();
    const stepId1 = generateUUIDv7();
    const groqResId = "01924b00-0000-7000-8021-000000000002"; // Slot 2 (qwen/qwen3.8-27b)

    await db.query(
      `INSERT INTO tasks.tasks (id, tenant_id, task_type, input_payload, status, policy)
       VALUES ($1, $2, 'text_generation', $3, 'running', '{"allowPaid": false}');`,
      [taskId1, tenantId, JSON.stringify({ prompt: "Reply with the single word PILOT_GROQ_OK" })]
    );
    await db.query(`INSERT INTO planning.execution_plans (id, task_id, strategy) VALUES ($1, $2, 'single_model');`, [planId1, taskId1]);
    await db.query(`INSERT INTO execution.executions (id, task_id, plan_id) VALUES ($1, $2, $3);`, [executionId1, taskId1, planId1]);
    await db.query(`INSERT INTO planning.plan_steps (id, plan_id, step_key, name, step_type, order_index) VALUES ($1, $2, 'step_1', 'Inference', 'model_inference', 1);`, [planStepId1, planId1]);
    await db.query(
      `INSERT INTO execution.step_executions (id, execution_id, plan_step_id, task_id, resource_id, status, priority, available_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', 10, now());`,
      [stepId1, executionId1, planStepId1, taskId1, groqResId]
    );

    const worker1 = new ExecutionWorker();
    const ok1 = await worker1.claimAndExecuteNext(stepId1);

    const stepRow1 = await db.query(`SELECT status, output_tokens, latency_ms FROM execution.step_executions WHERE id = $1;`, [stepId1]);
    const artRow1 = await db.query(`SELECT id, inline_content FROM artifacts.artifacts WHERE task_id = $1;`, [taskId1]);

    const isSuccess1 = ok1 && stepRow1.rows[0]?.status === "completed" && artRow1.rows.length > 0;
    pilotResults.push({
      step: "1",
      name: "Simple Text Task on Provider 1 (Groq)",
      passed: isSuccess1,
      evidence: `Status: ${stepRow1.rows[0]?.status}, OutputTokens: ${stepRow1.rows[0]?.output_tokens}, Latency: ${stepRow1.rows[0]?.latency_ms}ms, ArtifactId: ${artRow1.rows[0]?.id}`,
      details: { content: artRow1.rows[0]?.inline_content?.slice(0, 50) },
    });
    console.log(`  Result: ${isSuccess1 ? "✅ PASSED" : "❌ FAILED"}`);
  } catch (err: any) {
    pilotResults.push({ step: "1", name: "Simple Text Task on Provider 1 (Groq)", passed: false, evidence: err.message });
    console.log(`  Result: ❌ EXCEPTION - ${err.message}`);
  }

  // --------------------------------------------------------------------------
  // Pilot Test 2: Simple Live Text Task on Provider 2 (Cloudflare Workers AI)
  // --------------------------------------------------------------------------
  console.log("\n[Pilot Test 2] Live Execution on Provider 2 (Cloudflare Workers AI)...");
  try {
    const taskId2 = generateUUIDv7();
    const planId2 = generateUUIDv7();
    const executionId2 = generateUUIDv7();
    const planStepId2 = generateUUIDv7();
    const stepId2 = generateUUIDv7();
    const cfResId = "01924b00-0000-7000-8000-000000000024"; // Slot 1 (@cf/meta/llama-3.1-8b-instruct)

    await db.query(
      `INSERT INTO tasks.tasks (id, tenant_id, task_type, input_payload, status, policy)
       VALUES ($1, $2, 'text_generation', $3, 'running', '{"allowPaid": false}');`,
      [taskId2, tenantId, JSON.stringify({ prompt: "Reply with the single word PILOT_CF_OK" })]
    );
    await db.query(`INSERT INTO planning.execution_plans (id, task_id, strategy) VALUES ($1, $2, 'single_model');`, [planId2, taskId2]);
    await db.query(`INSERT INTO execution.executions (id, task_id, plan_id) VALUES ($1, $2, $3);`, [executionId2, taskId2, planId2]);
    await db.query(`INSERT INTO planning.plan_steps (id, plan_id, step_key, name, step_type, order_index) VALUES ($1, $2, 'step_1', 'Inference', 'model_inference', 1);`, [planStepId2, planId2]);
    await db.query(
      `INSERT INTO execution.step_executions (id, execution_id, plan_step_id, task_id, resource_id, status, priority, available_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', 10, now());`,
      [stepId2, executionId2, planStepId2, taskId2, cfResId]
    );

    const worker2 = new ExecutionWorker();
    const ok2 = await worker2.claimAndExecuteNext(stepId2);

    const stepRow2 = await db.query(`SELECT status, output_tokens, latency_ms FROM execution.step_executions WHERE id = $1;`, [stepId2]);
    const artRow2 = await db.query(`SELECT id, inline_content FROM artifacts.artifacts WHERE task_id = $1;`, [taskId2]);

    const isSuccess2 = ok2 && stepRow2.rows[0]?.status === "completed" && artRow2.rows.length > 0;
    pilotResults.push({
      step: "2",
      name: "Simple Text Task on Provider 2 (Cloudflare)",
      passed: isSuccess2,
      evidence: `Status: ${stepRow2.rows[0]?.status}, OutputTokens: ${stepRow2.rows[0]?.output_tokens}, Latency: ${stepRow2.rows[0]?.latency_ms}ms, ArtifactId: ${artRow2.rows[0]?.id}`,
      details: { content: artRow2.rows[0]?.inline_content?.slice(0, 50) },
    });
    console.log(`  Result: ${isSuccess2 ? "✅ PASSED" : "❌ FAILED"}`);
  } catch (err: any) {
    pilotResults.push({ step: "2", name: "Simple Text Task on Provider 2 (Cloudflare)", passed: false, evidence: err.message });
    console.log(`  Result: ❌ EXCEPTION - ${err.message}`);
  }

  // --------------------------------------------------------------------------
  // Pilot Test 3: Simulated Primary Failure -> Migration & Fallback Recovery
  // --------------------------------------------------------------------------
  console.log("\n[Pilot Test 3] Simulated Primary Failure -> Migration & Fallback...");
  try {
    const taskId3 = generateUUIDv7();
    const planId3 = generateUUIDv7();
    const executionId3 = generateUUIDv7();
    const planStepId3 = generateUUIDv7();
    const stepId3 = generateUUIDv7();
    const primaryGeminiId = "01924b00-0000-7000-8000-000000000004";

    await db.query(
      `INSERT INTO tasks.tasks (id, tenant_id, task_type, input_payload, status, policy)
       VALUES ($1, $2, 'text_generation', $3, 'running', '{"allowPaid": false}');`,
      [taskId3, tenantId, JSON.stringify({ prompt: "Testing failover recovery" })]
    );
    await db.query(`INSERT INTO planning.execution_plans (id, task_id, strategy) VALUES ($1, $2, 'single_model');`, [planId3, taskId3]);
    await db.query(`INSERT INTO execution.executions (id, task_id, plan_id) VALUES ($1, $2, $3);`, [executionId3, taskId3, planId3]);
    await db.query(`INSERT INTO planning.plan_steps (id, plan_id, step_key, name, step_type, order_index) VALUES ($1, $2, 'step_1', 'Inference', 'model_inference', 1);`, [planStepId3, planId3]);
    await db.query(
      `INSERT INTO execution.step_executions (id, execution_id, plan_step_id, task_id, resource_id, status, priority, available_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', 10, now());`,
      [stepId3, executionId3, planStepId3, taskId3, primaryGeminiId]
    );

    // Inject simulated fault on Gemini Adapter to trigger migration without burning real quota
    const geminiMock = new GeminiProviderAdapter();
    geminiMock.setFaultSequence([ProviderErrorCode.QUOTA_EXHAUSTED]);

    const worker3 = new ExecutionWorker(generateUUIDv7(), geminiMock);
    const ok3 = await worker3.claimAndExecuteNext(stepId3);

    const stepRow3 = await db.query(`SELECT status, resource_id FROM execution.step_executions WHERE id = $1;`, [stepId3]);
    const attempts3 = await db.query(
      `SELECT attempt_number, status, resource_id FROM execution.execution_attempts WHERE step_execution_id = $1 ORDER BY attempt_number ASC;`,
      [stepId3]
    );

    const isSuccess3 =
      ok3 &&
      stepRow3.rows[0]?.status === "completed" &&
      attempts3.rows.length === 2 &&
      attempts3.rows[0]?.status === "failed" &&
      attempts3.rows[1]?.status === "success" &&
      attempts3.rows[1]?.resource_id !== primaryGeminiId;

    pilotResults.push({
      step: "3",
      name: "Simulated Primary Failure & Dynamic Resource Migration",
      passed: isSuccess3,
      evidence: `StepStatus: ${stepRow3.rows[0]?.status}, Attempts: ${attempts3.rows.length}, Attempt1: ${attempts3.rows[0]?.status}, Attempt2: ${attempts3.rows[1]?.status}, MigratedTo: ${attempts3.rows[1]?.resource_id}`,
    });
    console.log(`  Result: ${isSuccess3 ? "✅ PASSED" : "❌ FAILED"}`);
  } catch (err: any) {
    pilotResults.push({ step: "3", name: "Simulated Primary Failure & Dynamic Resource Migration", passed: false, evidence: err.message });
    console.log(`  Result: ❌ EXCEPTION - ${err.message}`);
  }

  // --------------------------------------------------------------------------
  // Pilot Test 4: Validation Failure Rejection (Never Falsely Succeeds)
  // --------------------------------------------------------------------------
  console.log("\n[Pilot Test 4] Deterministic Validation Failure Barrier...");
  try {
    const taskId4 = generateUUIDv7();
    const planId4 = generateUUIDv7();
    const executionId4 = generateUUIDv7();
    const planStepId4 = generateUUIDv7();
    const stepId4 = generateUUIDv7();
    const groqResId = "01924b00-0000-7000-8021-000000000002";

    // Strict format expecting valid JSON
    await db.query(
      `INSERT INTO tasks.tasks (id, tenant_id, task_type, input_payload, status, policy)
       VALUES ($1, $2, 'json_extraction', $3, 'running', '{"allowPaid": false}');`,
      [taskId4, tenantId, JSON.stringify({ prompt: "Format test", expectJson: true })]
    );
    await db.query(`INSERT INTO planning.execution_plans (id, task_id, strategy) VALUES ($1, $2, 'single_model');`, [planId4, taskId4]);
    await db.query(`INSERT INTO execution.executions (id, task_id, plan_id) VALUES ($1, $2, $3);`, [executionId4, taskId4, planId4]);
    await db.query(`INSERT INTO planning.plan_steps (id, plan_id, step_key, name, step_type, order_index) VALUES ($1, $2, 'step_1', 'Inference', 'model_inference', 1);`, [planStepId4, planId4]);
    await db.query(
      `INSERT INTO execution.step_executions (id, execution_id, plan_step_id, task_id, resource_id, status, priority, available_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', 10, now());`,
      [stepId4, executionId4, planStepId4, taskId4, groqResId]
    );

    // Mock response with invalid, non-JSON plain text violating expectation
    const failingMock = new GeminiProviderAdapter();
    failingMock.setResponseSequence(["Error: Malformed text that is strictly non-JSON"]);

    const worker4 = new ExecutionWorker(generateUUIDv7(), failingMock);
    const processed4 = await worker4.claimAndExecuteNext(stepId4);

    const attempts4 = await db.query(
      `SELECT attempt_number, status, error_id FROM execution.execution_attempts WHERE step_execution_id = $1 ORDER BY attempt_number ASC;`,
      [stepId4]
    );

    const isSuccess4 =
      attempts4.rows.length >= 1 &&
      attempts4.rows[0]?.status === "failed";

    pilotResults.push({
      step: "4",
      name: "Deterministic Validation Rejection & Error Persistence",
      passed: isSuccess4,
      evidence: `Attempt 1 Status: ${attempts4.rows[0]?.status}, ErrorId: ${attempts4.rows[0]?.error_id}, Rejection Enforced`,
    });
    console.log(`  Result: ${isSuccess4 ? "✅ PASSED" : "❌ FAILED"}`);
  } catch (err: any) {
    pilotResults.push({ step: "4", name: "Deterministic Validation Rejection & Error Persistence", passed: false, evidence: err.message });
    console.log(`  Result: ❌ EXCEPTION - ${err.message}`);
  }

  // --------------------------------------------------------------------------
  // Pilot Test 5: Zero Silent Paid Spend Enforcement (ADR-072)
  // --------------------------------------------------------------------------
  console.log("\n[Pilot Test 5] Zero Silent Paid Spend Enforcement (ADR-072)...");
  try {
    const paidCandidate: NormalizedResourceCandidate = {
      resourceId: generateUUIDv7(),
      providerId: generateUUIDv7(),
      providerSlug: "openai",
      providerName: "OpenAI Paid Tier",
      modelId: generateUUIDv7(),
      modelSlug: "gpt-4o",
      modelName: "GPT-4o Commercial",
      credentialId: generateUUIDv7(),
      billingClass: "PAID",
      isPaid: true,
      capabilities: ["TEXT_GENERATION", "JSON", "CODE"],
      health: "HEALTHY",
      status: "active",
      quotas: [],
      rateLimit: { isRateLimited: false },
      priority: 100,
      observedAt: new Date(),
      confidence: 1.0,
    };

    // Test Eligibility Engine with allowPaid = false
    const eligibility = EligibilityEngine.filter([paidCandidate], {
      policy: { allowPaid: false },
      requirements: { allowPaid: false },
    });

    // Test Resource Decision Engine with allowPaid = false
    const decision = ResourceDecisionEngine.evaluate([paidCandidate], {
      policy: { allowPaid: false },
      requirements: { allowPaid: false },
    });

    const isExcluded = eligibility.eligible.length === 0 && eligibility.excluded[0]?.rejectionReason === "PAID_UNAUTHORIZED";
    const isApprovalRequired = decision.decisionType === "REQUEST_APPROVAL" || decision.decisionType === "FAIL";

    const isSuccess5 = isExcluded && isApprovalRequired;
    pilotResults.push({
      step: "5",
      name: "Zero Silent Paid Spend Enforcement (allowPaid: false)",
      passed: isSuccess5,
      evidence: `Eligible: ${eligibility.eligible.length}, ExcludedReason: ${eligibility.excluded[0]?.rejectionReason}, DecisionType: ${decision.decisionType}, Zero Spend Verified`,
    });
    console.log(`  Result: ${isSuccess5 ? "✅ PASSED" : "❌ FAILED"}`);
  } catch (err: any) {
    pilotResults.push({ step: "5", name: "Zero Silent Paid Spend Enforcement (allowPaid: false)", passed: false, evidence: err.message });
    console.log(`  Result: ❌ EXCEPTION - ${err.message}`);
  }

  console.log("\n===============================================================================");
  console.log("CONTROLLED PILOT EXECUTION SUMMARY:");
  console.table(pilotResults);
  console.log("===============================================================================");

  await db.close();
}

runControlledPilot().catch((err) => {
  console.error("Fatal pilot error:", err);
  process.exit(1);
});

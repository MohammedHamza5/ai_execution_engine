import { describe, it, expect, beforeAll } from "vitest";
import { db } from "../src/db/client.js";
import { executionEngine } from "../src/engine/executionEngine.js";
import { collaborationService } from "../src/engine/collaborationService.js";
import { claimEvidenceService } from "../src/engine/claimEvidenceService.js";
import { disputeArbitrationEngine, DisputeArbitrationEngine } from "../src/engine/disputeArbitrationEngine.js";
import { synthesisEngine, SynthesisEngine } from "../src/engine/synthesisEngine.js";
import { resourceIntelligence, SelectedResource } from "../src/resources/resourceIntelligence.js";
import { GeminiProviderAdapter } from "../src/adapters/geminiAdapter.js";
import { ensureDefaultTenant } from "../src/api/routes/tasks.js";
import { generateUUIDv7 } from "../src/domain/common/id.js";

describe("M3 Batch C — Disagreement Handling, Claims & Synthesis Engine", () => {
  let tenantId: string;
  let baseResourceId: string;
  let baseResource: SelectedResource;

  beforeAll(async () => {
    tenantId = await ensureDefaultTenant();
    baseResourceId = await resourceIntelligence.ensureBaseResource();
    const resolved = await resourceIntelligence.getResourceById(baseResourceId);
    if (!resolved) throw new Error("Base resource could not be resolved");
    baseResource = resolved;
  });

  describe("Task M3.7: Relational Claim & Evidence Model", () => {
    it("persists claims, attaches evidence, and calculates grounding precision", async () => {
      const taskId = generateUUIDv7();
      const artifactId = generateUUIDv7();

      // Create dummy task & artifact
      await db.query(
        `INSERT INTO tasks.tasks (id, tenant_id, task_type, input_payload) VALUES ($1, $2, 'research', '{}');`,
        [taskId, tenantId]
      );
      await db.query(
        `INSERT INTO artifacts.artifacts (
          id, tenant_id, task_id, type, storage_uri, inline_content, content_hash, size_bytes, status
        ) VALUES ($1, $2, $3, 'text_output', 'artifact://claim/test', 'Research paper text', 'hash_claim', 19, 'active');`,
        [artifactId, tenantId, taskId]
      );

      // Record 3 claims
      const c1 = await claimEvidenceService.recordClaim({
        taskId,
        artifactId,
        claimText: "PostgreSQL supports SKIP LOCKED for concurrent queue claiming.",
        claimType: "technical_fact",
        confidence: 0.99,
      });

      const c2 = await claimEvidenceService.recordClaim({
        taskId,
        artifactId,
        claimText: "UUIDv7 is monotonic and time-ordered.",
        claimType: "technical_fact",
        confidence: 0.98,
      });

      const c3 = await claimEvidenceService.recordClaim({
        taskId,
        artifactId,
        claimText: "The moon is made of green cheese.",
        claimType: "hallucination",
        confidence: 0.50,
      });

      expect(c1.status).toBe("unverified");
      expect(c2.status).toBe("unverified");
      expect(c3.status).toBe("unverified");

      // Attach evidence to c1 and c2
      await claimEvidenceService.recordEvidence({
        claimId: c1.id,
        evidenceType: "documentation_reference",
        sourceUri: "https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE",
        excerptRef: "FOR UPDATE SKIP LOCKED",
      });

      await claimEvidenceService.recordEvidence({
        claimId: c2.id,
        evidenceType: "specification_reference",
        sourceUri: "https://www.rfc-editor.org/rfc/rfc9562",
        excerptRef: "UUIDv7 subclause 5.7",
      });

      // Fetch claims and assert verification
      const claims = await claimEvidenceService.getClaimsByArtifact(artifactId);
      expect(claims).toHaveLength(3);

      const verifiedClaims = claims.filter((c) => c.status === "verified");
      expect(verifiedClaims).toHaveLength(2);
      expect(verifiedClaims.map((c) => c.claimText)).toContain(
        "PostgreSQL supports SKIP LOCKED for concurrent queue claiming."
      );

      // Calculate Grounding Precision
      const precisionResult = await claimEvidenceService.computeGroundingPrecision(artifactId);
      expect(precisionResult.totalClaims).toBe(3);
      expect(precisionResult.verifiedClaims).toBe(2);
      expect(precisionResult.precision).toBeCloseTo(2 / 3, 2);
    });
  });

  describe("Task M3.8: Dispute Arbitration & Disagreement Engine", () => {
    it("ADR-100 & ADR-099: Rejection of Majority Voting — deterministic proof overrides 3-model majority consensus", async () => {
      const arbitration = DisputeArbitrationEngine.arbitrate([
        {
          branchKey: "consensus_group",
          claimText: "The function has asymptotic complexity O(1)",
          deterministicScore: 0.0,
          evidenceScore: 0.0,
          supporterCount: 3, // 3 models falsely agreed
          confidence: 0.95,
        },
        {
          branchKey: "independent_formal_checker",
          claimText: "The function has nested loops, proven asymptotic complexity O(N^2)",
          deterministicScore: 1.0, // Formally verified by AST parser & profiler
          evidenceScore: 0.8,
          supporterCount: 1, // Single minority model
          confidence: 0.99,
        },
      ]);

      // Assert that formal deterministic verification wins unconditionally over majority consensus
      expect(arbitration.status).toBe("resolved");
      expect(arbitration.resolvedBy).toBe("deterministic");
      expect(arbitration.winningPosition?.branchKey).toBe("independent_formal_checker");
      expect(arbitration.rationale).toContain("rejecting majority consensus");
    });

    it("persists dispute record and dispute positions with outbox event", async () => {
      const taskId = generateUUIDv7();
      await db.query(
        `INSERT INTO tasks.tasks (id, tenant_id, task_type, input_payload) VALUES ($1, $2, 'code_audit', '{}');`,
        [taskId, tenantId]
      );

      const disputeRecord = await disputeArbitrationEngine.createAndArbitrateDispute({
        taskId,
        subjectType: "algorithm_complexity",
        positions: [
          {
            branchKey: "model_1",
            claimText: "Bubble sort average case is O(N log N)",
            deterministicScore: 0.0,
            evidenceScore: 0.1,
          },
          {
            branchKey: "model_2",
            claimText: "Bubble sort average case is O(N^2)",
            deterministicScore: 1.0,
            evidenceScore: 0.9,
          },
        ],
      });

      expect(disputeRecord.id).toBeDefined();
      expect(disputeRecord.status).toBe("resolved");
      expect(disputeRecord.winningBranchKey).toBe("model_2");
      expect(disputeRecord.positions).toHaveLength(2);

      const winningPosition = disputeRecord.positions.find((p) => p.isWinner);
      expect(winningPosition?.branchKey).toBe("model_2");

      // Verify Outbox Event
      const outboxRes = await db.query(
        `SELECT * FROM system.outbox_events WHERE aggregate_id = $1 AND event_type = 'DISPUTE_RESOLVED';`,
        [disputeRecord.id]
      );
      expect(outboxRes.rows).toHaveLength(1);
    });
  });

  describe("Task M3.9 & M3.10: Untrusted Synthesis Engine & Recovery Choreography", () => {
    it("happy path: synthesized artifact passes sovereign validation, completing collaboration run", async () => {
      const taskResult = await executionEngine.createCollaborationTask({
        tenantId,
        taskType: "synthesis_happy_path",
        objective: "Synthesize consensus architectural summary",
        strategy: "parallel_specialist",
        completionPolicy: { type: "ALL_REQUIRED" },
        branches: [
          { branchKey: "b1", role: "specialist", resourceId: baseResourceId },
        ],
      });

      const runId = taskResult.collaborationRunId;
      await collaborationService.transitionState(runId, "PLANNED");
      await collaborationService.transitionState(runId, "DISPATCHING");
      await collaborationService.transitionState(runId, "RUNNING");

      // Complete branch 1 with an artifact
      const b1ArtifactId = generateUUIDv7();
      await db.query(
        `INSERT INTO artifacts.artifacts (
          id, tenant_id, task_id, type, storage_uri, inline_content, content_hash, size_bytes, status
        ) VALUES ($1, $2, $3, 'text_output', 'artifact://b1', 'Microservices analysis: high decoupling, higher network latency.', 'h_b1', 65, 'active');`,
        [b1ArtifactId, tenantId, taskResult.taskId]
      );

      const branches = await collaborationService.getCollaborationBranches(runId);
      await collaborationService.recordBranchResult({
        branchId: branches[0].id,
        status: "completed",
        outputArtifactId: b1ArtifactId,
      });

      await collaborationService.transitionState(runId, "COLLECTING");

      // Execute synthesis with an adapter that produces valid JSON output
      const adapterHappy = new GeminiProviderAdapter();
      adapterHappy.setResponseSequence([
        JSON.stringify({
          architecture: "Microservices",
          recommendation: "Adopt with strict network telemetry",
        }),
      ]);
      synthesisEngine.setAdapter(adapterHappy);

      const synthResult = await synthesisEngine.synthesizeAndValidate({
        runId,
        taskId: taskResult.taskId,
        tenantId,
        objective: "Synthesize findings",
        synthesizerResource: baseResource,
        expectedOutputJson: true,
      });

      expect(synthResult.success).toBe(true);
      expect(synthResult.validationPassed).toBe(true);
      expect(synthResult.artifactId).toBeDefined();

      // Verify collaboration run reached terminal state COMPLETED
      const finalRun = await collaborationService.getCollaborationRun(runId);
      expect(finalRun?.state).toBe("COMPLETED");
      expect(finalRun?.resultArtifactId).toBe(synthResult.artifactId);

      // Verify parent task reached completed
      const finalTask = await executionEngine.getTask(taskResult.taskId);
      expect(finalTask?.status).toBe("completed");
    });

    it("Rule E-007 & ADR-097: invalid synthesis output is REJECTED by sovereign validation barrier and triggers RECOVERING", async () => {
      const taskResult = await executionEngine.createCollaborationTask({
        tenantId,
        taskType: "synthesis_invalid_output",
        objective: "Synthesize findings into strict JSON",
        strategy: "parallel_specialist",
        completionPolicy: { type: "ALL_REQUIRED" },
        branches: [
          { branchKey: "b1", role: "specialist", resourceId: baseResourceId },
        ],
      });

      const runId = taskResult.collaborationRunId;
      await collaborationService.transitionState(runId, "PLANNED");
      await collaborationService.transitionState(runId, "DISPATCHING");
      await collaborationService.transitionState(runId, "RUNNING");

      // Complete branch 1
      const b1ArtifactId = generateUUIDv7();
      await db.query(
        `INSERT INTO artifacts.artifacts (
          id, tenant_id, task_id, type, storage_uri, inline_content, content_hash, size_bytes, status
        ) VALUES ($1, $2, $3, 'text_output', 'artifact://b1_inv', 'Source data', 'h_inv', 11, 'active');`,
        [b1ArtifactId, tenantId, taskResult.taskId]
      );
      const branches = await collaborationService.getCollaborationBranches(runId);
      await collaborationService.recordBranchResult({
        branchId: branches[0].id,
        status: "completed",
        outputArtifactId: b1ArtifactId,
      });
      await collaborationService.transitionState(runId, "COLLECTING");

      // Adapter returns malformed / non-JSON output when JSON was strictly required
      const adapterInvalid = new GeminiProviderAdapter();
      adapterInvalid.setResponseSequence([
        "I cannot provide JSON because I am a conversational model: Error 500",
      ]);
      synthesisEngine.setAdapter(adapterInvalid);

      const synthResult = await synthesisEngine.synthesizeAndValidate({
        runId,
        taskId: taskResult.taskId,
        tenantId,
        objective: "Synthesize into JSON",
        synthesizerResource: baseResource,
        expectedOutputJson: true, // Requires valid JSON
      });

      // Assert that invalid synthesis is strictly REJECTED
      expect(synthResult.success).toBe(false);
      expect(synthResult.validationPassed).toBe(false);
      expect(synthResult.recoveryDecision).toBeDefined();

      // Assert that collaboration run did NOT complete silently, but transitioned to RECOVERING
      const runAfterFail = await collaborationService.getCollaborationRun(runId);
      expect(runAfterFail?.state).toBe("RECOVERING");

      // Parent task is NOT completed
      const taskAfterFail = await executionEngine.getTask(taskResult.taskId);
      expect(taskAfterFail?.status).not.toBe("completed");
    });
  });
});

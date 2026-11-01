import { db } from "../db/client.js";
import { generateUUIDv7 } from "../domain/common/id.js";
import { computeContentHash } from "../domain/artifact/types.js";
import { ProviderAdapter, UnifiedRequest } from "../adapters/types.js";
import { GeminiProviderAdapter } from "../adapters/geminiAdapter.js";
import { SelectedResource } from "../resources/resourceIntelligence.js";
import { validationEngine } from "../validation/validationEngine.js";
import { ContextPackageBuilder } from "./contextPackageBuilder.js";
import { collaborationService } from "./collaborationService.js";
import { ValidationOutcomeNormalizer } from "./validationOutcome.js";
import { ValidationDiagnosisEngine } from "./validationDiagnosis.js";
import { RecoveryPolicy, RecoveryDecision } from "./recoveryPolicy.js";
import { config } from "../config/env.js";

export interface SynthesisRequest {
  readonly runId: string;
  readonly taskId: string;
  readonly tenantId: string;
  readonly objective: string;
  readonly synthesizerPrompt?: string;
  readonly synthesizerResource: SelectedResource;
  readonly expectedOutputJson?: boolean;
  readonly allowPaid?: boolean;
}

export interface SynthesisResult {
  readonly success: boolean;
  readonly artifactId: string;
  readonly validationPassed: boolean;
  readonly validationId: string;
  readonly qualityScore: number;
  readonly recoveryDecision?: RecoveryDecision;
}

export class SynthesisEngine {
  private adapter: ProviderAdapter;

  constructor(adapter?: ProviderAdapter) {
    this.adapter = adapter || new GeminiProviderAdapter();
  }

  public setAdapter(adapter: ProviderAdapter): void {
    this.adapter = adapter;
  }

  /**
   * Synthesizes outputs across collaboration branches and subjects the synthesized
   * artifact to sovereign, independent validation (ADR-097, Rule E-007).
   */
  public async synthesizeAndValidate(request: SynthesisRequest): Promise<SynthesisResult> {
    const run = await collaborationService.getCollaborationRun(request.runId);
    if (!run) {
      throw new Error(`COLLABORATION_RUN_NOT_FOUND: Run ${request.runId} does not exist`);
    }

    // 1. Transition FSM to SYNTHESIZING
    await collaborationService.transitionState(request.runId, "SYNTHESIZING");

    // 2. Assemble Context Package from verified completed source branches
    const contextPackage = await ContextPackageBuilder.buildPackage({
      runId: request.runId,
      targetBranchKey: "synthesis",
      targetRole: "synthesizer",
      objective: request.objective,
    });

    // 3. Dispatch synthesis request to provider OUTSIDE database transaction (ADR-024)
    const prompt = request.synthesizerPrompt
      ? `${request.synthesizerPrompt}\n\n${contextPackage.contextPayload}`
      : `Synthesize the findings from the source artifacts below into a unified result:\n\n${contextPackage.contextPayload}`;

    let secretKey = "simulated-test-key";
    if (request.synthesizerResource.credentialSecretRef?.startsWith("env:")) {
      const envVarName = request.synthesizerResource.credentialSecretRef.slice(4);
      secretKey = process.env[envVarName] || (config as any)[envVarName] || "simulated-test-key";
    } else if (request.synthesizerResource.credentialSecretRef) {
      secretKey = request.synthesizerResource.credentialSecretRef;
    }

    const unifiedRequest: UnifiedRequest = {
      requestId: generateUUIDv7(),
      taskId: request.taskId,
      stepId: generateUUIDv7(),
      attemptId: generateUUIDv7(),
      resourceId: request.synthesizerResource.resource.id,
      modelId: request.synthesizerResource.modelSlug,
      prompt,
    };

    const response = await this.adapter.execute(unifiedRequest, secretKey);

    // 4. Persist Synthesized Candidate Artifact (Untrusted candidate output)
    const artifactId = generateUUIDv7();
    const content = response.outputText;
    const contentHash = computeContentHash(content);

    await db.query(
      `INSERT INTO artifacts.artifacts (
        id, tenant_id, task_id, type, storage_uri, inline_content,
        content_hash, size_bytes, status
      ) VALUES ($1, $2, $3, 'text_output', $4, $5, $6, $7, 'active');`,
      [
        artifactId,
        request.tenantId,
        request.taskId,
        `artifact://${request.taskId}/synthesis.txt`,
        content,
        contentHash,
        Buffer.byteLength(content, "utf8"),
      ]
    );

    // 5. Transition FSM to VALIDATING
    await collaborationService.transitionState(request.runId, "VALIDATING", {
      synthesisArtifactId: artifactId,
    });

    // 6. Sovereign Validation Barrier (ADR-085, ADR-097)
    const validationId = generateUUIDv7();
    const decision = await validationEngine.validate(validationId, {
      artifactId,
      content,
      requiresJson: request.expectedOutputJson,
    });

    const isAccepted = decision.outcome === "ACCEPT";

    // 7. Persist Validation Record
    await db.query(
      `INSERT INTO validation.validations (
        id, task_id, target_type, target_id, validator_type, status, confidence, started_at, completed_at
      ) VALUES ($1, $2, 'artifact', $3, 'deterministic', $4, $5, now(), now());`,
      [
        validationId,
        request.taskId,
        artifactId,
        isAccepted ? "passed" : "failed",
        decision.confidence,
      ]
    );

    // 8. Outcome Branching
    if (isAccepted) {
      // Advance collaboration run to COMPLETED and complete parent task
      await collaborationService.completeCollaboration(
        request.runId,
        artifactId,
        decision.confidence
      );

      return {
        success: true,
        artifactId,
        validationPassed: true,
        validationId,
        qualityScore: decision.confidence,
      };
    }

    // Validation Failed: Synthesis output is untrusted and rejected!
    const normalized = ValidationOutcomeNormalizer.normalize(decision);
    const diagnosis = ValidationDiagnosisEngine.diagnose({
      validationId,
      artifactId,
      normalizedOutcome: normalized,
      attemptNumber: 1,
      maxAttempts: 3,
    });

    const recoveryDecision = RecoveryPolicy.evaluateValidation(diagnosis, {
      allowPaid: Boolean(request.allowPaid),
    });

    // Transition FSM to RECOVERING rather than completing
    await collaborationService.transitionState(request.runId, "RECOVERING");

    return {
      success: false,
      artifactId,
      validationPassed: false,
      validationId,
      qualityScore: decision.confidence,
      recoveryDecision,
    };
  }
}

export const synthesisEngine = new SynthesisEngine();

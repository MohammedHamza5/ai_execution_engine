import { db } from "../db/client.js";
import { generateUUIDv7, isValidUUID } from "../domain/common/id.js";
import { ProviderAdapter, UnifiedRequest } from "../adapters/types.js";
import { GeminiProviderAdapter } from "../adapters/geminiAdapter.js";
import { ProviderAdapterRegistry, providerAdapterRegistry } from "../adapters/adapterRegistry.js";
import { executionEngine } from "./executionEngine.js";
import { checkpointService } from "./checkpointService.js";
import { RecoveryPolicy } from "./recoveryPolicy.js";
import { ValidationOutcomeNormalizer } from "./validationOutcome.js";
import { ValidationDiagnosisEngine } from "./validationDiagnosis.js";
import { resourceIntelligence } from "../resources/resourceIntelligence.js";
import { config } from "../config/env.js";
import { DAGWorkerBridge } from "./dagWorkerBridge.js";

export class ExecutionWorker {
  public readonly workerId: string;
  private isRunning: boolean = false;
  private pollTimeout?: NodeJS.Timeout;
  private adapter: ProviderAdapter;
  private registry: ProviderAdapterRegistry;
  private customAdapters: Map<string, ProviderAdapter> = new Map();

  constructor(workerId?: string, adapter?: ProviderAdapter, registry?: ProviderAdapterRegistry) {
    this.workerId = workerId && isValidUUID(workerId) ? workerId : generateUUIDv7();
    this.adapter = adapter || new GeminiProviderAdapter();
    this.registry = registry || providerAdapterRegistry;
    if (adapter) {
      this.customAdapters.set(adapter.providerId.toLowerCase(), adapter);
    }
  }

  public getAdapter(providerSlug?: string): ProviderAdapter {
    return this.resolveAdapter(providerSlug);
  }

  public setAdapter(adapter: ProviderAdapter): void {
    this.adapter = adapter;
    this.customAdapters.set(adapter.providerId.toLowerCase(), adapter);
  }

  public resolveAdapter(providerSlug?: string): ProviderAdapter {
    if (providerSlug) {
      const slug = providerSlug.toLowerCase();
      if (this.customAdapters.has(slug)) {
        return this.customAdapters.get(slug)!;
      }
      const registered = this.registry.getAdapter(slug);
      if (registered) {
        return registered;
      }
    }
    return this.adapter;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    DAGWorkerBridge.startLeaseReaper();
    this.pollLoop();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
    }
    DAGWorkerBridge.stopLeaseReaper();
  }

  public static dispatchDAGBatch(executionId: string, maxConcurrency?: number) {
    return DAGWorkerBridge.dispatchParallelDAG(executionId, maxConcurrency);
  }

  public static startLeaseReaper(intervalMs?: number) {
    DAGWorkerBridge.startLeaseReaper(intervalMs);
  }

  public static stopLeaseReaper(force = false) {
    DAGWorkerBridge.stopLeaseReaper(force);
  }

  private async pollLoop(): Promise<void> {
    if (!this.isRunning) return;
    try {
      await this.claimAndExecuteNext();
    } catch (err) {
      console.error(`[Worker ${this.workerId}] Error in loop:`, err);
    }
    if (this.isRunning) {
      this.pollTimeout = setTimeout(() => this.pollLoop(), config.WORKER_POLL_INTERVAL_MS);
    }
  }

  /**
   * Executes a single claim-execute-recover cycle. Exposed for deterministic testing.
   */
  public async claimAndExecuteNext(targetStepId?: string): Promise<boolean> {
    const leaseToken = generateUUIDv7();
    const initialAttemptId = generateUUIDv7();

    // ------------------------------------------------------------------------
    // Phase 1: Claim Transaction (PostgreSQL SKIP LOCKED - ADR-094)
    // ------------------------------------------------------------------------
    const claimed = await db.transaction(async (client) => {
      const selectQuery = targetStepId
        ? `
          SELECT s.id, s.execution_id, s.plan_step_id, s.task_id, s.resource_id, s.fencing_token,
                 t.tenant_id, t.input_payload, t.requirements, t.policy, t.task_type,
                 p.step_key,
                 prov.slug AS provider_slug,
                 mod.slug AS model_slug,
                 cred.secret_reference
          FROM execution.step_executions s
          JOIN tasks.tasks t ON s.task_id = t.id
          JOIN planning.plan_steps p ON s.plan_step_id = p.id
          JOIN resources.resources r ON s.resource_id = r.id
          JOIN ai.providers prov ON r.provider_id = prov.id
          JOIN ai.models mod ON r.model_id = mod.id
          LEFT JOIN resources.credentials cred ON r.credential_id = cred.id
          WHERE s.id = $1 
            AND ((s.status = 'pending' AND s.available_at <= now())
                 OR (s.status = 'running' AND s.lease_expires_at <= now()))
          FOR UPDATE OF s SKIP LOCKED
          LIMIT 1;
        `
        : `
          SELECT s.id, s.execution_id, s.plan_step_id, s.task_id, s.resource_id, s.fencing_token,
                 t.tenant_id, t.input_payload, t.requirements, t.policy, t.task_type,
                 p.step_key,
                 prov.slug AS provider_slug,
                 mod.slug AS model_slug,
                 cred.secret_reference
          FROM execution.step_executions s
          JOIN tasks.tasks t ON s.task_id = t.id
          JOIN planning.plan_steps p ON s.plan_step_id = p.id
          JOIN resources.resources r ON s.resource_id = r.id
          JOIN ai.providers prov ON r.provider_id = prov.id
          JOIN ai.models mod ON r.model_id = mod.id
          LEFT JOIN resources.credentials cred ON r.credential_id = cred.id
          WHERE (s.status = 'pending' AND s.available_at <= now())
             OR (s.status = 'running' AND s.lease_expires_at <= now())
          ORDER BY s.priority DESC, s.available_at ASC
          FOR UPDATE OF s SKIP LOCKED
          LIMIT 1;
        `;

      const result = targetStepId
        ? await client.query(selectQuery, [targetStepId])
        : await client.query(selectQuery);
      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];

      // Update lease and monotonically increment fencing token
      const updateResult = await client.query(
        `UPDATE execution.step_executions
         SET status = 'running',
             worker_id = $1,
             lease_token = $2,
             lease_expires_at = now() + ($3 || ' seconds')::interval,
             fencing_token = fencing_token + 1,
             started_at = COALESCE(started_at, now()),
             updated_at = now()
         WHERE id = $4
         RETURNING fencing_token;`,
        [
          this.workerId,
          leaseToken,
          config.WORKER_LEASE_DURATION_SECONDS,
          row.id,
        ]
      );

      const assignedFencingToken = parseInt(updateResult.rows[0].fencing_token, 10);

      // Determine monotonic attempt number
      const attemptNumResult = await client.query(
        `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next_attempt_number
         FROM execution.execution_attempts
         WHERE step_execution_id = $1;`,
        [row.id]
      );
      const attemptNumber = parseInt(attemptNumResult.rows[0].next_attempt_number, 10);

      // Record transient attempt in execution_attempts
      await client.query(
        `INSERT INTO execution.execution_attempts (
          id, step_execution_id, attempt_number, resource_id, status, started_at
        ) VALUES ($1, $2, $3, $4, 'running', now());`,
        [initialAttemptId, row.id, attemptNumber, row.resource_id]
      );

      return {
        stepExecutionId: row.id,
        stepKey: row.step_key,
        executionId: row.execution_id,
        taskId: row.task_id,
        taskType: row.task_type,
        tenantId: row.tenant_id,
        resourceId: row.resource_id,
        providerSlug: row.provider_slug,
        modelSlug: row.model_slug,
        secretReference: row.secret_reference,
        inputPayload: row.input_payload,
        requirements: row.requirements,
        policy: row.policy,
        fencingToken: assignedFencingToken,
        attemptNumber,
      };
    });

    if (!claimed) {
      return false;
    }

    // ------------------------------------------------------------------------
    // Multi-Attempt Execution Loop (Preserves Logical Task & Execution Identity)
    // ------------------------------------------------------------------------
    let currentResourceId = claimed.resourceId;
    let currentProviderSlug = claimed.providerSlug;
    let currentModelSlug = claimed.modelSlug;
    let currentSecretReference = claimed.secretReference;
    let currentAttemptId = initialAttemptId;
    let currentAttemptNumber = claimed.attemptNumber;
    let currentFencingToken = claimed.fencingToken;
    const excludedResourceIds: string[] = [currentResourceId];
    const maxRetries = 3;

    while (currentAttemptNumber <= maxRetries) {
      try {
        const branchConfig =
          (claimed.inputPayload as any)?.branches?.[claimed.stepKey] ||
          (claimed.inputPayload as any)?.steps?.[claimed.stepKey];

        const prompt =
          typeof branchConfig?.prompt === "string" && branchConfig.prompt.trim().length > 0
            ? branchConfig.prompt
            : typeof (claimed.inputPayload as any)?.prompt === "string" && (claimed.inputPayload as any).prompt.trim().length > 0
            ? (claimed.inputPayload as any).prompt
            : typeof (claimed.inputPayload as any)?.initialPayload?.prompt === "string"
            ? (claimed.inputPayload as any).initialPayload.prompt
            : JSON.stringify(claimed.inputPayload);

        const shouldSimulateFault =
          (claimed.inputPayload as any)?.failAttempts
            ? currentAttemptNumber <= Number((claimed.inputPayload as any).failAttempts)
            : true;

        const simulationFault = shouldSimulateFault
          ? branchConfig?.simulationFault || (claimed.inputPayload as any)?.simulationFault
          : undefined;

        const branchParams = branchConfig?.parameters || claimed.inputPayload?.parameters;

        let secretKey = "simulated-test-key";
        if (currentSecretReference && currentSecretReference.startsWith("env:")) {
          const envVarName = currentSecretReference.slice(4);
          secretKey =
            process.env[envVarName] ||
            (config as any)[envVarName] ||
            process.env[envVarName.replace(/_\d+$/, "")] ||
            "simulated-test-key";
        } else if (currentSecretReference) {
          secretKey = currentSecretReference;
        }

        const unifiedRequest: UnifiedRequest = {
          requestId: generateUUIDv7(),
          taskId: claimed.taskId,
          stepId: claimed.stepExecutionId,
          attemptId: currentAttemptId,
          resourceId: currentResourceId,
          modelId: currentModelSlug,
          prompt,
          parameters: branchParams || (simulationFault ? { simulationFault } : undefined),
        };

        // ----------------------------------------------------------------------
        // Phase 2: External Provider Execution OUTSIDE DB Transaction (ADR-024)
        // ----------------------------------------------------------------------
        const effectiveAdapter = this.resolveAdapter(currentProviderSlug);
        const response = await effectiveAdapter.execute(unifiedRequest, secretKey);

        // ----------------------------------------------------------------------
        // Phase 3: Completion & Validation Barrier (Fenced DB Transaction)
        // ----------------------------------------------------------------------
        const commitResult = await executionEngine.commitAttemptSuccess({
          stepExecutionId: claimed.stepExecutionId,
          executionId: claimed.executionId,
          taskId: claimed.taskId,
          tenantId: claimed.tenantId,
          attemptId: currentAttemptId,
          fencingToken: currentFencingToken,
          response,
          expectedOutputJson: Boolean(branchConfig?.expectJson ?? claimed.inputPayload?.expectJson),
        });

        // If validation passed, execution attempt succeeded completely
        if (commitResult.validationPassed) {
          try {
            await resourceIntelligence.recordExecutionSuccess(currentResourceId, response.latencyMs);
          } catch (telemetryErr: any) {
            console.warn(`[Worker ${this.workerId}] Failed to record resource success telemetry:`, telemetryErr);
          }
          return true;
        }

        // ----------------------------------------------------------------------
        // Phase 3b: Validation Rejected -> Outcome Normalization & Diagnosis (M2)
        // ----------------------------------------------------------------------
        const normalized = ValidationOutcomeNormalizer.normalize(commitResult.decision);
        const diagnosis = ValidationDiagnosisEngine.diagnose({
          validationId: commitResult.validationId,
          artifactId: commitResult.artifactId,
          normalizedOutcome: normalized,
          attemptNumber: currentAttemptNumber,
          maxAttempts: maxRetries,
        });

        const validationDecision = RecoveryPolicy.evaluateValidation(diagnosis, {
          allowPaid: Boolean(claimed.policy?.allowPaid),
        });

        console.info(
          `[Worker ${this.workerId}] Attempt ${currentAttemptNumber} failed validation for step ${claimed.stepExecutionId}: ${diagnosis.failureClass} -> Action: ${validationDecision.action}`
        );

        // Durable checkpoint for validation failure
        try {
          await checkpointService.createCheckpoint({
            taskId: claimed.taskId,
            executionId: claimed.executionId,
            stepExecutionId: claimed.stepExecutionId,
            attemptId: currentAttemptId,
            attemptNumber: currentAttemptNumber,
            resourceId: currentResourceId,
            fencingToken: currentFencingToken,
            providerSlug: currentProviderSlug,
            modelSlug: currentModelSlug,
            executionState: "validation_failed",
            validationFailure: {
              validationId: commitResult.validationId,
              artifactId: commitResult.artifactId,
              outcome: diagnosis.outcome,
              failureClass: diagnosis.failureClass,
              reasons: diagnosis.reasons,
              recoverable: diagnosis.recoverable,
              recommendedAction: validationDecision.action,
            },
            recoveryDecision: validationDecision,
            completedArtifactIds: [commitResult.artifactId],
          });
        } catch (checkpointErr: any) {
          if (checkpointErr?.message?.includes("STALE_WORKER")) {
            console.warn(`[Worker ${this.workerId}] Stale worker detected during validation checkpoint: ${checkpointErr.message}`);
            return false;
          }
          throw checkpointErr;
        }

        // Action: WAIT (Uncertain outcome)
        if (validationDecision.action === "WAIT") {
          await db.query(
            `UPDATE execution.step_executions SET status = 'waiting', updated_at = now() WHERE id = $1;`,
            [claimed.stepExecutionId]
          );
          await db.query(
            `UPDATE tasks.tasks SET status = 'waiting', updated_at = now() WHERE id = $1;`,
            [claimed.taskId]
          );
          return false;
        }

        // Action: FAIL
        if (validationDecision.action === "FAIL") {
          await this.failExecution({
            stepExecutionId: claimed.stepExecutionId,
            executionId: claimed.executionId,
            taskId: claimed.taskId,
            attemptId: currentAttemptId,
            fencingToken: currentFencingToken,
            errorMessage: `Validation failed: ${diagnosis.reasons.join("; ") || diagnosis.failureClass}`,
          });
          return false;
        }

        // Action: MIGRATE_RESOURCE
        if (validationDecision.action === "MIGRATE_RESOURCE") {
          const altResult = await resourceIntelligence.selectAlternativeResource({
            requirements: {
              ...(claimed.requirements || {}),
              requiredCapabilities: claimed.requirements?.requiredCapabilities || ["text"],
            },
            policy: claimed.policy,
            currentResourceId,
            failureReason: diagnosis.failureClass,
            excludedResourceIds,
          });

          if (altResult.success && altResult.resource) {
            const selectedAlt = altResult.resource;
            const nextAttemptId = generateUUIDv7();
            const nextAttemptNumber = currentAttemptNumber + 1;

            let migrationSucceeded = false;
            await db.transaction(async (client) => {
              const updateStep = await client.query(
                `UPDATE execution.step_executions
                 SET resource_id = $1,
                     model_id = $2,
                     fencing_token = fencing_token + 1,
                     lease_expires_at = now() + ($3 || ' seconds')::interval,
                     updated_at = now()
                 WHERE id = $4 AND fencing_token = $5
                 RETURNING fencing_token;`,
                [
                  selectedAlt.resource.id,
                  selectedAlt.resource.modelId,
                  config.WORKER_LEASE_DURATION_SECONDS,
                  claimed.stepExecutionId,
                  currentFencingToken,
                ]
              );

              if (updateStep.rowCount === 0) return;
              migrationSucceeded = true;
              currentFencingToken = parseInt(updateStep.rows[0].fencing_token, 10);

              await client.query(
                `INSERT INTO execution.execution_attempts (
                  id, step_execution_id, attempt_number, resource_id,
                  provider_id, model_id, status, started_at
                ) VALUES ($1, $2, $3, $4, $5, $6, 'running', now());`,
                [
                  nextAttemptId,
                  claimed.stepExecutionId,
                  nextAttemptNumber,
                  selectedAlt.resource.id,
                  selectedAlt.resource.providerId,
                  selectedAlt.resource.modelId,
                ]
              );

              await client.query(
                `INSERT INTO system.outbox_events (
                  id, event_id, event_type, aggregate_type, aggregate_id, payload
                ) VALUES (
                  gen_random_uuid(), $1, 'RESOURCE_MIGRATED', 'step_execution', $2, $3
                );`,
                [
                  generateUUIDv7(),
                  claimed.stepExecutionId,
                  JSON.stringify({
                    taskId: claimed.taskId,
                    executionId: claimed.executionId,
                    fromResourceId: currentResourceId,
                    toResourceId: selectedAlt.resource.id,
                    attemptNumber: nextAttemptNumber,
                    reason: diagnosis.failureClass,
                  }),
                ]
              );
            });

            if (!migrationSucceeded) {
              console.warn(`[Worker ${this.workerId}] Stale worker rejected during validation migration.`);
              return false;
            }

            currentResourceId = selectedAlt.resource.id;
            currentProviderSlug = selectedAlt.providerSlug;
            currentModelSlug = selectedAlt.modelSlug;
            currentSecretReference = selectedAlt.credentialSecretRef;
            currentAttemptId = nextAttemptId;
            currentAttemptNumber = nextAttemptNumber;
            excludedResourceIds.push(currentResourceId);
            continue;
          } else {
            await this.failExecution({
              stepExecutionId: claimed.stepExecutionId,
              executionId: claimed.executionId,
              taskId: claimed.taskId,
              attemptId: currentAttemptId,
              fencingToken: currentFencingToken,
              errorMessage: `Validation migration failed: No eligible alternative resource (${altResult.reason || "NO_ELIGIBLE_RESOURCE"})`,
            });
            return false;
          }
        }

        // Action: RETRY_SAME
        if (validationDecision.action === "RETRY_SAME") {
          if (currentAttemptNumber < maxRetries) {
            const nextAttemptId = generateUUIDv7();
            const nextAttemptNumber = currentAttemptNumber + 1;

            let retrySucceeded = false;
            await db.transaction(async (client) => {
              const updateStep = await client.query(
                `UPDATE execution.step_executions
                 SET fencing_token = fencing_token + 1,
                     lease_expires_at = now() + ($1 || ' seconds')::interval,
                     updated_at = now()
                 WHERE id = $2 AND fencing_token = $3
                 RETURNING fencing_token;`,
                [
                  config.WORKER_LEASE_DURATION_SECONDS,
                  claimed.stepExecutionId,
                  currentFencingToken,
                ]
              );

              if (updateStep.rowCount === 0) return;
              retrySucceeded = true;
              currentFencingToken = parseInt(updateStep.rows[0].fencing_token, 10);

              await client.query(
                `INSERT INTO execution.execution_attempts (
                  id, step_execution_id, attempt_number, resource_id,
                  status, started_at
                ) VALUES ($1, $2, $3, $4, 'running', now());`,
                [
                  nextAttemptId,
                  claimed.stepExecutionId,
                  nextAttemptNumber,
                  currentResourceId,
                ]
              );
            });

            if (!retrySucceeded) {
              console.warn(`[Worker ${this.workerId}] Stale worker rejected during validation retry update.`);
              return false;
            }

            currentAttemptId = nextAttemptId;
            currentAttemptNumber = nextAttemptNumber;
            continue;
          } else {
            await this.failExecution({
              stepExecutionId: claimed.stepExecutionId,
              executionId: claimed.executionId,
              taskId: claimed.taskId,
              attemptId: currentAttemptId,
              fencingToken: currentFencingToken,
              errorMessage: `Validation retries exhausted (${diagnosis.failureClass})`,
            });
            return false;
          }
        }
      } catch (err: any) {
        // If fencing error, abort worker loop immediately
        if (err?.message?.includes("STALE_WORKER")) {
          console.warn(`[Worker ${this.workerId}] Stale worker fencing violation detected: ${err.message}`);
          return false;
        }

        const effectiveAdapter = this.resolveAdapter(currentProviderSlug);
        const normalizedError = effectiveAdapter.normalizeError(err);
        const decision = RecoveryPolicy.evaluate(normalizedError);

        console.info(
          `[Worker ${this.workerId}] Attempt ${currentAttemptNumber} failed for step ${claimed.stepExecutionId}: ${normalizedError.code} -> Action: ${decision.action}`
        );

        // Record resource failure telemetry (M4.7, M4.9, M4.17)
        try {
          await resourceIntelligence.recordExecutionFailure(currentResourceId, {
            code: normalizedError.code,
            message: normalizedError.message,
            isProviderError: true,
            retryAfterMs: normalizedError.retryAfterMs,
          });
          if (normalizedError.code === "QUOTA_EXHAUSTED") {
            await db.query("UPDATE resources.resource_quotas SET remaining_value = 0 WHERE resource_id = $1;", [currentResourceId]);
          }
        } catch (telemetryErr: any) {
          console.warn(`[Worker ${this.workerId}] Failed to record resource failure telemetry:`, telemetryErr);
        }

        // --------------------------------------------------------------------
        // Durable Checkpoint & Error Persistence (Atomic DB Transaction)
        // --------------------------------------------------------------------
        try {
          await checkpointService.createCheckpoint({
            taskId: claimed.taskId,
            executionId: claimed.executionId,
            stepExecutionId: claimed.stepExecutionId,
            attemptId: currentAttemptId,
            attemptNumber: currentAttemptNumber,
            resourceId: currentResourceId,
            fencingToken: currentFencingToken,
            providerSlug: currentProviderSlug,
            modelSlug: currentModelSlug,
            executionState: "attempt_failed",
            error: normalizedError,
            recoveryDecision: decision,
          });
        } catch (checkpointErr: any) {
          if (checkpointErr?.message?.includes("STALE_WORKER")) {
            console.warn(`[Worker ${this.workerId}] Stale worker detected during checkpoint: ${checkpointErr.message}`);
            return false;
          }
          throw checkpointErr;
        }

        // --------------------------------------------------------------------
        // Evaluate Recovery Action
        // --------------------------------------------------------------------
        if (decision.action === "MIGRATE_RESOURCE") {
          // Centralized Alternative Resource Resolution (Resource Intelligence)
          const altResult = await resourceIntelligence.selectAlternativeResource({
            requirements: {
              ...(claimed.requirements || {}),
              requiredCapabilities: claimed.requirements?.requiredCapabilities || ["text"],
            },
            policy: claimed.policy,
            currentResourceId,
            failureReason: normalizedError.code,
            excludedResourceIds,
          });

          if (altResult.success && altResult.resource) {
            const selectedAlt = altResult.resource;
            const nextAttemptId = generateUUIDv7();
            const nextAttemptNumber = currentAttemptNumber + 1;

            // Atomic Migration Transaction
            let migrationSucceeded = false;
            await db.transaction(async (client) => {
              // Monotonic Fencing Check on step_executions
              const updateStep = await client.query(
                `UPDATE execution.step_executions
                 SET resource_id = $1,
                     model_id = $2,
                     fencing_token = fencing_token + 1,
                     lease_expires_at = now() + ($3 || ' seconds')::interval,
                     updated_at = now()
                 WHERE id = $4 AND fencing_token = $5
                 RETURNING fencing_token;`,
                [
                  selectedAlt.resource.id,
                  selectedAlt.resource.modelId,
                  config.WORKER_LEASE_DURATION_SECONDS,
                  claimed.stepExecutionId,
                  currentFencingToken,
                ]
              );

              if (updateStep.rowCount === 0) {
                return; // Stale worker rejected
              }

              migrationSucceeded = true;
              currentFencingToken = parseInt(updateStep.rows[0].fencing_token, 10);

              // Record Attempt N+1 in execution_attempts
              await client.query(
                `INSERT INTO execution.execution_attempts (
                  id, step_execution_id, attempt_number, resource_id,
                  provider_id, model_id, status, started_at
                ) VALUES ($1, $2, $3, $4, $5, $6, 'running', now());`,
                [
                  nextAttemptId,
                  claimed.stepExecutionId,
                  nextAttemptNumber,
                  selectedAlt.resource.id,
                  selectedAlt.resource.providerId,
                  selectedAlt.resource.modelId,
                ]
              );

              // Transactional Outbox Event (ADR-095)
              await client.query(
                `INSERT INTO system.outbox_events (
                  id, event_id, event_type, aggregate_type, aggregate_id, payload
                ) VALUES (
                  gen_random_uuid(), $1, 'RESOURCE_MIGRATED', 'step_execution', $2, $3
                );`,
                [
                  generateUUIDv7(),
                  claimed.stepExecutionId,
                  JSON.stringify({
                    taskId: claimed.taskId,
                    executionId: claimed.executionId,
                    fromResourceId: currentResourceId,
                    toResourceId: selectedAlt.resource.id,
                    attemptNumber: nextAttemptNumber,
                    reason: normalizedError.code,
                  }),
                ]
              );
            });

            if (!migrationSucceeded) {
              console.warn(`[Worker ${this.workerId}] Stale worker rejected during migration update.`);
              return false;
            }

            // Advance state for Attempt N+1
            currentResourceId = selectedAlt.resource.id;
            currentProviderSlug = selectedAlt.providerSlug;
            currentModelSlug = selectedAlt.modelSlug;
            currentSecretReference = selectedAlt.credentialSecretRef;
            currentAttemptId = nextAttemptId;
            currentAttemptNumber = nextAttemptNumber;
            excludedResourceIds.push(currentResourceId);

            // Continue loop with new resource attempt
            continue;
          } else {
            // NO_ELIGIBLE_RESOURCE -> Fail execution deterministically
            await this.failExecution({
              stepExecutionId: claimed.stepExecutionId,
              executionId: claimed.executionId,
              taskId: claimed.taskId,
              attemptId: currentAttemptId,
              fencingToken: currentFencingToken,
              errorMessage: `Migration failed: No eligible alternative resource (${altResult.reason || "NO_ELIGIBLE_RESOURCE"})`,
            });
            return false;
          }
        } else if (decision.action === "RETRY_SAME") {
          if (currentAttemptNumber < maxRetries) {
            if (decision.waitRequired && decision.retryAfterMs) {
              await new Promise((resolve) => setTimeout(resolve, Math.min(decision.retryAfterMs!, 5000)));
            }

            const nextAttemptId = generateUUIDv7();
            const nextAttemptNumber = currentAttemptNumber + 1;

            let retrySucceeded = false;
            await db.transaction(async (client) => {
              const updateStep = await client.query(
                `UPDATE execution.step_executions
                 SET fencing_token = fencing_token + 1,
                     lease_expires_at = now() + ($1 || ' seconds')::interval,
                     updated_at = now()
                 WHERE id = $2 AND fencing_token = $3
                 RETURNING fencing_token;`,
                [
                  config.WORKER_LEASE_DURATION_SECONDS,
                  claimed.stepExecutionId,
                  currentFencingToken,
                ]
              );

              if (updateStep.rowCount === 0) {
                return;
              }

              retrySucceeded = true;
              currentFencingToken = parseInt(updateStep.rows[0].fencing_token, 10);

              await client.query(
                `INSERT INTO execution.execution_attempts (
                  id, step_execution_id, attempt_number, resource_id,
                  status, started_at
                ) VALUES ($1, $2, $3, $4, 'running', now());`,
                [
                  nextAttemptId,
                  claimed.stepExecutionId,
                  nextAttemptNumber,
                  currentResourceId,
                ]
              );
            });

            if (!retrySucceeded) {
              console.warn(`[Worker ${this.workerId}] Stale worker rejected during retry update.`);
              return false;
            }

            currentAttemptId = nextAttemptId;
            currentAttemptNumber = nextAttemptNumber;
            continue;
          } else {
            await this.failExecution({
              stepExecutionId: claimed.stepExecutionId,
              executionId: claimed.executionId,
              taskId: claimed.taskId,
              attemptId: currentAttemptId,
              fencingToken: currentFencingToken,
              errorMessage: `Retry limit reached: Exceeded ${maxRetries} attempts on same resource`,
            });
            return false;
          }
        } else {
          // Non-recoverable error (e.g. INVALID_REQUEST, AUTHENTICATION, etc.)
          await this.failExecution({
            stepExecutionId: claimed.stepExecutionId,
            executionId: claimed.executionId,
            taskId: claimed.taskId,
            attemptId: currentAttemptId,
            fencingToken: currentFencingToken,
            errorMessage: normalizedError.message || `Non-recoverable execution error: ${normalizedError.code}`,
          });
          return false;
        }
      }
    }

    // Exhausted maximum attempt budget without success
    await this.failExecution({
      stepExecutionId: claimed.stepExecutionId,
      executionId: claimed.executionId,
      taskId: claimed.taskId,
      attemptId: currentAttemptId,
      fencingToken: currentFencingToken,
      errorMessage: `Execution recovery exhausted: Exceeded maximum attempts (${maxRetries})`,
    });

    return false;
  }

  private async failExecution(params: {
    readonly stepExecutionId: string;
    readonly executionId: string;
    readonly taskId: string;
    readonly attemptId: string;
    readonly fencingToken: number;
    readonly errorMessage: string;
  }): Promise<void> {
    await db.transaction(async (client) => {
      const errorId = generateUUIDv7();

      await client.query(
        `INSERT INTO execution.execution_errors (
          id, execution_id, step_execution_id, attempt_id, category, message
        ) VALUES ($1, $2, $3, $4, 'EXECUTION_FAILURE', $5);`,
        [errorId, params.executionId, params.stepExecutionId, params.attemptId, params.errorMessage]
      );

      const stepUpdate = await client.query(
        `UPDATE execution.step_executions
         SET status = 'failed', updated_at = now()
         WHERE id = $1 AND fencing_token = $2;`,
        [params.stepExecutionId, params.fencingToken]
      );

      if (stepUpdate.rowCount === 0) {
        console.warn(`[Worker ${this.workerId}] Stale worker ignored during execution failure commit.`);
        return;
      }

      // Check if this step execution belongs to a collaboration branch
      const branchQuery = await client.query(
        `SELECT id, collaboration_run_id FROM execution.collaboration_branches WHERE step_execution_id = $1;`,
        [params.stepExecutionId]
      );

      if (branchQuery.rows.length > 0) {
        const branch = branchQuery.rows[0];
        await client.query(
          `UPDATE execution.collaboration_branches
           SET status = 'failed', error_message = $1, updated_at = now()
           WHERE id = $2;`,
          [params.errorMessage, branch.id]
        );

        await client.query(
          `INSERT INTO system.outbox_events (
            id, event_id, event_type, aggregate_type, aggregate_id, payload
          ) VALUES (
            gen_random_uuid(), $1, 'BRANCH_FAILED', 'collaboration_branch', $2, $3
          );`,
          [
            generateUUIDv7(),
            branch.id,
            JSON.stringify({
              collaborationRunId: branch.collaboration_run_id,
              errorMessage: params.errorMessage,
            }),
          ]
        );
      } else {
        const dagCheck = await client.query(
          `SELECT task_type FROM tasks.tasks WHERE id = $1;`,
          [params.taskId]
        );
        const isDAG = dagCheck.rows[0]?.task_type === "dag";

        if (isDAG) {
          await DAGWorkerBridge.handleFailure(client, {
            stepExecutionId: params.stepExecutionId,
            executionId: params.executionId,
            attemptNumber: 1,
            failureReason: params.errorMessage,
            isPermanent: true,
            fencingToken: params.fencingToken,
          });

          const remainingRes = await client.query(
            `SELECT COUNT(*) AS active_step_count
             FROM execution.step_executions
             WHERE execution_id = $1 AND status IN ('pending', 'running', 'blocked', 'diagnosing');`,
            [params.executionId]
          );
          const activeStepCount = parseInt(remainingRes.rows[0].active_step_count, 10);
          if (activeStepCount === 0) {
            await client.query(
              `UPDATE execution.executions
               SET status = 'failed', completed_at = now(), updated_at = now()
               WHERE id = $1;`,
              [params.executionId]
            );

            await client.query(
              `UPDATE tasks.tasks
               SET status = 'failed', error_id = $1, updated_at = now()
               WHERE id = $2;`,
              [errorId, params.taskId]
            );

            await client.query(
              `INSERT INTO system.outbox_events (
                id, event_id, event_type, aggregate_type, aggregate_id, payload
              ) VALUES (
                gen_random_uuid(), $1, 'TASK_FAILED', 'task', $2, $3
              );`,
              [
                generateUUIDv7(),
                params.taskId,
                JSON.stringify({
                  errorId,
                  stepExecutionId: params.stepExecutionId,
                  errorMessage: params.errorMessage,
                }),
              ]
            );
          }
        } else {
          await client.query(
            `UPDATE execution.executions
             SET status = 'failed', updated_at = now()
             WHERE id = $1;`,
            [params.executionId]
          );

          await client.query(
            `UPDATE tasks.tasks
             SET status = 'failed', error_id = $1, updated_at = now()
             WHERE id = $2;`,
            [errorId, params.taskId]
          );

          await client.query(
            `INSERT INTO system.outbox_events (
              id, event_id, event_type, aggregate_type, aggregate_id, payload
            ) VALUES (
              gen_random_uuid(), $1, 'TASK_FAILED', 'task', $2, $3
            );`,
            [
              generateUUIDv7(),
              params.taskId,
              JSON.stringify({
                errorId,
                stepExecutionId: params.stepExecutionId,
                errorMessage: params.errorMessage,
              }),
            ]
          );
        }
      }
    });
  }
}


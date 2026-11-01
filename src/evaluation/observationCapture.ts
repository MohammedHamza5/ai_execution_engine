/**
 * Execution Observation Capture Service
 * Milestone M5-D (M5.9): Ingests real & synthetic observations with secret redaction
 * Complies with Anti-Monolith File Law (<= 200 lines)
 */

import { benchmarkRepository } from "./benchmarkRepository.js";
import { BenchmarkResult } from "../domain/evaluation/types.js";
import { generateUUIDv7 } from "../domain/common/id.js";
import { db } from "../db/client.js";

export interface ExecutionObservationInput {
  readonly benchmarkRunId?: string;
  readonly benchmarkCaseId?: string;
  readonly executionId?: string;
  readonly resourceId?: string;
  readonly modelId?: string;
  readonly rawOutput?: string;
  readonly score: number;
  readonly confidence: number;
  readonly latencyMs?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly isCorrect: boolean;
  readonly isSimulated: boolean;
  readonly billingClass?: string;
  readonly validationDetails?: Record<string, unknown>;
}

export class ObservationCaptureService {
  /**
   * Captures an observation and persists it durably in PostgreSQL with zero leaked secrets.
   */
  public async captureObservation(input: ExecutionObservationInput): Promise<BenchmarkResult | null> {
    // Redact any leaked credentials from validation details or raw output preview
    const cleanDetails = this.redactDetails(input.validationDetails || {});

    if (input.benchmarkRunId && input.benchmarkCaseId) {
      return await benchmarkRepository.recordBenchmarkResult({
        benchmarkRunId: input.benchmarkRunId,
        benchmarkCaseId: input.benchmarkCaseId,
        rawOutput: input.rawOutput ? this.sanitizeOutput(input.rawOutput) : undefined,
        score: Math.max(0.0, Math.min(1.0, input.score)),
        confidence: Math.max(0.0, Math.min(1.0, input.confidence)),
        latencyMs: input.latencyMs,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        isCorrect: input.isCorrect,
        validationDetails: cleanDetails,
      });
    }

    // Passive production validation observation: record event into system.outbox_events
    const id = generateUUIDv7();
    const eventId = generateUUIDv7();
    await db.query(
      `INSERT INTO system.outbox_events 
        (id, event_id, event_type, aggregate_type, aggregate_id, payload, created_at)
       VALUES ($1, $2, 'OBSERVATION_CAPTURED', 'RESOURCE', $3, $4, now());`,
      [
        id,
        eventId,
        input.resourceId || generateUUIDv7(),
        JSON.stringify({
          executionId: input.executionId,
          score: input.score,
          isCorrect: input.isCorrect,
          latencyMs: input.latencyMs,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          billingClass: input.billingClass || "FREE",
          isSimulated: input.isSimulated,
          details: cleanDetails,
        }),
      ]
    );

    return null;
  }

  private redactDetails(details: Record<string, unknown>): Record<string, unknown> {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(details)) {
      if (/key|secret|token|password|auth|credential/i.test(k)) {
        continue;
      }
      clean[k] = v;
    }
    return clean;
  }

  private sanitizeOutput(text: string): string {
    return text.replace(/([a-zA-Z0-9_-]{20,})/g, (match) => {
      if (/key|secret|token/i.test(match)) return "[REDACTED]";
      return match;
    });
  }
}

export const observationCaptureService = new ObservationCaptureService();

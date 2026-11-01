/**
 * Reputation Domain Types
 * Enforces Milestone M5-E & M5-F: Statistical Aggregation & Multi-Dimensional Profiles
 * Complies with Anti-Monolith File Law (<= 200 lines)
 */

import { BenchmarkTaskCategory } from "../evaluation/types.js";

export type ReputationSubjectType = "resource" | "model" | "model_version" | "provider";

export type ReputationDimension =
  | "quality"
  | "reliability"
  | "latency"
  | "cost_efficiency"
  | "safety"
  | "task_capability";

export type ReputationEvidenceSource =
  | "official_benchmark"
  | "internal_benchmark"
  | "production_validation"
  | "human_feedback";

export interface ReputationProfile {
  readonly id: string;
  readonly subjectType: ReputationSubjectType;
  readonly subjectId: string;
  readonly version: number;
  readonly overallScore: number; // 0.0 to 1.0
  readonly confidence: number;   // 0.0 to 1.0
  readonly sampleSize: number;
  readonly lastUpdatedAt: Date;
}

export interface ReputationScore {
  readonly id: string;
  readonly profileId: string;
  readonly dimension: ReputationDimension;
  readonly taskSubtype?: BenchmarkTaskCategory;
  readonly score: number;        // Beta distribution mean (0.0 to 1.0)
  readonly confidence: number;   // 0.0 to 1.0 based on sample sufficiency
  readonly sampleSize: number;
  readonly alpha: number;        // Effective positive evidence
  readonly beta: number;         // Effective negative evidence
  readonly decayFactor: number;  // Exponential recency decay
  readonly updatedAt: Date;
}

export interface ReputationEvidence {
  readonly id: string;
  readonly reputationScoreId: string;
  readonly sourceType: ReputationEvidenceSource;
  readonly sourceId: string;
  readonly weight: number;
  readonly contribution: number;
  readonly isSimulated: boolean;
  readonly createdAt: Date;
}

export interface ReputationSnapshot {
  readonly id: string;
  readonly subjectType: ReputationSubjectType;
  readonly subjectId: string;
  readonly scores: Record<string, unknown>;
  readonly createdAt: Date;
}

/**
 * Evaluation and Benchmark Domain Types
 * Enforces Milestone M5-A: Benchmark Domain and Task Taxonomy
 * Complies with Anti-Monolith File Law (<= 200 lines)
 */

export type BenchmarkTaskCategory =
  | "general_text"
  | "structured_json"
  | "coding"
  | "reasoning"
  | "mathematics"
  | "vision_understanding"
  | "ocr_extraction"
  | "long_context"
  | "tool_calling";

export const BENCHMARK_TASK_CATEGORIES: readonly BenchmarkTaskCategory[] = [
  "general_text",
  "structured_json",
  "coding",
  "reasoning",
  "mathematics",
  "vision_understanding",
  "ocr_extraction",
  "long_context",
  "tool_calling",
] as const;

export type EvaluatorType =
  | "deterministic"
  | "schema"
  | "known_answer"
  | "domain_specific"
  | "independent_model"
  | "human_review";

export type BenchmarkStatus = "active" | "archived" | "draft";

export type BenchmarkRunStatus = "pending" | "running" | "completed" | "failed";

export interface Benchmark {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly version: number;
  readonly domain: BenchmarkTaskCategory;
  readonly description?: string;
  readonly status: BenchmarkStatus;
  readonly createdAt: Date;
}

export interface BenchmarkCase {
  readonly id: string;
  readonly benchmarkId: string;
  readonly name: string;
  readonly difficulty: number; // 0.0 to 1.0
  readonly inputPayload: Record<string, unknown>;
  readonly expectedOutputPayload?: Record<string, unknown>;
  readonly validationStrategy: {
    readonly evaluatorType: EvaluatorType;
    readonly criteria?: Record<string, unknown>;
    readonly tolerance?: number;
    readonly timeoutMs?: number;
  };
  readonly metadata: Record<string, unknown>;
  readonly createdAt: Date;
}

export interface BenchmarkRun {
  readonly id: string;
  readonly benchmarkId: string;
  readonly modelId?: string;
  readonly resourceId?: string;
  readonly version: number;
  readonly status: BenchmarkRunStatus;
  readonly isSimulated: boolean;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly createdAt: Date;
}

export interface BenchmarkResult {
  readonly id: string;
  readonly benchmarkRunId: string;
  readonly benchmarkCaseId: string;
  readonly outputArtifactId?: string;
  readonly rawOutput?: string;
  readonly score: number; // 0.0 to 1.0
  readonly confidence: number; // 0.0 to 1.0
  readonly latencyMs?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly isCorrect: boolean;
  readonly validationDetails?: Record<string, unknown>;
  readonly createdAt: Date;
}

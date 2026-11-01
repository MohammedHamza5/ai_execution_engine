export type TaskStatus =
  | "pending"
  | "analyzing"
  | "planning"
  | "ready"
  | "running"
  | "waiting"
  | "validating"
  | "completed"
  | "failed"
  | "cancelled"
  | "paused";

export type PlanStatus = "draft" | "validated" | "active" | "superseded" | "aborted";

export type PlanStepType =
  | "model_inference"
  | "tool_call"
  | "retrieval"
  | "transcription"
  | "embedding"
  | "validation"
  | "aggregation"
  | "synthesis"
  | "human_review"
  | "transform"
  | "wait";

export type StepExecutionStatus =
  | "pending"
  | "running"
  | "validating"
  | "completed"
  | "diagnosing"
  | "waiting"
  | "failed"
  | "migrating";

export type AttemptStatus =
  | "running"
  | "success"
  | "failed"
  | "timeout"
  | "unknown"
  | "quota_exhausted";

export type ValidationOutcome = "ACCEPT" | "REJECT" | "UNCERTAIN";

export type ValidationStatus = "pending" | "passed" | "failed" | "uncertain" | "disputed";

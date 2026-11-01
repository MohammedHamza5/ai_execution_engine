/**
 * Multi-Dimensional Model Taxonomy Types
 *
 * Implements Orthogonal 4-Dimensional Taxonomy for Universal AI Execution:
 * 1. I/O Modality Signature (Input/Output Tensors)
 * 2. Cognitive Archetype (Operational Reasoning & Latency profile)
 * 3. Operational Primitives (Deterministic technical capabilities)
 * 4. Execution Tier (Compute & parameter class)
 */

export type InputModality =
  | "TEXT"
  | "IMAGE"
  | "AUDIO"
  | "VIDEO"
  | "DOCUMENT_PDF"
  | "STRUCTURED_DATA";

export type OutputModality =
  | "TEXT"
  | "AUDIO"
  | "IMAGE"
  | "VIDEO"
  | "EMBEDDING"
  | "STRUCTURED_JSON";

export type CognitiveArchetype =
  | "REASONING_DELIBERATIVE" // Deep CoT, high latency (o1, DeepSeek-R1)
  | "FAST_REFLEX"            // Ultra-low latency, sub-second (Groq, Cerebras)
  | "CODE_SYSTEMS"           // Architecture, code synthesis, refactoring
  | "DEEP_SYNTHESIS"         // Long-form synthesis, multi-source arbitration
  | "CREATIVE_GENERATION"    // Fluid narrative and creative copy
  | "EMBEDDING_RETRIEVAL"    // Dense vector & semantic indexing
  | "CLASSIFICATION_GUARD";  // Safety, moderation, intent routing

export type ExecutionTier =
  | "EDGE_LIGHT"            // 1B-8B params, ultra-fast, low cost / free tier
  | "BALANCED_WORKHORSE"    // 14B-70B params, balanced quality/cost
  | "FRONTIER_HEAVYWEIGHT"; // Flagship frontier models

export interface ModelModalitySignature {
  readonly inputs: ReadonlyArray<InputModality>;
  readonly outputs: ReadonlyArray<OutputModality>;
  readonly isDuplexAudio?: boolean;
}

export interface ModelTaxonomyProfile {
  readonly modalities: ModelModalitySignature;
  readonly archetype: CognitiveArchetype;
  readonly tier: ExecutionTier;
  readonly specializedDomains?: ReadonlyArray<string>;
  readonly maxContextTokens?: number;
}

export interface TaxonomyMatchingCriteria {
  readonly requiredInputs?: ReadonlyArray<InputModality>;
  readonly requiredOutputs?: ReadonlyArray<OutputModality>;
  readonly preferredArchetype?: CognitiveArchetype;
  readonly preferredTier?: ExecutionTier;
  readonly requiredDomain?: string;
}

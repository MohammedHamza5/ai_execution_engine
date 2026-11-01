// ─── Forma – Public Barrel Export (v2) ────────────────────────────────────────
// Components
export { FormaCanvas } from "./FormaCanvas";
export { FormaErrorBoundary } from "./FormaErrorBoundary";
export { StatusBadge } from "./StatusBadge";
export { NodeCard } from "./NodeCard";
export { NodeInspector } from "./NodeInspector";
export { ProgressBanner } from "./ProgressBanner";
export { ArtifactResultCard } from "./ArtifactResultCard";
export { DagGraphCanvas } from "./DagGraphCanvas";

// Animated primitives
export { AnimatedEdge } from "./animated/AnimatedEdge";
export { LivePulse } from "./animated/LivePulse";

// UI overlays
export { SmartCommentary } from "./ui/SmartCommentary";
export { ToastNotifier } from "./ui/ToastNotifier";

// Intelligence layer
export { useIntelligence } from "./intelligence/useIntelligence";
export { analyzeDag } from "./intelligence/dagAnalyzer";
export { calculateETA, formatAvgLatency } from "./intelligence/etaCalculator";

// Engine
export { computeLayout } from "./layoutEngine";

// Types
export type {
  DAGNode, DAGDetails, LayoutResult, NodeLayout, CanvasEdge, FormaCallbacks,
} from "./types";
export type { DAGInsights, RiskLevel, BottleneckInfo } from "./intelligence/dagAnalyzer";
export type { ETAResult } from "./intelligence/etaCalculator";
export type { ToastEvent } from "./intelligence/useIntelligence";

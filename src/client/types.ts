export interface ClientConfig {
  baseUrl: string;
  apiKey?: string;
  tenantId?: string;
  timeoutMs?: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionParams {
  model?: string;
  models?: string[];
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  response_format?: { type: "text" | "json_object" };
}

export interface ChatCompletionChoice {
  index: number;
  message: { role: string; content: string };
  finish_reason: string | null;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface ChatCompletionChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: string; content?: string };
    finish_reason: string | null;
  }>;
}

export interface TaskSubmitParams {
  title: string;
  prompt: string;
  requiredCapabilities?: string[];
  systemInstruction?: string;
  allowPaid?: boolean;
  priority?: number;
}

export interface TaskStatusResponse {
  id: string;
  title: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  resultArtifactId?: string;
  error?: string;
  created_at: string;
  updated_at: string;
}

export interface DAGNodeDef {
  nodeId: string;
  name: string;
  prompt: string;
  dependencies: string[];
  requiredCapabilities?: string[];
}

export interface DAGSubmitParams {
  title: string;
  nodes: DAGNodeDef[];
  allowPaid?: boolean;
}

export interface DAGStepStatus {
  stepKey: string;
  name?: string;
  status: string;
  stepExecutionId?: string;
  artifactId?: string;
  dependencies?: string[];
  error?: string;
}

export interface DAGStatusResponse {
  taskId: string;
  status: string;
  metrics?: {
    totalSteps: number;
    completedSteps: number;
    pendingSteps: number;
    runningSteps: number;
    failedSteps: number;
    isComplete: boolean;
  };
  steps: DAGStepStatus[];
  nodes?: DAGStepStatus[];
}

export interface MemoryStoreParams {
  id?: string;
  text: string;
  metadata?: Record<string, any>;
}

export interface MemorySearchParams {
  query: string;
  limit?: number;
  threshold?: number;
}

export interface MemorySearchResult {
  id: string;
  text: string;
  score: number;
  metadata?: Record<string, any>;
}

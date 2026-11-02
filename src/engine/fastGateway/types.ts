export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface ResponseFormat {
  type: "text" | "json_object";
}

export interface ChatCompletionRequest {
  model?: string;
  models?: string[];
  namespace?: string;
  tenantId?: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  response_format?: ResponseFormat;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: "stop" | "length" | "tool_calls" | null;
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ProviderCandidate {
  provider: "groq" | "openrouter" | "cloudflare" | "gemini" | "apinex" | "cerebras" | "mistral" | "deepseek" | string;
  model: string;
  apiKey: string;
  accountId?: string;
}

export interface ModelDescriptor {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  description: string;
}

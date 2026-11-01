import { ChatCompletionRequest } from "./types.js";

export type IntentDomain =
  | "MASSIVE_CONTEXT"
  | "VISUAL_CANVAS"
  | "ARABIC_SPECIALIST"
  | "DEEP_REASONING"
  | "CODE_SYSTEMS"
  | "FAST_CHAT";

export interface IntentAnalysisResult {
  domain: IntentDomain;
  confidence: number;
  reason: string;
}

export class CognitiveIntentAnalyzer {
  public static analyze(req: ChatCompletionRequest): IntentAnalysisResult {
    const text = (req.messages || []).map((m) => m.content).join(" ");
    const charCount = text.length;

    // 1. Massive Context Check (> 30,000 characters ~ 7,500+ tokens)
    if (charCount > 30_000) {
      return {
        domain: "MASSIVE_CONTEXT",
        confidence: 0.99,
        reason: `Payload exceeds ${charCount} chars; requires massive 1M+ context window`,
      };
    }

    // 2. Arabic Language Specialist Check (contains significant Arabic character span)
    const arabicMatch = text.match(/[\u0600-\u06FF]/g);
    const arabicRatio = arabicMatch ? arabicMatch.length / (text.length || 1) : 0;
    if (arabicRatio > 0.25 || (arabicMatch && arabicMatch.length > 15)) {
      return {
        domain: "ARABIC_SPECIALIST",
        confidence: 0.95,
        reason: "Significant Arabic script detected; routing to Arabic specialist",
      };
    }

    // 3. Visual / Canvas / Structured Diagram Intent (FORMA canvas commands)
    const hasCanvasKeywords = /\b(canvas|forma|shape|draw|rectangle|arrow|layout|tldraw|geometry|diagram|svg|viewport|bounding)\b/i.test(text);
    const isJsonRequested = req.response_format?.type === "json_object" || /json/i.test(text);
    if (hasCanvasKeywords || (isJsonRequested && /\b(node|edge|element|coordinate|x|y|width|height|action)\b/i.test(text))) {
      return {
        domain: "VISUAL_CANVAS",
        confidence: 0.92,
        reason: "Visual canvas / spatial diagram or structured UI schema command",
      };
    }

    // 4. Code & Technical Systems Intent
    const hasCodeKeywords = /\b(code|function|typescript|javascript|python|flutter|dart|sql|bug|refactor|class|async|regex|algorithm|api)\b/i.test(text);
    if (hasCodeKeywords || /```|\{|\};|<\/|SELECT |FROM |WHERE /i.test(text)) {
      return {
        domain: "CODE_SYSTEMS",
        confidence: 0.88,
        reason: "Programming, SQL, or systems implementation prompt",
      };
    }

    // 5. Deep Reasoning & Strategic Analysis Intent (Market Intelligence, Math, Strategy)
    const hasReasoningKeywords = /\b(market|competitor|financial|swot|pricing|strategy|evaluate|analyze|hypothesis|solve|calculate|proof|benchmark)\b/i.test(text);
    if (hasReasoningKeywords || text.includes("?")) {
      const isComplex = text.split(/\s+/).length > 25 || hasReasoningKeywords;
      if (isComplex) {
        return {
          domain: "DEEP_REASONING",
          confidence: 0.85,
          reason: "Analytical, competitive intelligence, or deliberative reasoning request",
        };
      }
    }

    // 6. Fast Conversational Reflex (Default for short queries and chat)
    return {
      domain: "FAST_CHAT",
      confidence: 0.80,
      reason: "Conversational query; optimized for sub-300ms ultra-low latency",
    };
  }
}

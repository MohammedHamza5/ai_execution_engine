import { McpToolDefinition, McpToolCallResult } from "./types.js";
import { FastInferenceDispatcher } from "../engine/fastGateway/fastDispatcher.js";
import { keyPoolManager } from "../engine/fastGateway/keyPoolManager.js";
import { swarmSmoother } from "../engine/fastGateway/swarmConcurrencySmoother.js";
import { executionEngine } from "../engine/executionEngine.js";
import { ensureDefaultTenant } from "../api/routes/tasks.js";
import { MCP_MEMORY_TOOLS, executeMemoryMcpTool } from "./memoryTools.js";

const BASE_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "ai_chat",
    description: "Execute ultra-fast cognitive AI inference across 16-key multi-tier fleet with auto-failover, semantic domain routing, and zero rate-limit errors.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The user prompt or query." },
        model: { type: "string", description: "Optional model hint ('auto', 'deepseek-r1', 'llama-3.3-70b', 'gemini-1.5-flash'). Defaults to 'auto'." },
        system: { type: "string", description: "Optional system instruction." },
        json: { type: "boolean", description: "Whether to force valid JSON output object." },
      },
      required: ["prompt"],
    },
  },
  {
    name: "ai_fleet_stats",
    description: "Get real-time operational status, active key pools, and circuit breaker health across Groq, Gemini, OpenRouter, and Cloudflare.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "ai_dag_workflow",
    description: "Dispatch an asynchronous multi-model Directed Acyclic Graph (DAG) workflow (e.g. Diamond Pipeline: Research -> Parallel Analysis -> Synthesis).",
    inputSchema: {
      type: "object",
      properties: {
        objective: { type: "string", description: "The overarching objective or question to analyze." },
        template: { type: "string", enum: ["diamond", "code_review"], description: "Pre-configured DAG workflow template." },
      },
      required: ["objective"],
    },
  },
];

export const MCP_TOOLS: McpToolDefinition[] = [...BASE_MCP_TOOLS, ...MCP_MEMORY_TOOLS];

export async function executeMcpTool(name: string, args: Record<string, any> = {}): Promise<McpToolCallResult> {
  try {
    const memoryResult = await executeMemoryMcpTool(name, args);
    if (memoryResult) {
      return memoryResult;
    }

    switch (name) {
      case "ai_chat": {
        const prompt = String(args.prompt || "");
        const model = args.model ? String(args.model) : "auto";
        const isJson = Boolean(args.json);
        const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];

        if (args.system) {
          messages.push({ role: "system", content: String(args.system) });
        }
        messages.push({ role: "user", content: prompt });

        const res = await FastInferenceDispatcher.dispatch({
          model,
          messages,
          response_format: isJson ? { type: "json_object" } : undefined,
        });

        const outputText = res.choices[0]?.message.content || "";
        return {
          content: [
            {
              type: "text",
              text: `[Model: ${res.model} | ID: ${res.id}]\n\n${outputText}`,
            },
          ],
        };
      }

      case "ai_fleet_stats": {
        const stats = keyPoolManager.getStats();
        const swarm = swarmSmoother.getStats();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ gateway: "Fast Multi-Tier Gateway", status: "operational", keyPools: stats, swarm }, null, 2),
            },
          ],
        };
      }

      case "ai_dag_workflow": {
        const objective = String(args.objective || "");
        const tenantId = await ensureDefaultTenant();
        const steps = [
          {
            stepKey: "research_step",
            name: "1. Core Research",
            stepType: "model_inference",
            dependencies: [],
            inputPayload: { prompt: `Research and outline core concepts for: "${objective}"` },
          },
          {
            stepKey: "analysis_a",
            name: "2a. Technical Architecture",
            stepType: "model_inference",
            dependencies: ["research_step"],
            inputPayload: { prompt: `Analyze technical architecture & tradeoffs for: "${objective}"` },
          },
          {
            stepKey: "analysis_b",
            name: "2b. Reliability Analysis",
            stepType: "model_inference",
            dependencies: ["research_step"],
            inputPayload: { prompt: `Analyze failure recovery & checkpoints for: "${objective}"` },
          },
          {
            stepKey: "synthesis_join",
            name: "3. Synthesis Join",
            stepType: "model_inference",
            dependencies: ["analysis_a", "analysis_b"],
            inputPayload: { prompt: `Synthesize a comprehensive, executive answer for: "${objective}"` },
          },
        ];

        const dagResult = await executionEngine.createDAGTask({
          tenantId,
          taskType: "dag_workflow",
          steps,
          initialPayload: { objective },
          requirements: { allowPaid: false },
          policy: { allowPaid: false, maxAttemptsPerStep: 3 },
          priority: 10,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "enqueued",
                taskId: dagResult.taskId,
                planId: dagResult.planId,
                totalSteps: steps.length,
                message: "DAG task enqueued in PostgreSQL and claimed by worker pool.",
              }, null, 2),
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (err: any) {
    return {
      content: [{ type: "text", text: `Error executing tool '${name}': ${err?.message || String(err)}` }],
      isError: true,
    };
  }
}

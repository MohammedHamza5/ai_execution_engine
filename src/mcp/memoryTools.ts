import { McpToolDefinition, McpToolCallResult } from "./types.js";
import { embeddingsDispatcher } from "../engine/fastGateway/embeddingsDispatcher.js";
import { vectorMemory } from "../memory/vectorMemory.js";

export const MCP_MEMORY_TOOLS: McpToolDefinition[] = [
  {
    name: "ai_memory_store",
    description: "Store persistent cognitive memory in swarm vector store with 1024-dim BGE embeddings across isolated agent namespaces.",
    inputSchema: {
      type: "object",
      properties: {
        namespace: { type: "string", description: "Agent or project namespace (e.g. 'forma-canvas', 'pulse-health', 'market-intel', 'swarm-shared')." },
        content: { type: "string", description: "Text content, fact, code snippet, or analysis to store." },
        metadata: { type: "object", description: "Optional metadata object." },
      },
      required: ["namespace", "content"],
    },
  },
  {
    name: "ai_memory_search",
    description: "Semantic search across persistent cognitive memory using cosine similarity to recall relevant knowledge.",
    inputSchema: {
      type: "object",
      properties: {
        namespace: { type: "string", description: "Agent or project namespace to query." },
        query: { type: "string", description: "Natural language query to find semantically relevant memories." },
        topK: { type: "number", description: "Maximum number of relevant results (default: 5)." },
        minScore: { type: "number", description: "Minimum cosine similarity score (0.0 to 1.0, default: 0.1)." },
      },
      required: ["namespace", "query"],
    },
  },
];

export async function executeMemoryMcpTool(name: string, args: Record<string, any>): Promise<McpToolCallResult | null> {
  if (name === "ai_memory_store") {
    const namespace = String(args.namespace || "default");
    const content = String(args.content || "");
    const metadata = args.metadata && typeof args.metadata === "object" ? args.metadata : {};

    const embResult = await embeddingsDispatcher.getEmbeddings(content);
    const record = await vectorMemory.store(namespace, content, embResult.embeddings[0], metadata);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "stored",
            id: record.id,
            namespace: record.namespace,
            content: record.content,
            metadata: record.metadata,
            createdAt: record.createdAt,
          }, null, 2),
        },
      ],
    };
  }

  if (name === "ai_memory_search") {
    const namespace = String(args.namespace || "default");
    const query = String(args.query || "");
    const topK = typeof args.topK === "number" ? args.topK : 5;
    const minScore = typeof args.minScore === "number" ? args.minScore : -1.0;

    const embResult = await embeddingsDispatcher.getEmbeddings(query);
    const matches = await vectorMemory.search(namespace, embResult.embeddings[0], topK, minScore);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            namespace,
            query,
            totalMatches: matches.length,
            matches: matches.map((m) => ({
              id: m.id,
              content: m.content,
              score: m.score,
              metadata: m.metadata,
              createdAt: m.createdAt,
            })),
          }, null, 2),
        },
      ],
    };
  }

  return null;
}

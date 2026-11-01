import readline from "node:readline";
import dotenv from "dotenv";
dotenv.config();
import { applyPlatformNetworkPolicy } from "../config/networkPolicy.js";

// Apply platform network policies before opening connections
applyPlatformNetworkPolicy();

import { JsonRpcRequest, JsonRpcResponse } from "./types.js";
import { MCP_TOOLS, executeMcpTool } from "./tools.js";

export class McpStdioServer {
  private rl: readline.Interface;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });
  }

  public start(): void {
    this.rl.on("line", async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const req: JsonRpcRequest = JSON.parse(trimmed);
        const res = await this.handleMessage(req);
        if (res) {
          process.stdout.write(JSON.stringify(res) + "\n");
        }
      } catch (err: any) {
        const errRes: JsonRpcResponse = {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: `Parse error: ${err?.message || "Invalid JSON"}` },
        };
        process.stdout.write(JSON.stringify(errRes) + "\n");
      }
    });

    // Handle shutdown
    process.on("SIGINT", () => this.stop());
    process.on("SIGTERM", () => this.stop());
  }

  public stop(): void {
    this.rl.close();
    process.exit(0);
  }

  public async handleMessage(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const id = req.id ?? null;

    // Notifications (requests without an id) do not expect a response
    if (req.method === "notifications/initialized") {
      return null;
    }

    switch (req.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: {
              name: "ai-execution-engine",
              version: "0.1.0",
            },
          },
        };

      case "ping":
        return { jsonrpc: "2.0", id, result: {} };

      case "tools/list":
        return {
          jsonrpc: "2.0",
          id,
          result: { tools: MCP_TOOLS },
        };

      case "tools/call": {
        const toolName = req.params?.name;
        const toolArgs = req.params?.arguments || {};
        if (!toolName) {
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "Missing tool name in tools/call" },
          };
        }
        const toolResult = await executeMcpTool(toolName, toolArgs);
        return {
          jsonrpc: "2.0",
          id,
          result: toolResult,
        };
      }

      default:
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method '${req.method}' not found` },
        };
    }
  }
}

// When executed directly via CLI
if (process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js")) {
  const server = new McpStdioServer();
  server.start();
}

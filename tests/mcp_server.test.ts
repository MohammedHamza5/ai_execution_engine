import { describe, it, expect, beforeAll } from "vitest";
import dotenv from "dotenv";
dotenv.config();
import { McpStdioServer } from "../src/mcp/server.js";
import { MCP_TOOLS } from "../src/mcp/tools.js";

describe("Model Context Protocol (MCP) Server Tests", () => {
  let server: McpStdioServer;

  beforeAll(() => {
    server = new McpStdioServer();
  });

  it("handles initialize method and returns MCP capabilities", async () => {
    const res = await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05" },
    });

    expect(res).toBeDefined();
    expect(res?.id).toBe(1);
    expect(res?.result.protocolVersion).toBe("2024-11-05");
    expect(res?.result.serverInfo.name).toBe("ai-execution-engine");
    expect(res?.result.capabilities.tools).toBeDefined();
  });

  it("handles ping method", async () => {
    const res = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "ping",
    });

    expect(res?.id).toBe(2);
    expect(res?.result).toEqual({});
  });

  it("handles tools/list and returns all registered MCP tools", async () => {
    const res = await server.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/list",
    });

    expect(res?.id).toBe(3);
    const tools = res?.result.tools;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBe(MCP_TOOLS.length);

    const toolNames = tools.map((t: any) => t.name);
    expect(toolNames).toContain("ai_chat");
    expect(toolNames).toContain("ai_fleet_stats");
    expect(toolNames).toContain("ai_dag_workflow");
  });

  it("executes ai_fleet_stats tool via tools/call", async () => {
    const res = await server.handleMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "ai_fleet_stats",
        arguments: {},
      },
    });

    expect(res?.id).toBe(4);
    expect(res?.result.content).toBeDefined();
    expect(res?.result.content[0].type).toBe("text");
    const parsed = JSON.parse(res?.result.content[0].text);
    expect(parsed.gateway).toBe("Fast Multi-Tier Gateway");
    expect(parsed.status).toBe("operational");
    expect(parsed.keyPools).toBeDefined();
  });

  it("executes ai_chat tool via tools/call with fast inference", async () => {
    const res = await server.handleMessage({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "ai_chat",
        arguments: {
          prompt: "What is 10 + 10? Reply with only the number.",
          model: "auto",
        },
      },
    });

    expect(res?.id).toBe(5);
    expect(res?.result.isError).toBeFalsy();
    expect(res?.result.content).toBeDefined();
    const text = res?.result.content[0].text;
    expect(text).toContain("Model:");
  });

  it("executes ai_chat tool with json: true and returns valid response", async () => {
    const res = await server.handleMessage({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "ai_chat",
        arguments: {
          prompt: "Return a JSON object with keys greeting (string) and version (number)",
          json: true,
        },
      },
    });

    expect(res?.id).toBe(6);
    expect(res?.result.isError).toBeFalsy();
    const text = res?.result.content[0].text;
    expect(text).toContain("Model:");
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      expect(parsed).toBeDefined();
    }
  });

  it("returns error result when calling an unknown tool", async () => {
    const res = await server.handleMessage({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "non_existent_tool",
        arguments: {},
      },
    });

    expect(res?.id).toBe(7);
    expect(res?.result.isError).toBe(true);
    expect(res?.result.content[0].text).toContain("Unknown tool");
  });

  it("returns -32601 error for unknown JSON-RPC method", async () => {
    const res = await server.handleMessage({
      jsonrpc: "2.0",
      id: 8,
      method: "unknown_method",
    });

    expect(res?.id).toBe(8);
    expect(res?.error?.code).toBe(-32601);
  });
});

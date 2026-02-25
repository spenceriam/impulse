import { describe, expect, test } from "bun:test";
import { MCPDiscovery } from "../src/mcp/discovery";
import type { MCPTool } from "../src/mcp/types";

describe("MCP discovery example formatting", () => {
  test("generates direct tool invocation format", () => {
    const tool: MCPTool = {
      server: "web-search",
      name: "webSearchPrime",
      description: "Search the web",
      inputSchema: {
        type: "object",
        properties: {
          search_query: { type: "string" },
          max_results: { type: "number" },
        },
        required: ["search_query"],
      },
    };

    const example = MCPDiscovery.generateExampleCall(tool);
    expect(example.startsWith("webSearchPrime(")).toBe(true);
    expect(example.includes("mcp_call")).toBe(false);
  });
});

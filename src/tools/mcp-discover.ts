/**
 * MCP Discover Tool
 * 
 * Allows the AI to discover available MCP tools without loading
 * all tool descriptions into the context window upfront.
 * 
 * Usage:
 * - search: Find tools matching a query
 * - details: Get full details for a specific tool
 * - list: List all tools on a server
 */

import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { MCPDiscovery } from "../mcp/discovery";
import { MCPServerName } from "../mcp/types";

const MCPDiscoverSchema = z.object({
  action: z.enum(["search", "details", "list"]).describe(
    "Action to perform: 'search' to find tools, 'details' for tool info, 'list' for all tools on a server"
  ),
  query: z.string().optional().describe(
    "Search query (for 'search' action)"
  ),
  server: z.string().optional().describe(
    "Server name (for 'details' or 'list' action): vision, web-search, web-reader, zread, context7"
  ),
  tool: z.string().optional().describe(
    "Tool name (for 'details' action)"
  ),
});

type MCPDiscoverArgs = z.infer<typeof MCPDiscoverSchema>;

async function execute(args: MCPDiscoverArgs): Promise<ToolResult> {
  const { action, query, server, tool } = args;

  switch (action) {
    case "search": {
      if (!query) {
        return { success: false, output: "Error: 'query' is required for search action" };
      }

      const results = await MCPDiscovery.search(query, 10);

      if (results.length === 0) {
        return { success: true, output: `No tools found matching "${query}"` };
      }

      const lines = [`Found ${results.length} tools matching "${query}":\n`];
      for (const result of results) {
        const score = Math.round(result.score * 100);
        lines.push(`[${score}%] ${result.tool.server}/${result.tool.name}`);
        lines.push(`     ${result.tool.description}\n`);
      }

      return { success: true, output: lines.join("\n") };
    }

    case "details": {
      if (!server || !tool) {
        return { success: false, output: "Error: 'server' and 'tool' are required for details action" };
      }

      const validServers: MCPServerName[] = ["vision", "web-search", "web-reader", "zread", "context7"];
      if (!validServers.includes(server as MCPServerName)) {
        return { success: false, output: `Error: Unknown server '${server}'. Valid: ${validServers.join(", ")}` };
      }

      const toolInfo = await MCPDiscovery.getTool(server as MCPServerName, tool);

      if (!toolInfo) {
        const serverTools = await MCPDiscovery.getServerTools(server as MCPServerName);
        const toolNames = serverTools.map(t => t.name).join(", ");
        return { success: false, output: `Error: Tool '${tool}' not found in ${server}\nAvailable: ${toolNames}` };
      }

      const details = MCPDiscovery.formatToolDetails(toolInfo);
      const example = MCPDiscovery.generateExampleCall(toolInfo);

      return { success: true, output: `${details}\n\nExample:\n  ${example}` };
    }

    case "list": {
      if (!server) {
        // List all servers
        const allTools = await MCPDiscovery.getAllTools();
        const byServer = new Map<string, number>();

        for (const t of allTools) {
          byServer.set(t.server, (byServer.get(t.server) || 0) + 1);
        }

        const lines = ["MCP Servers Available:\n"];
        for (const [s, count] of byServer) {
          lines.push(`  ${s.padEnd(14)} ${count} tools`);
        }

        return { success: true, output: lines.join("\n") };
      }

      const validServers: MCPServerName[] = ["vision", "web-search", "web-reader", "zread", "context7"];
      if (!validServers.includes(server as MCPServerName)) {
        return { success: false, output: `Error: Unknown server '${server}'. Valid: ${validServers.join(", ")}` };
      }

      const serverTools = await MCPDiscovery.getServerTools(server as MCPServerName);

      if (serverTools.length === 0) {
        return { success: true, output: `No tools available for ${server}` };
      }

      const lines = [`Tools for ${server}:\n`];
      for (const t of serverTools) {
        lines.push(`  ${t.name}`);
        lines.push(`    ${t.description}\n`);
      }

      return { success: true, output: lines.join("\n") };
    }

    default:
      return { success: false, output: `Error: Unknown action '${action}'` };
  }
}

// Auto-register on import
export const mcpDiscoverTool = Tool.define(
  "mcp_discover",
  "Discover MCP tools. Use search, list, or details. See docs/tools/mcp-discover.md.",
  MCPDiscoverSchema,
  execute
);

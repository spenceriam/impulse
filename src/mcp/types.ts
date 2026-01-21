/**
 * MCP Server Types
 */

export type MCPServerName = "vision" | "web-search" | "web-reader" | "zread" | "context7";

export type MCPConnectionStatus = "connected" | "failed" | "disabled";

export interface MCPServerConfig {
  name: MCPServerName;
  type: "stdio" | "http";
  url?: string;
  executable?: string;
}

/**
 * MCP Tool Schema - follows JSON Schema format used by MCP
 */
export interface MCPToolInputSchema {
  type: "object";
  properties?: Record<string, {
    type: string;
    description?: string;
    enum?: string[];
    default?: unknown;
  }>;
  required?: string[];
}

/**
 * MCP Tool Definition - full tool metadata
 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: MCPToolInputSchema;
  server: MCPServerName;
}

/**
 * MCP Server with full tool metadata
 */
export interface MCPServer {
  config: MCPServerConfig;
  status: MCPConnectionStatus;
  error?: string;
  tools: string[];          // Tool names only (backwards compat)
  toolMetadata?: MCPTool[]; // Full tool metadata when fetched
}

/**
 * Search result from MCP tool discovery
 */
export interface MCPToolSearchResult {
  tool: MCPTool;
  score: number;  // Relevance score 0-1
  matchedOn: "name" | "description" | "both";
}

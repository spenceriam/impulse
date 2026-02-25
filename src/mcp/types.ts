/**
 * MCP Server Types
 */

export type MCPServerName = "vision" | "web-search" | "web-reader" | "zread" | "context7";

export type MCPConnectionStatus = "connected" | "failed" | "disabled";

export interface MCPServerConfig {
  name: MCPServerName;
  type: "stdio" | "http";
  url?: string;
  // For stdio servers
  executable?: string;      // Legacy: standalone executable name
  command?: string;         // Command to run (e.g., "npx")
  args?: string[];          // Arguments to pass (e.g., ["-y", "@z_ai/mcp-server"])
  env?: Record<string, string>;  // Environment variables
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
  sessionId?: string;       // HTTP MCP session ID (Mcp-Session-Id header)
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

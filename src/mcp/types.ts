/**
 * MCP Server Types
 */

export type MCPServerName = "vision" | "web-search" | "web-reader" | "zread";

export type MCPConnectionStatus = "connected" | "failed" | "disabled";

export interface MCPServerConfig {
  name: MCPServerName;
  type: "stdio" | "http";
  url?: string;
  executable?: string;
}

export interface MCPServer {
  config: MCPServerConfig;
  status: MCPConnectionStatus;
  error?: string;
  tools: string[];
}

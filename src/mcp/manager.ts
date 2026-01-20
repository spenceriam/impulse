import { load } from "../util/config";
import { MCPServer, MCPServerConfig, MCPServerName } from "./types";

/**
 * MCP Manager
 * Manages all 4 MCP servers with single API key configuration
 */
export class MCPManager {
  private servers: Map<MCPServerName, MCPServer> = new Map();
  private initialized = false;

  constructor() {
    this.initialize();
  }

  /**
   * Initialize all MCP servers on startup
   */
  private async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const config = await load();
    const apiKey = config.apiKey;
    if (!apiKey) {
      console.error("MCP Manager: No API key configured");
      return;
    }

    // Define all 4 MCP server configurations
    const serverConfigs: MCPServerConfig[] = [
      {
        name: "vision",
        type: "stdio",
        executable: "mcp-server-vision",
      },
      {
        name: "web-search",
        type: "http",
        url: "https://api.z.ai/mcp/web-search",
      },
      {
        name: "web-reader",
        type: "http",
        url: "https://api.z.ai/mcp/web-reader",
      },
      {
        name: "zread",
        type: "http",
        url: "https://api.z.ai/mcp/zread",
      },
    ];

    // Initialize each server
    for (const serverConfig of serverConfigs) {
      await this.initializeServer(serverConfig, apiKey);
    }

    this.initialized = true;
    console.log("MCP Manager: All servers initialized");
  }

  /**
   * Initialize a single MCP server
   */
  private async initializeServer(
    config: MCPServerConfig,
    apiKey: string
  ): Promise<void> {
    const server: MCPServer = {
      config,
      status: "connected",
      tools: [],
    };

    try {
      // Different initialization based on server type
      if (config.type === "http") {
        await this.initializeHTTPServer(server, apiKey);
      } else if (config.type === "stdio") {
        await this.initializeStdioServer(server, apiKey);
      }

      this.servers.set(config.name, server);
    } catch (error) {
      server.status = "failed";
      server.error = error instanceof Error ? error.message : String(error);
      this.servers.set(config.name, server);
      console.error(`MCP Manager: Failed to initialize ${config.name}:`, error);
    }
  }

  /**
   * Initialize HTTP-based MCP server
   */
  private async initializeHTTPServer(
    server: MCPServer,
    _apiKey: string
  ): Promise<void> {
    const { url } = server.config;
    if (!url) {
      throw new Error("HTTP server requires URL");
    }

    // TODO: Implement actual HTTP connection
    // For now, just mark as connected with mock tools
    if (server.config.name === "web-search") {
      server.tools = ["webSearchPrime"];
    } else if (server.config.name === "web-reader") {
      server.tools = ["webReader"];
    } else if (server.config.name === "zread") {
      server.tools = ["search_doc", "get_repo_structure", "read_file"];
    }
  }

  /**
   * Initialize stdio-based MCP server
   */
  private async initializeStdioServer(
    server: MCPServer,
    _apiKey: string
  ): Promise<void> {
    const { executable } = server.config;
    if (!executable) {
      throw new Error("stdio server requires executable");
    }

    // TODO: Implement actual stdio process spawning
    // For now, just mark as connected with mock tools
    if (server.config.name === "vision") {
      server.tools = [
        "ui_to_artifact",
        "extract_text_from_screenshot",
        "diagnose_error_screenshot",
        "understand_technical_diagram",
        "analyze_data_visualization",
        "ui_diff_check",
        "image_analysis",
        "video_analysis",
      ];
    }
  }

  /**
   * Get server status by name
   */
  public getServer(name: MCPServerName): MCPServer | undefined {
    return this.servers.get(name);
  }

  /**
   * Get all servers
   */
  public getAllServers(): MCPServer[] {
    return Array.from(this.servers.values());
  }

  /**
   * Get connected servers
   */
  public getConnectedServers(): MCPServer[] {
    return this.getAllServers().filter(
      (server) => server.status === "connected"
    );
  }

  /**
   * Get connection status summary
   */
  public getConnectionSummary(): {
    total: number;
    connected: number;
    failed: number;
  } {
    const servers = this.getAllServers();
    return {
      total: servers.length,
      connected: servers.filter((s) => s.status === "connected").length,
      failed: servers.filter((s) => s.status === "failed").length,
    };
  }
}

/**
 * Singleton MCP Manager instance
 */
export const mcpManager = new MCPManager();

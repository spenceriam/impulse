import { load } from "../util/config";
import { MCPServer, MCPServerConfig, MCPServerName } from "./types";

// Timeout for health checks (ms)
const HEALTH_CHECK_TIMEOUT = 5000;

/**
 * MCP Manager
 * Manages all 5 MCP servers with single API key configuration
 */
export class MCPManager {
  private servers: Map<MCPServerName, MCPServer> = new Map();
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
    // Don't auto-initialize in constructor - let it be lazy
  }

  /**
   * Ensure the manager is initialized (call this before using)
   */
  public async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    
    this.initPromise = this.initialize();
    await this.initPromise;
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

    // Define all 5 MCP server configurations
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
      {
        name: "context7",
        type: "http",
        url: "https://mcp.context7.com/mcp",
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
   * Initialize HTTP-based MCP server with health check
   */
  private async initializeHTTPServer(
    server: MCPServer,
    apiKey: string
  ): Promise<void> {
    const { url } = server.config;
    if (!url) {
      throw new Error("HTTP server requires URL");
    }

    // Define expected tools for each server
    const toolsByServer: Record<string, string[]> = {
      "web-search": ["webSearchPrime"],
      "web-reader": ["webReader"],
      "zread": ["search_doc", "get_repo_structure", "read_file"],
      "context7": ["resolve-library-id", "query-docs"],
    };

    // Set expected tools (these are known ahead of time)
    server.tools = toolsByServer[server.config.name] || [];

    // Perform health check - try to reach the server
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT);

      // Build headers - Z.AI servers need API key, Context7 doesn't
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      
      if (server.config.name !== "context7") {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      // MCP uses JSON-RPC 2.0 - send an "initialize" or "tools/list" request
      // For a simple health check, we'll try a tools/list request
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // Non-2xx response - server reachable but rejected
        // This could be auth issue, but server is "up"
        // For Z.AI servers, a 401 means we need valid API key
        if (response.status === 401 || response.status === 403) {
          throw new Error(`Authentication failed (${response.status})`);
        }
        // For other errors, consider it a partial success (server is reachable)
        // MCP servers may not support tools/list on all endpoints
      }

      // Server responded - mark as connected
      server.status = "connected";
    } catch (error) {
      // Network error, timeout, or auth failure
      if (error instanceof Error) {
        if (error.name === "AbortError") {
          throw new Error("Connection timeout");
        }
        throw error;
      }
      throw new Error("Connection failed");
    }
  }

  /**
   * Initialize stdio-based MCP server
   * Checks if the executable is available in PATH
   */
  private async initializeStdioServer(
    server: MCPServer,
    _apiKey: string
  ): Promise<void> {
    const { executable } = server.config;
    if (!executable) {
      throw new Error("stdio server requires executable");
    }

    // Define expected tools for vision server
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

    // Check if executable exists using `which`
    try {
      const proc = Bun.spawn(["which", executable], {
        stdout: "pipe",
        stderr: "pipe",
      });
      
      const exitCode = await proc.exited;
      
      if (exitCode !== 0) {
        throw new Error(`Executable '${executable}' not found in PATH`);
      }

      server.status = "connected";
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to check executable: ${String(error)}`);
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
   * Note: If not yet initialized, triggers initialization in background
   * and returns "checking" state (0 connected, 0 failed)
   */
  public getConnectionSummary(): {
    total: number;
    connected: number;
    failed: number;
  } {
    // Trigger initialization if not started
    if (!this.initialized && !this.initPromise) {
      this.ensureInitialized();
    }

    const servers = this.getAllServers();
    
    // If no servers yet (still initializing), return expected total with 0 status
    if (servers.length === 0) {
      return {
        total: 5, // We expect 5 MCP servers
        connected: 0,
        failed: 0,
      };
    }

    return {
      total: servers.length,
      connected: servers.filter((s) => s.status === "connected").length,
      failed: servers.filter((s) => s.status === "failed").length,
    };
  }

  /**
   * Check if manager is initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }
}

/**
 * Singleton MCP Manager instance
 */
export const mcpManager = new MCPManager();

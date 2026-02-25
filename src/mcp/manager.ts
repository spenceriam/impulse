import { load } from "../util/config";
import { MCPServer, MCPServerConfig, MCPServerName } from "./types";

// Timeout for health checks (ms)
const HEALTH_CHECK_TIMEOUT = 5000;

// Timeout for tool calls (ms)
const TOOL_CALL_TIMEOUT = 60000;

const MCP_SESSION_HEADER = "Mcp-Session-Id";
const ZAI_HTTP_SESSION_SERVERS = new Set<MCPServerName>(["web-search", "web-reader", "zread"]);

// JSON-RPC response type
interface JSONRPCResponse<T = unknown> {
  jsonrpc: "2.0";
  id: number | string;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// MCP tool call result
interface MCPToolCallResult {
  content: Array<{
    type: "text" | "image" | "resource";
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

/**
 * Parse response that may be SSE or plain JSON
 * Z.AI MCP servers return SSE format: id:N\nevent:message\ndata:{json}
 * Context7 returns plain JSON
 */
function parseSSEOrJSON<T>(text: string): T {
  // Check if it's SSE format (starts with "id:" or "event:")
  if (text.startsWith("id:") || text.startsWith("event:")) {
    // Parse SSE - extract JSON from "data:" line
    const lines = text.split("\n");
    for (const line of lines) {
      if (line.startsWith("data:")) {
        const jsonStr = line.slice(5).trim();
        if (jsonStr) {
          return JSON.parse(jsonStr) as T;
        }
      }
    }
    throw new Error("SSE response missing data line");
  }
  // Plain JSON
  return JSON.parse(text) as T;
}

/**
 * MCP Manager
 * Manages all 5 MCP servers with single API key configuration
 */
export class MCPManager {
  private servers: Map<MCPServerName, MCPServer> = new Map();
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private waitingForApiKey = false;  // True if init was skipped due to no API key

  constructor() {
    // Don't auto-initialize in constructor - let it be lazy
  }

  /**
   * Check if waiting for API key before initialization can proceed
   */
  public isWaitingForApiKey(): boolean {
    return this.waitingForApiKey;
  }

  /**
   * Reset state to allow re-initialization after API key is set
   */
  public resetForNewApiKey(): void {
    this.waitingForApiKey = false;
    this.initialized = false;
    this.initPromise = null;
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
      console.error("MCP Manager: No API key configured, waiting...");
      this.waitingForApiKey = true;
      return;
    }
    
    this.waitingForApiKey = false;

    // Define all 5 MCP server configurations
    // Vision MCP uses npx to run @z_ai/mcp-server package
    // HTTP MCPs connect to Z.AI remote endpoints
    // Z.AI URL format: https://api.z.ai/api/mcp/<server_name>/mcp
    // Note: Tool name is web_search_prime (per Z.AI docs)
    const serverConfigs: MCPServerConfig[] = [
      {
        name: "vision",
        type: "stdio",
        command: "npx",
        args: ["-y", "@z_ai/mcp-server"],
        env: {
          Z_AI_API_KEY: apiKey,
          Z_AI_MODE: "ZAI",
        },
      },
      {
        name: "web-search",
        type: "http",
        url: "https://api.z.ai/api/mcp/web_search_prime/mcp",
      },
      {
        name: "web-reader",
        type: "http",
        url: "https://api.z.ai/api/mcp/web_reader/mcp",
      },
      {
        name: "zread",
        type: "http",
        url: "https://api.z.ai/api/mcp/zread/mcp",
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

  private buildHTTPHeaders(
    serverName: MCPServerName,
    apiKey: string | undefined,
    sessionId?: string
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    };

    if (serverName !== "context7" && apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    if (sessionId) {
      headers[MCP_SESSION_HEADER] = sessionId;
    }

    return headers;
  }

  private updateSessionIdFromResponse(server: MCPServer, response: Response): void {
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) {
      server.sessionId = sessionId;
    }
  }

  private isSessionRetryableFailure(server: MCPServer, statusCode: number | undefined, message: string): boolean {
    if (!ZAI_HTTP_SESSION_SERVERS.has(server.config.name)) {
      return false;
    }

    if (statusCode === 401 || statusCode === 403) {
      return true;
    }

    const lower = message.toLowerCase();
    return (
      lower.includes("apikey not found") ||
      lower.includes("session") ||
      lower.includes("unauthorized") ||
      lower.includes("forbidden")
    );
  }

  private async refreshHTTPSession(server: MCPServer, apiKey: string | undefined): Promise<boolean> {
    const { url } = server.config;
    if (!url) {
      return false;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: this.buildHTTPHeaders(server.config.name, apiKey, server.sessionId),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "tools/list",
          params: {},
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      this.updateSessionIdFromResponse(server, response);
      return response.ok;
    } catch {
      clearTimeout(timeoutId);
      return false;
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

      // MCP uses JSON-RPC 2.0 - send an "initialize" or "tools/list" request
      // For a simple health check, we'll try a tools/list request
      const response = await fetch(url, {
        method: "POST",
        headers: this.buildHTTPHeaders(server.config.name, apiKey, server.sessionId),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      this.updateSessionIdFromResponse(server, response);

      if (!response.ok) {
        // Non-2xx response - check specific error codes
        if (response.status === 401 || response.status === 403) {
          throw new Error(`Authentication failed (${response.status})`);
        }
        if (response.status === 404) {
          throw new Error(`Endpoint not found (404) - check URL: ${url}`);
        }
        if (response.status >= 500) {
          throw new Error(`Server error (${response.status})`);
        }
        // For other 4xx errors, throw with status
        throw new Error(`HTTP error ${response.status}`);
      }

      // Verify the response is valid JSON-RPC
      // Z.AI servers return SSE format, Context7 returns plain JSON
      try {
        const text = await response.text();
        const data = parseSSEOrJSON<{ error?: { message?: string } }>(text);
        if (data.error) {
          // JSON-RPC error response - still consider connected but log warning
          console.warn(`MCP ${server.config.name}: JSON-RPC error in health check: ${data.error.message || "unknown"}`);
        }
      } catch {
        // Response wasn't valid SSE or JSON - might not be an MCP endpoint
        throw new Error(`Invalid response from ${url} - not a valid MCP endpoint`);
      }

      // Server responded with valid JSON - mark as connected
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
   * Supports two patterns:
   * 1. command + args (e.g., npx -y @z_ai/mcp-server)
   * 2. executable (legacy standalone executable)
   */
  private async initializeStdioServer(
    server: MCPServer,
    _apiKey: string
  ): Promise<void> {
    const { command, executable } = server.config;

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

    // Pattern 1: command + args (e.g., npx -y @z_ai/mcp-server)
    if (command) {
      try {
        // Check if the command exists (e.g., npx)
        const proc = Bun.spawn(["which", command], {
          stdout: "pipe",
          stderr: "pipe",
        });
        
        const exitCode = await proc.exited;
        
        if (exitCode !== 0) {
          throw new Error(`Command '${command}' not found in PATH`);
        }

        // For npx, also verify node version >= 22
        if (command === "npx") {
          const nodeProc = Bun.spawn(["node", "--version"], {
            stdout: "pipe",
            stderr: "pipe",
          });
          
          const nodeOutput = await new Response(nodeProc.stdout).text();
          const nodeVersion = nodeOutput.trim();
          const majorVersion = parseInt(nodeVersion.replace("v", "").split(".")[0] || "0", 10);
          
          if (majorVersion < 22) {
            throw new Error(`Node.js >= 22 required for Vision MCP (found ${nodeVersion})`);
          }
        }

        server.status = "connected";
      } catch (error) {
        if (error instanceof Error) {
          throw error;
        }
        throw new Error(`Failed to check command: ${String(error)}`);
      }
      return;
    }

    // Pattern 2: Legacy standalone executable
    if (executable) {
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
      return;
    }

    throw new Error("stdio server requires either 'command' or 'executable'");
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
    waitingForApiKey: boolean;
  } {
    // Trigger initialization if not started and not waiting for API key
    if (!this.initialized && !this.initPromise && !this.waitingForApiKey) {
      this.ensureInitialized();
    }

    const servers = this.getAllServers();
    
    // If waiting for API key, return special state
    if (this.waitingForApiKey) {
      return {
        total: 5,
        connected: 0,
        failed: 0,
        waitingForApiKey: true,
      };
    }
    
    // If no servers yet (still initializing), return expected total with 0 status
    if (servers.length === 0) {
      return {
        total: 5, // We expect 5 MCP servers
        connected: 0,
        failed: 0,
        waitingForApiKey: false,
      };
    }

    return {
      total: servers.length,
      connected: servers.filter((s) => s.status === "connected").length,
      failed: servers.filter((s) => s.status === "failed").length,
      waitingForApiKey: false,
    };
  }

  /**
   * Check if manager is initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Call an MCP tool
   * Handles both HTTP and stdio servers
   */
  public async callTool(
    serverName: MCPServerName,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ success: boolean; output: string }> {
    await this.ensureInitialized();

    const server = this.servers.get(serverName);
    if (!server) {
      return {
        success: false,
        output: `MCP server not found: ${serverName}`,
      };
    }

    if (server.status !== "connected") {
      return {
        success: false,
        output: `MCP server not connected: ${serverName} (${server.error || "unknown error"})`,
      };
    }

    try {
      if (server.config.type === "http") {
        return await this.callHTTPTool(server, toolName, args);
      } else if (server.config.type === "stdio") {
        return await this.callStdioTool(server, toolName, args);
      } else {
        return {
          success: false,
          output: `Unsupported server type: ${server.config.type}`,
        };
      }
    } catch (error) {
      return {
        success: false,
        output: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Call tool on HTTP MCP server using JSON-RPC 2.0
   */
  private async callHTTPTool(
    server: MCPServer,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ success: boolean; output: string }> {
    const { url } = server.config;
    if (!url) {
      return { success: false, output: "HTTP server requires URL" };
    }

    const config = await load();
    const apiKey = config.apiKey;

    const callOnce = async (): Promise<{ success: boolean; output: string; sessionRetryable: boolean }> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TOOL_CALL_TIMEOUT);

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: this.buildHTTPHeaders(server.config.name, apiKey, server.sessionId),
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: Date.now(),
            method: "tools/call",
            params: {
              name: toolName,
              arguments: args,
            },
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        this.updateSessionIdFromResponse(server, response);

        if (!response.ok) {
          const text = await response.text();
          return {
            success: false,
            output: `HTTP ${response.status}: ${text}`,
            sessionRetryable: this.isSessionRetryableFailure(server, response.status, text),
          };
        }

        const text = await response.text();
        const data = parseSSEOrJSON<JSONRPCResponse<MCPToolCallResult>>(text);

        if (data.error) {
          return {
            success: false,
            output: `MCP error: ${data.error.message}`,
            sessionRetryable: this.isSessionRetryableFailure(server, data.error.code, data.error.message),
          };
        }

        if (!data.result) {
          return {
            success: false,
            output: "MCP returned empty result",
            sessionRetryable: false,
          };
        }

        const textContent = data.result.content
          ?.filter((c) => c.type === "text" && c.text)
          .map((c) => c.text)
          .join("\n");

        return {
          success: !data.result.isError,
          output: textContent || "Tool executed successfully (no output)",
          sessionRetryable: false,
        };
      } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof Error && error.name === "AbortError") {
          return { success: false, output: "Tool call timed out", sessionRetryable: false };
        }
        throw error;
      }
    };

    const firstAttempt = await callOnce();
    if (!firstAttempt.success && firstAttempt.sessionRetryable) {
      const refreshed = await this.refreshHTTPSession(server, apiKey);
      if (refreshed) {
        const retryAttempt = await callOnce();
        return {
          success: retryAttempt.success,
          output: retryAttempt.output,
        };
      }
    }

    return {
      success: firstAttempt.success,
      output: firstAttempt.output,
    };
  }

  /**
   * Call tool on stdio MCP server
   * Spawns the process and communicates via stdin/stdout JSON-RPC
   */
  private async callStdioTool(
    server: MCPServer,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ success: boolean; output: string }> {
    const { command, args: cmdArgs, env } = server.config;

    if (!command) {
      return { success: false, output: "Stdio server requires command" };
    }

    const config = await load();
    const apiKey = config.apiKey;

    // Build environment with API key
    const processEnv = {
      ...process.env,
      ...env,
    };

    if (apiKey && server.config.name === "vision") {
      processEnv["Z_AI_API_KEY"] = apiKey;
    }

    try {
      // Spawn the MCP server process
      const proc = Bun.spawn([command, ...(cmdArgs || [])], {
        env: processEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });

      // Send JSON-RPC request via stdin
      const request = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: toolName,
          arguments: args,
        },
      }) + "\n";

      proc.stdin.write(request);
      proc.stdin.end();

      // Read response from stdout
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      // Wait for process to exit
      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        return {
          success: false,
          output: stderr || `Process exited with code ${exitCode}`,
        };
      }

      // Parse JSON-RPC response
      const lines = stdout.trim().split("\n");
      const lastLine = lines[lines.length - 1];

      if (!lastLine) {
        return { success: false, output: "No response from MCP server" };
      }

      const data = JSON.parse(lastLine) as JSONRPCResponse<MCPToolCallResult>;

      if (data.error) {
        return {
          success: false,
          output: `MCP error: ${data.error.message}`,
        };
      }

      if (!data.result) {
        return { success: false, output: "MCP returned empty result" };
      }

      // Extract text content
      const textContent = data.result.content
        ?.filter((c) => c.type === "text" && c.text)
        .map((c) => c.text)
        .join("\n");

      return {
        success: !data.result.isError,
        output: textContent || "Tool executed successfully (no output)",
      };
    } catch (error) {
      return {
        success: false,
        output: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Find which server hosts a given tool
   */
  public findToolServer(toolName: string): MCPServerName | undefined {
    for (const [name, server] of this.servers) {
      if (server.tools.includes(toolName)) {
        return name;
      }
    }
    return undefined;
  }
}

/**
 * Singleton MCP Manager instance
 */
export const mcpManager = new MCPManager();

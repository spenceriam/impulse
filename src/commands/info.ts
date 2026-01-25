import { CommandRegistry, CommandDefinition } from "./registry";
import { SessionManager } from "../session/manager";
import { mcpManager } from "../mcp/manager";
import { MCPDiscovery } from "../mcp/discovery";
import { MCPServerName } from "../mcp/types";
import { load as loadConfig } from "../util/config";

async function handleStats() {
  const session = SessionManager.getCurrentSession();

  if (!session) {
    return {
      success: false,
      error: "No active session",
    };
  }

  const messageCount = session.messages.length;
  const completedTodos = session.todos.filter((t) => t.status === "completed").length;
  const totalTodos = session.todos.length;
  const checkpoints = 0;

  const stats = [
    `Session: ${session.name}`,
    `ID: ${session.id}`,
    `Model: ${session.model}`,
    `Mode: ${session.mode}`,
    `Messages: ${messageCount}`,
    `Todos: ${completedTodos}/${totalTodos} completed`,
    `Checkpoints: ${checkpoints}`,
    `Cost: $${session.cost.toFixed(2)}`,
    `Created: ${session.created_at}`,
    `Updated: ${session.updated_at}`,
  ];

  return {
    success: true,
    output: stats.join("\n"),
  };
}

async function handleHelp() {
  const lines: string[] = [
    "IMPULSE Quick Reference",
    "",
    "IMPULSE is an AI coding agent powered by GLM models. Use natural language",
    "to build, debug, and explore codebases with full tool access.",
    "",
    "MODES (Tab to cycle)",
    "─".repeat(78),
    `${"MODE".padEnd(12)}${"COLOR".padEnd(10)}DESCRIPTION`,
    "",
    `${"AUTO".padEnd(12)}${"Gray".padEnd(10)}AI analyzes your prompt and selects the best mode`,
    `${"".padEnd(12)}${"".padEnd(10)}Tools: Switches dynamically based on task`,
    "",
    `${"EXPLORE".padEnd(12)}${"Green".padEnd(10)}Read-only understanding - patient, curious, anticipatory`,
    `${"".padEnd(12)}${"".padEnd(10)}Tools: Read-only + web research (no modifications)`,
    "",
    `${"AGENT".padEnd(12)}${"Cyan".padEnd(10)}Full execution mode with file editing and code generation`,
    `${"".padEnd(12)}${"".padEnd(10)}Tools: All tools available`,
    "",
    `${"PLANNER".padEnd(12)}${"Purple".padEnd(10)}Research and documentation - explores without modifying`,
    `${"".padEnd(12)}${"".padEnd(10)}Tools: Read-only + docs/`,
    "",
    `${"PLAN-PRD".padEnd(12)}${"Blue".padEnd(10)}Quick PRD generation via interactive Q&A`,
    `${"".padEnd(12)}${"".padEnd(10)}Tools: Read-only + docs/`,
    "",
    `${"DEBUG".padEnd(12)}${"Orange".padEnd(10)}Systematic 7-step debugging methodology`,
    `${"".padEnd(12)}${"".padEnd(10)}Tools: All tools available`,
    "",
    "STATUS LINE INDICATORS",
    "─".repeat(78),
    `${"(Thinking)".padEnd(24)}AI is using extended reasoning (GLM-4.7 feature)`,
    `${"[EXPRESS]".padEnd(24)}Express mode - all permissions auto-approved (orange)`,
    `${"[████░░░░] 45%".padEnd(24)}Context window usage - auto-compacts at 70%`,
    `${"MCP: ●".padEnd(24)}Green=connected, Yellow=initializing, Red=failures`,
    "",
    "KEYBOARD SHORTCUTS",
    "─".repeat(78),
    `${"Tab / Shift+Tab".padEnd(24)}Cycle modes forward/backward`,
    `${"Ctrl+P".padEnd(24)}Command palette`,
    `${"Ctrl+M".padEnd(24)}MCP status overlay`,
    `${"Ctrl+B".padEnd(24)}Toggle sidebar`,
    `${"Esc (2x)".padEnd(24)}Cancel/stop generation`,
    `${"Ctrl+C (2x)".padEnd(24)}Exit with summary`,
    "",
    "COMMANDS",
    "─".repeat(78),
    `${"/new".padEnd(14)}New session${"".padEnd(10)}${"/model".padEnd(14)}Switch model`,
    `${"/save".padEnd(14)}Save session${"".padEnd(9)}${"/mode".padEnd(14)}Switch mode`,
    `${"/load".padEnd(14)}Load session${"".padEnd(9)}${"/mcp".padEnd(14)}MCP server status`,
    `${"/compact".padEnd(14)}Summarize context${"".padEnd(4)}${"/stats".padEnd(14)}Session statistics`,
    `${"/quit".padEnd(14)}Exit with summary${"".padEnd(4)}${"/express".padEnd(14)}Toggle express mode`,
  ];

  return {
    success: true,
    output: lines.join("\n"),
  };
}

async function handleConfig() {
  return {
    success: true,
    output: "Config command not yet implemented",
  };
}

async function handleInstruct() {
  return {
    success: true,
    output: "Instruct command not yet implemented",
  };
}

// Column widths for /mcp command alignment
const MCP_STATUS_COL = 8;
const MCP_NAME_COL = 14;
const MCP_TYPE_COL = 8;
// Wider error column to show full messages (was truncating at 35 chars)
const MCP_ERROR_MAX = 60;

// ============================================================================
// /usage command - Check Z.AI Coding Plan quota and usage
// ============================================================================

interface UsageLimit {
  type?: string;         // API uses "type" field (TIME_LIMIT, TOKENS_LIMIT)
  limitType?: string;    // Fallback field name
  usage?: number;        // Total allocation
  currentValue?: number; // Currently used
  remaining?: number;    // Available
  percentage?: number;   // Usage percentage (0-100)
  nextResetTime?: number; // Unix timestamp (ms or s)
  usageDetails?: Array<{ modelCode: string; usage: number }>; // Per-model breakdown
}

interface UsageData {
  timeLimit?: UsageLimit;   // TIME_LIMIT - API calls/requests
  tokensLimit?: UsageLimit; // TOKENS_LIMIT - token usage
  checkedAt: string;
}

// Format number with commas: 1234567 -> "1,234,567"
function formatNumber(num: number): string {
  return new Intl.NumberFormat("en-US").format(num);
}

// Format relative time: timestamp -> "in 9h 30m" or "Expired"
function formatRelativeTime(timestampMs: number): string {
  const now = Date.now();
  const diff = timestampMs - now;
  
  if (diff <= 0) return "Expired";
  
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  
  if (hours > 0) {
    return `in ${hours}h ${mins}m`;
  }
  return `in ${mins}m`;
}

// Format timestamp to UTC datetime string
function formatDateTimeUTC(timestampMs: number): string {
  return new Date(timestampMs).toLocaleString("en-US", {
    month: "2-digit", 
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }) + " UTC";
}

// Format timestamp to local datetime string with timezone abbreviation
function formatDateTimeLocal(timestampMs: number): string {
  const date = new Date(timestampMs);
  
  // Get local time string
  const localTime = date.toLocaleString("en-US", {
    month: "2-digit", 
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  
  // Get timezone abbreviation (e.g., "PST", "EST", "CST")
  const tzAbbr = date.toLocaleString("en-US", { timeZoneName: "short" }).split(" ").pop() || "";
  
  return `${localTime} ${tzAbbr}`;
}

async function fetchUsageData(apiKey: string): Promise<UsageData> {
  const url = "https://api.z.ai/api/monitor/usage/quota/limit";
  
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json() as Record<string, unknown>;
  
  // Check for API error in response body (Z.AI returns 200 with error in body)
  if (data["success"] === false || data["code"] === 401) {
    const msg = (data["msg"] as string) || "Authentication failed";
    throw new Error(msg);
  }
  
  // Flexible discovery of limits array (API may return in different structures)
  let limits: UsageLimit[] = [];
  
  // Check data.data.limits or data.data.Limits (case-insensitive)
  const inner = data["data"] as Record<string, unknown> | unknown[] | undefined;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    for (const key of Object.keys(inner)) {
      if (key.toLowerCase() === "limits" && Array.isArray(inner[key])) {
        limits = inner[key] as UsageLimit[];
        break;
      }
    }
  } else if (Array.isArray(inner)) {
    limits = inner as UsageLimit[];
  }
  
  // Fallback: check data.limits directly
  if (limits.length === 0 && data && typeof data === "object") {
    for (const key of Object.keys(data)) {
      if (key.toLowerCase() === "limits" && Array.isArray(data[key])) {
        limits = data[key] as UsageLimit[];
        break;
      }
    }
  }
  
  // Parse limits into structured data
  const result: UsageData = {
    checkedAt: new Date().toLocaleString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit", 
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }),
  };
  
  for (const item of limits) {
    // API uses "type" field, fallback to "limitType" for compatibility
    const limitType = item.type || item.limitType || "";
    
    if (limitType === "TIME_LIMIT" || limitType === "PROMPTS_LIMIT") {
      result.timeLimit = item;
    } else if (limitType === "TOKENS_LIMIT") {
      result.tokensLimit = item;
    }
  }
  
  return result;
}

async function handleUsage(): Promise<{ success: boolean; output?: string; error?: string }> {
  try {
    const config = await loadConfig();
    
    if (!config.apiKey) {
      return {
        success: false,
        error: "API key not configured. Set GLM_API_KEY environment variable or configure in ~/.config/impulse/config.json",
      };
    }
    
    const usage = await fetchUsageData(config.apiKey);
    
    const lines: string[] = [
      `Checked: ${usage.checkedAt}`,
      "",
    ];
    
    // API Calls / Time Limit section
    if (usage.timeLimit) {
      const t = usage.timeLimit;
      const total = t.usage || 0;
      const used = t.currentValue || 0;
      const remaining = t.remaining ?? (total - used);
      const percentage = t.percentage || 0;
      
      lines.push("API CALLS");
      lines.push("─".repeat(50));
      lines.push(`Remaining    ${formatNumber(remaining).padEnd(12)} / ${formatNumber(total).padEnd(12)} ${percentage}% used`);
      
      // Show per-model breakdown if available
      if (t.usageDetails && t.usageDetails.length > 0) {
        const activeModels = t.usageDetails.filter(d => d.usage > 0);
        if (activeModels.length > 0) {
          lines.push("");
          lines.push("  By Model:");
          for (const detail of activeModels) {
            lines.push(`    ${detail.modelCode.padEnd(16)} ${formatNumber(detail.usage)}`);
          }
        }
      }
      lines.push("");
    }
    
    // Tokens section - focus on consumed/allotted and reset time
    if (usage.tokensLimit) {
      const t = usage.tokensLimit;
      const allotted = t.usage || 0;
      const consumed = t.currentValue || 0;
      const remaining = t.remaining ?? (allotted - consumed);
      const percentage = t.percentage || Math.round((consumed / allotted) * 100) || 0;
      const resetTs = t.nextResetTime || 0;
      
      lines.push("TOKENS (5-hour window)");
      lines.push("─".repeat(50));
      
      // Main display: consumed / allotted with percentage
      const consumedStr = formatNumber(consumed);
      const allottedStr = formatNumber(allotted);
      lines.push(`Consumed     ${consumedStr} / ${allottedStr} (${percentage}%)`);
      lines.push(`Remaining    ${formatNumber(remaining)}`);
      
      // Reset time - this is the key info
      if (resetTs > 0) {
        // Handle both seconds and milliseconds timestamps
        const tsMs = resetTs > 1e11 ? resetTs : resetTs * 1000;
        const utcStr = formatDateTimeUTC(tsMs);
        const localStr = formatDateTimeLocal(tsMs);
        const relativeStr = formatRelativeTime(tsMs);
        lines.push("");
        lines.push(`Resets       ${relativeStr}`);
        lines.push(`             ${utcStr}`);
        lines.push(`             ${localStr}`);
      }
      lines.push("");
    }
    
    // No data found
    if (!usage.timeLimit && !usage.tokensLimit) {
      lines.push("No usage data found.");
      lines.push("This may indicate a new account or API issue.");
    }
    
    return {
      success: true,
      output: lines.join("\n"),
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}



async function handleMcp() {
  const servers = mcpManager.getAllServers();
  const summary = mcpManager.getConnectionSummary();
  
  // If no servers yet (still initializing)
  if (servers.length === 0) {
    return {
      success: true,
      output: "MCP servers initializing...\n\nExpected: 5 servers\nStatus: Checking connections",
    };
  }

  // Build status output for each server with aligned columns
  const lines: string[] = [
    `MCP Server Status (${summary.connected}/${summary.total} connected)`,
    "",
    // Header row
    `${"STATUS".padEnd(MCP_STATUS_COL)}${"SERVER".padEnd(MCP_NAME_COL)}${"TYPE".padEnd(MCP_TYPE_COL)}INFO`,
  ];

  for (const server of servers) {
    const statusIcon = server.status === "connected" ? "[OK]" : "[FAIL]";
    const name = server.config.name.padEnd(MCP_NAME_COL);
    const type = server.config.type.padEnd(MCP_TYPE_COL);
    
    let info = "";
    if (server.status === "failed" && server.error) {
      // Show more of the error message (increased from 35 to 60 chars)
      info = server.error.length > MCP_ERROR_MAX 
        ? server.error.slice(0, MCP_ERROR_MAX - 3) + "..." 
        : server.error;
    } else if (server.status === "connected") {
      info = `${server.tools.length} tools`;
    }
    
    lines.push(`${statusIcon.padEnd(MCP_STATUS_COL)}${name}${type}${info}`);
  }

  // Add summary
  lines.push("");
  if (summary.failed > 0) {
    lines.push(`Note: ${summary.failed} server(s) failed to connect.`);
    lines.push("Check API key and network connectivity.");
  } else {
    lines.push("All servers connected successfully.");
  }

  return {
    success: true,
    output: lines.join("\n"),
  };
}

async function handleMcpTools(args: string[]) {
  // Parse args: /mcp-tools [search <query>] | [<server>] | [<server> <tool>]
  
  if (args.length === 0) {
    // List all servers and tool counts
    const tools = await MCPDiscovery.getAllTools();
    const byServer = new Map<string, number>();
    
    for (const tool of tools) {
      byServer.set(tool.server, (byServer.get(tool.server) || 0) + 1);
    }
    
    const lines = ["MCP Tools Available:", ""];
    for (const [server, count] of byServer) {
      lines.push(`  ${server.padEnd(14)} ${count} tools`);
    }
    lines.push("");
    lines.push("Usage:");
    lines.push("  /mcp-tools search <query>    Search for tools");
    lines.push("  /mcp-tools <server>          List tools for server");
    lines.push("  /mcp-tools <server> <tool>   Show tool details");
    
    return { success: true, output: lines.join("\n") };
  }
  
  // Search mode
  if (args[0] === "search") {
    const query = args.slice(1).join(" ");
    if (!query) {
      return { success: false, error: "Usage: /mcp-tools search <query>" };
    }
    
    const results = await MCPDiscovery.search(query, 10);
    
    if (results.length === 0) {
      return { success: true, output: `No tools found matching "${query}"` };
    }
    
    const lines = [`Found ${results.length} tools matching "${query}":`, ""];
    for (const result of results) {
      const score = Math.round(result.score * 100);
      lines.push(`  [${score}%] ${result.tool.server}/${result.tool.name}`);
      lines.push(`       ${result.tool.description}`);
    }
    
    return { success: true, output: lines.join("\n") };
  }
  
  // Server-specific listing
  const serverName = args[0] as MCPServerName;
  const validServers: MCPServerName[] = ["vision", "web-search", "web-reader", "zread", "context7"];
  
  if (!validServers.includes(serverName)) {
    return { 
      success: false, 
      error: `Unknown server: ${serverName}\nValid servers: ${validServers.join(", ")}` 
    };
  }
  
  // If tool name provided, show details
  if (args.length >= 2) {
    const toolName = args[1] || "";
    const tool = await MCPDiscovery.getTool(serverName, toolName);
    
    if (!tool) {
      const serverTools = await MCPDiscovery.getServerTools(serverName);
      const toolNames = serverTools.map(t => t.name).join(", ");
      return { 
        success: false, 
        error: `Tool "${toolName}" not found in ${serverName}\nAvailable: ${toolNames}` 
      };
    }
    
    const details = MCPDiscovery.formatToolDetails(tool);
    const example = MCPDiscovery.generateExampleCall(tool);
    
    return { 
      success: true, 
      output: `${details}\n\nExample:\n  ${example}` 
    };
  }
  
  // List tools for server
  const serverTools = await MCPDiscovery.getServerTools(serverName);
  
  if (serverTools.length === 0) {
    return { success: true, output: `No tools available for ${serverName}` };
  }
  
  const lines = [`Tools for ${serverName}:`, ""];
  for (const tool of serverTools) {
    lines.push(`  ${tool.name}`);
    lines.push(`    ${tool.description}`);
  }
  
  return { success: true, output: lines.join("\n") };
}

export function registerInfoCommands(): void {
  const commands: CommandDefinition[] = [
    {
      name: "stats",
      category: "info",
      description: "Show session statistics",
      handler: handleStats,
      examples: ["/stats"],
    },
    {
      name: "help",
      category: "info",
      description: "Show available commands",
      handler: handleHelp,
      examples: ["/help"],
    },
    {
      name: "config",
      category: "info",
      description: "Open configuration settings",
      handler: handleConfig,
      examples: ["/config"],
    },
    {
      name: "instruct",
      category: "info",
      description: "Edit project instructions",
      handler: handleInstruct,
      examples: ["/instruct"],
    },
    {
      name: "mcp",
      category: "info",
      description: "Show MCP server status",
      handler: handleMcp,
      examples: ["/mcp"],
    },

    {
      name: "mcp-tools",
      category: "info",
      description: "Search and inspect MCP tools (internal)",
      hidden: true,  // Used by agent internally, not shown to users
      handler: (_args: Record<string, unknown>, rawInput?: string) => {
        // Parse args from raw input: "/mcp-tools search query" -> ["search", "query"]
        const parts = (rawInput || "").trim().split(/\s+/).slice(1);
        return handleMcpTools(parts);
      },
      examples: [
        "/mcp-tools",
        "/mcp-tools search web",
        "/mcp-tools vision",
        "/mcp-tools context7 query-docs",
      ],
    },
    {
      name: "start",
      category: "info",
      description: "Show welcome screen",
      handler: async () => {
        // Handled specially in App.tsx - returns signal to show overlay
        return { success: true, output: "__SHOW_START_OVERLAY__" };
      },
      examples: ["/start"],
    },
    {
      name: "todo",
      category: "info",
      description: "Show current todo list",
      handler: async () => {
        // Handled specially in App.tsx - returns signal to show todo overlay
        return { success: true, output: "__SHOW_TODO_OVERLAY__" };
      },
      examples: ["/todo"],
    },
    {
      name: "usage",
      category: "info",
      description: "Check Z.AI Coding Plan quota and usage",
      handler: handleUsage,
      examples: ["/usage"],
    },
  ];

  for (const command of commands) {
    CommandRegistry.register(command);
  }
}

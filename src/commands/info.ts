import { CommandRegistry, CommandDefinition } from "./registry";
import { SessionManager } from "../session/manager";
import { mcpManager } from "../mcp/manager";
import { MCPDiscovery } from "../mcp/discovery";
import { MCPServerName } from "../mcp/types";

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
  const commands = CommandRegistry.list();

  const byCategory = commands.reduce((acc, cmd) => {
    if (!acc[cmd.category]) {
      acc[cmd.category] = [];
    }
    const categoryCommands = acc[cmd.category];
    if (categoryCommands) {
      categoryCommands.push(cmd);
    }
    return acc;
  }, {} as Record<string, CommandDefinition[]>);

  let output = "Available commands:\n\n";

  for (const [category, cmds] of Object.entries(byCategory)) {
    if (!cmds) continue;
    output += `${category.toUpperCase()}:\n`;
    for (const cmd of cmds) {
      output += `  /${cmd.name.padEnd(10)} - ${cmd.description}\n`;
    }
    output += "\n";
  }

  return {
    success: true,
    output: output.trim(),
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

  // Build status output for each server
  const lines: string[] = [
    `MCP Server Status (${summary.connected}/${summary.total} connected)`,
    "",
  ];

  for (const server of servers) {
    const statusIcon = server.status === "connected" ? "[OK]" : "[FAIL]";
    const name = server.config.name.padEnd(12);
    const type = server.config.type.padEnd(5);
    
    let statusLine = `  ${statusIcon} ${name} (${type})`;
    
    // Add brief error info if failed
    if (server.status === "failed" && server.error) {
      // Truncate error to first 40 chars for brevity
      const shortError = server.error.length > 40 
        ? server.error.slice(0, 37) + "..." 
        : server.error;
      statusLine += ` - ${shortError}`;
    } else if (server.status === "connected") {
      statusLine += ` - ${server.tools.length} tools`;
    }
    
    lines.push(statusLine);
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
  ];

  for (const command of commands) {
    CommandRegistry.register(command);
  }
}

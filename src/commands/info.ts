import { CommandRegistry, CommandDefinition } from "./registry";
import { SessionManager } from "../session/manager";

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
  ];

  for (const command of commands) {
    CommandRegistry.register(command);
  }
}

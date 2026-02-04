import { z } from "zod";
import { CommandRegistry, CommandDefinition } from "./registry";
import { SessionManager } from "../session/manager";

const NewArgsSchema = z.object({
  name: z.string().optional(),
});

const SaveArgsSchema = z.object({
  name: z.string().optional(),
});

const ContinueArgsSchema = z.object({
  id: z.string().optional(),
});

async function handleNew(args: Record<string, unknown>) {
  const parsed = NewArgsSchema.parse(args);

  const session = await SessionManager.createNew(parsed.name);

  return {
    success: true,
    output: `Created new session: ${session.name} (${session.id})`,
  };
}

async function handleSave(args: Record<string, unknown>) {
  const parsed = SaveArgsSchema.parse(args);

  const session = await SessionManager.save(parsed.name);

  return {
    success: true,
    output: `Saved session: ${session.name} (${session.id})`,
  };
}

async function handleContinue(args: Record<string, unknown>) {
  const parsed = ContinueArgsSchema.parse(args);

  if (!parsed.id) {
    const sessions = await SessionManager.listSessions();

    if (sessions.length === 0) {
      return {
        success: false,
        error: "No saved sessions found",
      };
    }

    const list = sessions
      .map((s, i) => `${i + 1}. ${s.name} (${s.id})`)
      .join("\n");

    return {
      success: true,
      output: `Available sessions:\n${list}\n\nUse /continue <id> to continue a session (alias: /load)`,
    };
  }

  const session = await SessionManager.load(parsed.id);

  return {
    success: true,
    output: `Continued session: ${session.name} (${session.id})`,
  };
}

async function handleQuit() {
  const result = await SessionManager.exit();

  if (!result.session) {
    return {
      success: true,
      output: result.summary,
    };
  }

  return {
    success: true,
    output: `${result.summary}\n\nGoodbye!`,
  };
}

async function handleExit() {
  return await handleQuit();
}

async function handleClear() {
  // This is handled specially in App.tsx to reset the session
  // This handler is just a placeholder for the command registry
  return {
    success: true,
    output: "Session cleared (handled by UI)",
  };
}

export function registerCoreCommands(): void {
  const commands: CommandDefinition[] = [
    {
      name: "new",
      category: "core",
      description: "Create a new session",
      args: NewArgsSchema,
      handler: handleNew,
      examples: ["/new", "/new 'Refactor authentication'"],
    },
    {
      name: "save",
      category: "core",
      description: "Save the current session",
      args: SaveArgsSchema,
      handler: handleSave,
      examples: ["/save", "/save 'Fix API bug'"],
    },
    {
      name: "continue",
      category: "core",
      description: "Continue a saved session (alias: /load)",
      args: ContinueArgsSchema,
      handler: handleContinue,
      examples: ["/continue", "/continue sess_1234567890"],
    },
    {
      name: "load",
      category: "core",
      description: "Alias for /continue",
      args: ContinueArgsSchema,
      handler: handleContinue,
      examples: ["/load", "/load sess_1234567890"],
      hidden: true,
    },
    {
      name: "quit",
      category: "core",
      description: "Exit the application with session summary",
      handler: handleQuit,
      examples: ["/quit"],
    },
    {
      name: "exit",
      category: "core",
      description: "Exit the application with session summary",
      handler: handleExit,
      examples: ["/exit"],
    },
    {
      name: "clear",
      category: "core",
      description: "Clear the current session (same as /new)",
      handler: handleClear,
      examples: ["/clear"],
    },
  ];

  for (const command of commands) {
    CommandRegistry.register(command);
  }
}

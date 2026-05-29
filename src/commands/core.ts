import { z } from "zod";
import { CommandRegistry, CommandDefinition } from "./registry";
import { SessionManager } from "../session/manager";
import { sessionHasResumeableContent } from "../session/session-content.js";

const NewArgsSchema = z.object({
  name: z.string().optional(),
});

const SaveArgsSchema = z.object({
  name: z.string().optional(),
});

const ResumeArgsSchema = z.object({
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

async function handleResume(args: Record<string, unknown>) {
  const parsed = ResumeArgsSchema.parse(args);

  if (!parsed.id) {
    const sessions = (await SessionManager.listSessions()).filter(
      sessionHasResumeableContent
    );

    if (sessions.length === 0) {
      return {
        success: false,
        error: "No sessions with messages found for this project",
      };
    }

    const list = sessions
      .map((s, i) => {
        const title = s.headerTitle?.trim() || s.name;
        return `${i + 1}. ${title} (${s.id})`;
      })
      .join("\n");

    return {
      success: true,
      output: `Available sessions:\n${list}\n\nUse /resume <id> in the TUI or: impulse --resume <id>`,
    };
  }

  const session = await SessionManager.load(parsed.id);

  return {
    success: true,
    output: `Resumed session: ${session.name} (${session.id})`,
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
  return {
    success: true,
    output: "Use /clear in the CLI to clear the chat view (session history is preserved). Use /show to restore.",
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
      name: "resume",
      category: "core",
      description: "Resume a saved session",
      args: ResumeArgsSchema,
      handler: handleResume,
      examples: ["/resume", "/resume sess_1234567890"],
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
      description: "Clear the chat view in the CLI (history preserved; use /show to restore)",
      handler: handleClear,
      examples: ["/clear"],
    },
  ];

  for (const command of commands) {
    CommandRegistry.register(command);
  }
}

import z from "zod";

export type CommandCategory = "core" | "utility" | "info";

export interface CommandDefinition {
  name: string
  category: CommandCategory
  description: string
  args?: z.ZodSchema
  handler: CommandHandler
  examples?: string[]
}

export type CommandHandler = (args: Record<string, unknown>) => Promise<CommandResult>;

export interface CommandResult {
  success: boolean
  output?: string
  error?: string
  data?: unknown
}

export interface ParsedCommand {
  name: string
  args: string
  raw: string
}

class CommandRegistryImpl {
  private static instance: CommandRegistryImpl;
  private commands: Map<string, CommandDefinition> = new Map();

  private constructor() {}

  static getInstance(): CommandRegistryImpl {
    if (!CommandRegistryImpl.instance) {
      CommandRegistryImpl.instance = new CommandRegistryImpl();
    }
    return CommandRegistryImpl.instance;
  }

  register(definition: CommandDefinition): void {
    if (this.commands.has(definition.name)) {
      throw new Error(`Command already registered: ${definition.name}`);
    }

    this.commands.set(definition.name, definition);
  }

  unregister(name: string): boolean {
    return this.commands.delete(name);
  }

  get(name: string): CommandDefinition | undefined {
    return this.commands.get(name);
  }

  list(category?: CommandCategory): CommandDefinition[] {
    const allCommands = Array.from(this.commands.values());

    if (category) {
      return allCommands.filter((cmd) => cmd.category === category);
    }

    return allCommands;
  }

  parse(input: string): ParsedCommand | null {
    const trimmed = input.trim();

    if (!trimmed.startsWith("/")) {
      return null;
    }

    const withoutSlash = trimmed.slice(1);
    const firstSpace = withoutSlash.indexOf(" ");

    if (firstSpace === -1) {
      return {
        name: withoutSlash,
        args: "",
        raw: trimmed,
      };
    }

    return {
      name: withoutSlash.slice(0, firstSpace),
      args: withoutSlash.slice(firstSpace + 1),
      raw: trimmed,
    };
  }

  async execute(input: string): Promise<CommandResult> {
    const parsed = this.parse(input);

    if (!parsed) {
      return {
        success: false,
        error: "Invalid command format. Commands must start with /",
      };
    }

    const command = this.get(parsed.name);

    if (!command) {
      return {
        success: false,
        error: `Unknown command: /${parsed.name}. Type /help for available commands.`,
      };
    }

    try {
      let args: Record<string, unknown> = {};

      if (command.args && parsed.args) {
        const parsedArgs = this.parseArgs(parsed.args);

        try {
          args = command.args.parse(parsedArgs) as Record<string, unknown>;
        } catch (e) {
          if (e instanceof z.ZodError) {
            return {
              success: false,
              error: `Invalid arguments for /${command.name}: ${e.errors[0]?.message ?? "validation error"}`,
            };
          }
          throw e;
        }
      }

      const result = await command.handler(args);

      return result;
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  private parseArgs(argsString: string): Record<string, unknown> {
    const args: Record<string, unknown> = {};

    if (!argsString.trim()) {
      return args;
    }

    const parts = argsString.trim().split(/\s+/);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;

      if (part.startsWith("--")) {
        const key = part.slice(2);
        const nextPart = parts[i + 1];

        if (nextPart && !nextPart.startsWith("--")) {
          args[key] = nextPart;
          i++;
        } else {
          args[key] = true;
        }
      } else if (part.startsWith("-")) {
        const key = part.slice(1);
        const nextPart = parts[i + 1];

        if (nextPart && !nextPart.startsWith("-")) {
          args[key] = nextPart;
          i++;
        } else {
          args[key] = true;
        }
      } else {
        if (!args["_"]) {
          args["_"] = [];
        }
        (args["_"] as string[]).push(part);
      }
    }

    return args;
  }

  clear(): void {
    this.commands.clear();
  }
}

export const CommandRegistry = CommandRegistryImpl.getInstance();

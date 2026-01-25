import z from "zod";

export type CommandCategory = "core" | "utility" | "info";

export interface CommandDefinition {
  name: string
  aliases?: string[]  // Alternative names for the command (e.g., "details" for "verbose")
  category: CommandCategory
  description: string
  args?: z.ZodSchema
  handler: CommandHandler
  examples?: string[]
  hidden?: boolean  // Hidden from /help and autocomplete, but still executable
}

export type CommandHandler = (args: Record<string, unknown>, rawInput?: string) => Promise<CommandResult>;

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
    
    // Register aliases pointing to the same definition
    if (definition.aliases) {
      for (const alias of definition.aliases) {
        if (this.commands.has(alias)) {
          throw new Error(`Command alias already registered: ${alias}`);
        }
        this.commands.set(alias, definition);
      }
    }
  }

  unregister(name: string): boolean {
    const definition = this.commands.get(name);
    if (!definition) return false;
    
    // Remove aliases too
    if (definition.aliases) {
      for (const alias of definition.aliases) {
        this.commands.delete(alias);
      }
    }
    
    return this.commands.delete(name);
  }

  get(name: string): CommandDefinition | undefined {
    return this.commands.get(name);
  }

  list(category?: CommandCategory, includeHidden = false): CommandDefinition[] {
    let commands = Array.from(this.commands.values());
    
    // Filter out hidden commands unless explicitly requested
    if (!includeHidden) {
      commands = commands.filter((cmd) => !cmd.hidden);
    }

    if (category) {
      return commands.filter((cmd) => cmd.category === category);
    }

    return commands;
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

      const result = await command.handler(args, input);

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

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ToolDefinition } from "../api/types";
import type { MODES } from "../constants";
import { getCurrentMode } from "./mode-state";
import { validateToolInput } from "./input-repair";
import { buildRepairNote, prependToolNote } from "./tool-notes";
import {
  currentExecutionContext,
  isIsolatedMutationContext,
} from "../execution/context.js";

type Mode = typeof MODES[number];

export interface ToolResult {
  success: boolean;
  output: string;
  metadata?: Record<string, unknown>;
}

export interface Tool<TInput = unknown> {
  name: string;
  description: string;
  schema: z.ZodType<TInput, z.ZodTypeDef, unknown>;
  handler: (input: TInput) => Promise<ToolResult>;
  timeout: number | undefined;
}

export interface ToolExecutionOptions {
  callId?: string;
}

/**
 * Tool access categories by mode
 * 
 * - READ_ONLY: Available in ASK and AGENT (file_read, glob, grep, question, etc.)
 * - WRITE: Available only in AGENT, except session-only ASK capabilities
 */
type ToolCategory = "read_only" | "write" | "utility";

// Tool categorization for mode filtering
const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  // Read-only tools (all modes)
  file_read: "read_only",
  glob: "read_only",
  grep: "read_only",
  ls: "read_only",
  question: "read_only",
  execution_handoff: "read_only",
  todo_read: "read_only",
  set_header: "utility",
  set_mode: "utility",
  user_instructions: "write",
  web_fetch: "read_only",
  web_search: "read_only",
  tool_docs: "read_only",
  plan_revision: "utility",
  install_skill: "utility",
  skill_write: "utility",
  skill_remove: "utility",
  github_issue: "read_only",
  doctor: "read_only",
  project_validate: "read_only",
  semantic_search: "read_only",
  
  bg_output: "read_only",
  bg_kill: "write",

  // Project/session mutation tools
  file_write: "write",
  file_edit: "write",
  bash: "write",
  todo_write: "write",
  task: "write",
};

/**
 * Unknown tools default to write so ASK fails closed.
 */
function getToolCategory(toolName: string): ToolCategory {
  return TOOL_CATEGORIES[toolName] ?? "write";
}

function levenshteinDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 0; i < a.length; i++) {
    const current = [i + 1];

    for (let j = 0; j < b.length; j++) {
      const insertion = (current[j] ?? 0) + 1;
      const deletion = (previous[j + 1] ?? 0) + 1;
      const substitution = (previous[j] ?? 0) + (a[i] === b[j] ? 0 : 1);
      current[j + 1] = Math.min(insertion, deletion, substitution);
    }

    for (let j = 0; j < current.length; j++) {
      previous[j] = current[j] ?? 0;
    }
  }

  return previous[b.length] ?? a.length;
}

function findCloseMatches(name: string): string[] {
  const normalized = name.toLowerCase();

  const externalNames = currentExecutionContext()?.runtime
    ?.getToolProvider()
    ?.definitions(getCurrentMode())
    .map((definition) => definition.function.name) ?? [];
  return [...tools.keys(), ...externalNames]
    .map((toolName) => ({
      name: toolName,
      distance: levenshteinDistance(normalized, toolName.toLowerCase()),
    }))
    .filter((match) => match.distance <= 3)
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map((match) => match.name);
}

function isCategoryAllowedForMode(category: ToolCategory, mode: Mode, toolName: string): boolean {
  if (mode === "AGENT") return true;
  if (category === "read_only") return true;
  return toolName === "set_header" ||
    toolName === "set_mode" ||
    toolName === "todo_write" ||
    toolName === "task";
}

export function isToolAllowedForMode(name: string, mode: Mode): boolean {
  return isCategoryAllowedForMode(getToolCategory(name), mode, name);
}

function isToolAllowedForCurrentExecution(name: string, mode: Mode): boolean {
  if (isToolAllowedForMode(name, mode)) return true;
  return isIsolatedMutationContext() && ["file_write", "file_edit", "bash"].includes(name);
}

const tools = new Map<string, Tool<unknown>>();

export namespace Tool {
  export function define<TInput>(
    name: string,
    description: string,
    schema: z.ZodType<TInput, z.ZodTypeDef, unknown>,
    handler: (input: TInput) => Promise<ToolResult>,
    options?: { timeout?: number }
  ): Tool<TInput> {
    const tool: Tool<TInput> = {
      name,
      description,
      schema,
      handler,
      timeout: options?.timeout,
    };

    tools.set(name, tool as Tool<unknown>);
    return tool;
  }

  export function get(name: string): Tool | undefined {
    return tools.get(name);
  }

  export function getAll(): Tool[] {
    return Array.from(tools.values());
  }

  /**
   * Get all tools as API-compatible definitions (JSON Schema format)
   * for passing to provider streaming APIs.
   */
  export function getAPIDefinitions(): ToolDefinition[] {
    const builtIns = Array.from(tools.values()).map((tool) => {
      // Convert Zod schema to JSON Schema
      const jsonSchema = zodToJsonSchema(tool.schema, {
        $refStrategy: "none",
        target: "openApi3",
      });

      // Remove $schema key if present (API doesn't need it)
      const { $schema, ...parameters } = jsonSchema as Record<string, unknown>;

      return {
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: parameters as Record<string, unknown>,
        },
      };
    });
    const external = currentExecutionContext()?.runtime?.getToolProvider()?.definitions("AGENT") ?? [];
    return [...builtIns, ...external];
  }
  
  /**
   * Get tools allowed for a specific mode as API-compatible definitions
   * 
   * Mode restrictions:
   * - AGENT: All tools
   * - ASK: Read/research, questions, session-only updates, and explore subagents
   */
  export function getAPIDefinitionsForMode(mode: Mode): ToolDefinition[] {
    const builtIns = Array.from(tools.values())
      .filter((tool) => isToolAllowedForMode(tool.name, mode))
      .map((tool) => {
        // Convert Zod schema to JSON Schema
        const jsonSchema = zodToJsonSchema(tool.schema, {
          $refStrategy: "none",
          target: "openApi3",
        });

        // Remove $schema key if present (API doesn't need it)
        const { $schema, ...parameters } = jsonSchema as Record<string, unknown>;
        
        let description = tool.description;
        if (tool.name === "task" && mode === "ASK") {
          const restriction = "RESTRICTED: In ASK mode, only subagent_type=\"explore\" is allowed. For general/writing work, use execution_handoff so the user can preview safely, switch to AGENT, or stay in ASK.";
          description = `${restriction}\n\n${description}`;
        }

        return {
          type: "function" as const,
          function: {
            name: tool.name,
            description,
            parameters: parameters as Record<string, unknown>,
          },
        };
      });
    const external = currentExecutionContext()?.runtime?.getToolProvider()?.definitions(mode) ?? [];
    return [...builtIns, ...external];
  }

  export async function execute<TInput>(
    name: string,
    input: unknown,
    options: ToolExecutionOptions = {}
  ): Promise<ToolResult> {
    const tool = tools.get(name);
    const execution = currentExecutionContext();
    const externalProvider = execution?.runtime?.getToolProvider();
    const external = tool ? undefined : externalProvider?.descriptor(name);

    if (!tool && !external) {
      const suggestions = findCloseMatches(name);
      let errorMsg = `Tool not found: ${name}`;
      
      if (suggestions.length > 0) {
        errorMsg += `\n\nDid you mean: ${suggestions.join(", ")}?`;
      }
      
      errorMsg += "\n\nUse tool_docs(list=true) to see all available tools.";
      
      return {
        success: false,
        output: errorMsg,
      };
    }

    const currentMode = getCurrentMode();
    if (external) {
      if ((!external.readOnly && currentMode !== "AGENT") ||
          (!external.readOnly && execution?.runtime?.canMutate() !== true)) {
        return {
          success: false,
          output: `Tool "${name}" is not allowed in ${currentMode} mode. Ask the user to switch to AGENT before proceeding.`,
        };
      }
      if (!external.readOnly && execution?.runtime) {
        const decision = await execution.runtime.requestPermission({
          permission: "mcp",
          patterns: [name],
          message: `Run MCP tool ${external.title}`,
          metadata: {
            tool: name,
            ...(external.serverName ? { server: external.serverName } : {}),
            ...(external.originalName ? { originalTool: external.originalName } : {}),
          },
          tool: {
            messageID: execution.runtime.sessionId,
            callID: options.callId ?? name,
          },
        });
        if (decision !== "allow") {
          return {
            success: false,
            output: decision === "cancel"
              ? `MCP tool "${name}" was cancelled.`
              : `MCP tool "${name}" was rejected by the user.`,
          };
        }
        if (!execution.runtime.canMutate() || execution.signal?.aborted) {
          return {
            success: false,
            output: `MCP tool "${name}" was cancelled because AGENT authority was revoked.`,
          };
        }
      }
      return externalProvider!.execute(name, input, {
        ...(execution?.signal ? { signal: execution.signal } : {}),
      });
    }

    if (!tool) {
      return { success: false, output: `Tool not found: ${name}` };
    }

    if (!isToolAllowedForCurrentExecution(name, currentMode)) {
      return {
        success: false,
        output: `Tool "${name}" is not allowed in ${currentMode} mode. Ask the user to switch to AGENT before proceeding.`,
      };
    }

    try {
      const validation = validateToolInput(tool.schema, input, { toolName: name });
      if (!validation.success) {
        return {
          success: false,
          output: validation.error,
        };
      }
      const validated = validation.data;
      const repairNote = buildRepairNote(validation.repairs);

      if (tool.timeout) {
        const result = await withTimeout(
          tool.handler(validated as TInput),
          tool.timeout
        );
        return applyRepairNote(result, repairNote);
      } else {
        const result = await tool.handler(validated as TInput);
        return applyRepairNote(result, repairNote);
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          success: false,
          output: `Invalid parameters: ${error.errors
            .map((e) => `${e.path.join(".")}: ${e.message}`)
            .join(", ")}`,
        };
      }

      if (error instanceof Error) {
        return {
          success: false,
          output: error.message,
        };
      }

      return {
        success: false,
        output: String(error),
      };
    }
  }
}

/** Prepend the repair-transparency note to a tool result's output, if one applies. */
function applyRepairNote(result: ToolResult, repairNote: string | null): ToolResult {
  if (!repairNote) return result;
  return { ...result, output: prependToolNote(result.output, repairNote) };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Tool execution timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

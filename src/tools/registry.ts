import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ToolDefinition } from "../api/types";
import type { MODES } from "../constants";
import { getCurrentMode, isAutoApprovalGranted } from "./mode-state";

type Mode = typeof MODES[number];

export interface ToolResult {
  success: boolean;
  output: string;
  metadata?: Record<string, unknown>;
}

export interface Tool<TInput = unknown> {
  name: string;
  description: string;
  schema: z.ZodType<TInput>;
  handler: (input: TInput) => Promise<ToolResult>;
  timeout: number | undefined;
}

/**
 * Tool access categories by mode
 * 
 * - READ_ONLY: Available in all modes (file_read, glob, grep, question, etc.)
 * - WRITE: Only in execution modes (AGENT, DEBUG, AUTO)
 * - PLANNER_DOCS: Write tools available in PLANNER mode but restricted to docs/
 * - PRD_ONLY: Write tools available in PLAN-PRD mode but restricted to PRD.md
 */
type ToolCategory = "read_only" | "write" | "utility";

// Tool categorization for mode filtering
const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  // Read-only tools (all modes)
  file_read: "read_only",
  glob: "read_only",
  grep: "read_only",
  question: "read_only",
  todo_read: "read_only",
  set_header: "utility",
  mcp_discover: "read_only",
  tool_docs: "read_only",
  
  // Write tools (restricted in PLANNER/PLAN-PRD)
  file_write: "write",
  file_edit: "write",
  bash: "write",
  todo_write: "write",
  task: "write",
};

/**
 * Get tools allowed for a specific mode
 */
function getToolsForMode(mode: Mode): Set<string> {
  const allowed = new Set<string>();
  
  for (const [toolName, category] of Object.entries(TOOL_CATEGORIES)) {
    if (category === "read_only" || category === "utility") {
      // Read-only and utility tools available in all modes
      allowed.add(toolName);
    } else if (category === "write") {
      // Write tools only in execution modes
      if (mode === "AGENT" || mode === "DEBUG") {
        allowed.add(toolName);
      } else if (mode === "AUTO") {
        // AUTO mode requires explicit approval before enabling write tools
        if (isAutoApprovalGranted()) {
          allowed.add(toolName);
        }
      }
      // PLANNER and PLAN-PRD get file_write with restrictions (enforced in handler)
      else if (mode === "PLANNER" || mode === "PLAN-PRD") {
        // Allow file_write but the handler will enforce path restrictions
        if (toolName === "file_write") {
          allowed.add(toolName);
        }
        // Also allow todo tools for planning
        if (toolName === "todo_write") {
          allowed.add(toolName);
        }
      }
    }
  }
  
  return allowed;
}

export function isToolAllowedForMode(name: string, mode: Mode): boolean {
  return getToolsForMode(mode).has(name);
}

const tools = new Map<string, Tool<unknown>>();

export namespace Tool {
  export function define<TInput>(
    name: string,
    description: string,
    schema: z.ZodType<TInput>,
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
   * for passing to GLMClient.stream()
   */
  export function getAPIDefinitions(): ToolDefinition[] {
    return Array.from(tools.values()).map((tool) => {
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
  }
  
  /**
   * Get tools allowed for a specific mode as API-compatible definitions
   * 
   * Mode restrictions:
   * - AGENT, DEBUG, AUTO: All tools
   * - EXPLORE: Read-only tools only (no file_write, file_edit, bash, task)
   * - PLANNER: Read-only + file_write (restricted to docs/ in handler)
   * - PLAN-PRD: Read-only + file_write (restricted to PRD.md in handler)
   */
  export function getAPIDefinitionsForMode(mode: Mode): ToolDefinition[] {
    const allowedTools = getToolsForMode(mode);
    
    return Array.from(tools.values())
      .filter((tool) => allowedTools.has(tool.name))
      .map((tool) => {
        // Convert Zod schema to JSON Schema
        const jsonSchema = zodToJsonSchema(tool.schema, {
          $refStrategy: "none",
          target: "openApi3",
        });

        // Remove $schema key if present (API doesn't need it)
        const { $schema, ...parameters } = jsonSchema as Record<string, unknown>;
        
        // For PLANNER/PLAN-PRD, modify file_write description to note restrictions
        let description = tool.description;
        if (tool.name === "file_write" && (mode === "PLANNER" || mode === "PLAN-PRD")) {
          const restriction = mode === "PLANNER" 
            ? "RESTRICTED: Can only write to docs/ directory in PLANNER mode."
            : "RESTRICTED: Can only write PRD.md in PLAN-PRD mode.";
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
  }

  /**
   * Strip null values from an object (AI may send null for optional fields)
   * Zod's .optional() doesn't accept null, only undefined or absent
   */
  function stripNullValues(obj: unknown): unknown {
    if (obj === null || obj === undefined) return undefined;
    if (typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(stripNullValues);
    
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (value !== null && value !== undefined) {
        result[key] = stripNullValues(value);
      }
    }
    return result;
  }

  export async function execute<TInput>(
    name: string,
    input: unknown
  ): Promise<ToolResult> {
    const tool = tools.get(name);

    if (!tool) {
      return {
        success: false,
        output: `Tool not found: ${name}`,
      };
    }

    const currentMode = getCurrentMode();
    if (!isToolAllowedForMode(name, currentMode)) {
      if (currentMode === "AUTO" && TOOL_CATEGORIES[name] === "write" && !isAutoApprovalGranted()) {
        return {
          success: false,
          output: `AUTO mode requires a plan and explicit user approval before execution. Ask for approval with the question tool (context "AUTO_APPROVAL"), then proceed.`,
        };
      }
      return {
        success: false,
        output: `Tool "${name}" is not allowed in ${currentMode} mode. Switch to AGENT or DEBUG to proceed.`,
      };
    }

    try {
      // Strip null values before validation - AI may send null for optional fields
      const cleanedInput = stripNullValues(input);
      const validated = tool.schema.parse(cleanedInput);

      if (tool.timeout) {
        const result = await withTimeout(
          tool.handler(validated as TInput),
          tool.timeout
        );
        return result;
      } else {
        const result = await tool.handler(validated as TInput);
        return result;
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

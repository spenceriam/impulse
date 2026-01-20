import { z } from "zod";

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

    try {
      const validated = tool.schema.parse(input);

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

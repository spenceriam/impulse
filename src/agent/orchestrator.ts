import { Tool } from "../tools/registry";

export namespace Agent {
  export async function execute(toolName: string, input: unknown): Promise<string> {
    const tool = Tool.get(toolName);

    if (!tool) {
      return `Error: Tool not found: ${toolName}`;
    }

    const result = await Tool.execute(toolName, input);

    if (result.success) {
      return result.output;
    } else {
      return `Error: ${result.output}`;
    }
  }
}

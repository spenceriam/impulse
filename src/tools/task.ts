import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { readFileSync } from "fs";

const DESCRIPTION = readFileSync(
  new URL("./task.txt", import.meta.url),
  "utf-8"
);

const TaskSchema = z.object({
  prompt: z.string(),
  description: z.string(),
  subagent_type: z.enum(["explore", "general"]),
});

type TaskInput = z.infer<typeof TaskSchema>;

export const taskTool: Tool<TaskInput> = Tool.define(
  "task",
  DESCRIPTION,
  TaskSchema,
  async (input: TaskInput): Promise<ToolResult> => {
    try {
      let result: string;
      
      if (input.subagent_type === "explore") {
        result = `[Explore Agent]
Task: ${input.description}

${input.prompt}

Note: This would launch the explore subagent for fast codebase search and analysis.`;
      } else {
        result = `[General Agent]
Task: ${input.description}

${input.prompt}

Note: This would launch the general agent for complex multi-step tasks that can be parallelized.`;
      }

      return {
        success: true,
        output: result,
        metadata: {
          agentType: input.subagent_type,
          description: input.description,
        },
      };
    } catch (error) {
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
);

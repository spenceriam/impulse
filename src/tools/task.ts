import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { executeSubagent } from "../agent/task-runner.js";
import { formatTaskToolResultFromRun, type TaskCallSpec } from "../agent/task-pool.js";
import { getCurrentMode } from "./mode-state";

const DESCRIPTION = `Launch a subagent for delegated work.

Required: prompt, description, subagent_type. Optional: thoroughness (explore only), context.
Multiple task calls in one turn run in parallel (up to 8 concurrent; additional tasks queue).
See docs/tools/task.md for guidance and examples.`;

const TaskSchema = z.object({
  prompt: z.string(),
  description: z.string(),
  subagent_type: z.enum(["explore", "general"]),
  thoroughness: z.enum(["quick", "medium", "thorough"]).optional(),
  context: z.string().optional().describe("Bounded parent-session context to pass to the subagent"),
});

type TaskInput = z.infer<typeof TaskSchema>;

/** Re-exported for tests and CLI. */
export {
  extractArgSummary,
  formatSubagentToolLabel,
} from "../agent/task-runner.js";

/**
 * Direct single-task execution (used when not batched by the agent loop).
 * Batch permission and pooling are handled in loop.ts for normal turns.
 */
export const taskTool: Tool<TaskInput> = Tool.define(
  "task",
  DESCRIPTION,
  TaskSchema,
  async (input: TaskInput): Promise<ToolResult> => {
    try {
      const currentMode = getCurrentMode();
      if (currentMode === "PLAN" && input.subagent_type !== "explore") {
        return {
          success: false,
          output: `PLAN mode only allows explore subagents. Use subagent_type="explore" for research-only delegation.`,
        };
      }

      const prompt = input.context?.trim()
        ? `Parent context:\n${input.context.trim()}\n\nTask:\n${input.prompt}`
        : input.prompt;

      const run = await executeSubagent(
        input.subagent_type,
        prompt,
        input.description,
        input.thoroughness,
        { parentToolCallId: "standalone-task" }
      );

      const spec: Pick<TaskCallSpec, "subagentType" | "prompt" | "description" | "thoroughness"> = {
        subagentType: input.subagent_type,
        prompt,
        description: input.description,
      };
      if (input.thoroughness !== undefined) {
        spec.thoroughness = input.thoroughness;
      }
      return formatTaskToolResultFromRun(spec, run);
    } catch (error) {
      if (error instanceof Error) {
        return {
          success: false,
          output: `Subagent error: ${error.message}`,
        };
      }

      return {
        success: false,
        output: String(error),
      };
    }
  }
);

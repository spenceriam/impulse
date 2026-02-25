import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { Bus, ModeEvents } from "../bus";

/**
 * Valid modes the AI can switch to
 */
const VALID_MODES = ["WORK", "EXPLORE", "PLAN", "DEBUG"] as const;

/**
 * Tool description for AI
 */
const DESCRIPTION = `Switch to a different operating mode.

Required: mode. Optional: reason.
See docs/tools/set-mode.md for guidelines.`;

const SetModeSchema = z.object({
  mode: z
    .enum(VALID_MODES)
    .describe("The mode to switch to"),
  reason: z
    .string()
    .max(100)
    .optional()
    .describe("Brief explanation of why switching (shown to user)"),
});

type SetModeInput = z.infer<typeof SetModeSchema>;

export const setMode: Tool<SetModeInput> = Tool.define(
  "set_mode",
  DESCRIPTION,
  SetModeSchema,
  async (input: SetModeInput): Promise<ToolResult> => {
    try {
      const { mode, reason } = input;

      // Emit event for UI to pick up
      Bus.publish(ModeEvents.Changed, { mode, reason });

      const reasonText = reason ? ` (${reason})` : "";
      return {
        success: true,
        output: `Mode switched to ${mode}${reasonText}`,
        metadata: {
          mode,
          reason,
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

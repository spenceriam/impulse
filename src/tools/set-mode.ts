import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { Bus, ModeEvents } from "../bus";

/**
 * Valid modes the AI can switch to
 */
const VALID_MODES = ["AUTO", "EXPLORE", "AGENT", "PLANNER", "PLAN-PRD", "DEBUG"] as const;

/**
 * Tool description for AI
 */
const DESCRIPTION = `Switch to a different operating mode when the conversation context changes.

Available modes:
- AUTO: AI decides which mode to use (starts exploratory)
- EXPLORE: Read-only understanding - for research, questions, learning the codebase
- AGENT: Full execution - for implementing features, fixing bugs, making changes
- PLANNER: Research + documentation - for architecture, design docs, planning
- PLAN-PRD: Quick PRD via Q&A - for creating product requirement documents
- DEBUG: Systematic 7-step debugging - for finding and fixing bugs

When to switch modes:
- EXPLORE -> PLAN-PRD: User wants to build something simple, needs requirements
- EXPLORE -> PLANNER: Complex feature needs architecture/design
- EXPLORE -> DEBUG: User reports a bug or error
- PLAN-PRD -> AGENT: Requirements are clear, user approves, ready to implement
- PLANNER -> AGENT: Design complete, user approves, ready to implement
- Any -> EXPLORE: User says "wait, explain...", needs clarification

Guidelines:
- Always explain WHY you're switching modes in your response
- Don't switch modes too frequently - let conversations flow naturally
- When switching, the UI will create a new message block with the new mode color`;

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

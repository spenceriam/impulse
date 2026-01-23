import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { Bus, HeaderEvents } from "../bus";

/**
 * Maximum length for header title (context portion only, not including "[IMPULSE] | ")
 */
const MAX_TITLE_LENGTH = 50;

/**
 * Tool description for AI
 */
const DESCRIPTION = `Set the session header title to provide context about the current task or conversation.

The header appears at the top of the session screen as: "[IMPULSE] | <your title>"

Guidelines:
- Set at meaningful milestones (initial understanding, phase changes, focus shifts)
- Do NOT update constantly - only when context meaningfully changes
- Keep titles concise and descriptive (max ${MAX_TITLE_LENGTH} characters)
- Let the description naturally indicate the action

Good examples:
- "Express mode permission system"
- "React dashboard with authentication"
- "Fixing streaming display issue"
- "Code review of payment module"
- "Chat session"

Bad examples:
- "Working on stuff" (too vague)
- "I am currently in the process of helping you build..." (too long/verbose)
- Updating every few seconds (too frequent)`;

const SetHeaderSchema = z.object({
  title: z
    .string()
    .max(MAX_TITLE_LENGTH, `Title must be ${MAX_TITLE_LENGTH} characters or less`)
    .describe("Concise description of current task/conversation context"),
});

type SetHeaderInput = z.infer<typeof SetHeaderSchema>;

export const setHeader: Tool<SetHeaderInput> = Tool.define(
  "set_header",
  DESCRIPTION,
  SetHeaderSchema,
  async (input: SetHeaderInput): Promise<ToolResult> => {
    try {
      const title = input.title.trim();
      
      if (!title) {
        return {
          success: false,
          output: "Title cannot be empty",
        };
      }

      // Emit event for UI to pick up
      Bus.publish(HeaderEvents.Updated, { title });

      return {
        success: true,
        output: `Header updated to: [IMPULSE] | ${title}`,
        metadata: {
          title,
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

import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { Bus, HeaderEvents } from "../bus";
import { SessionManager } from "../session/manager.js";

/**
 * Maximum length for header title (context portion only, not including "[IMPULSE] | ")
 */
const MAX_TITLE_LENGTH = 50;

/**
 * Tool description for AI
 */
const DESCRIPTION = `Set the session header title.

Required: title (max ${MAX_TITLE_LENGTH} chars).
See docs/tools/set-header.md for guidelines.`;

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

      await SessionManager.setHeaderTitle(title);
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

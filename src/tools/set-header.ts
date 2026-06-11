import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { Bus, HeaderEvents } from "../bus";
import { SessionManager } from "../session/manager.js";
import { isWeakHeaderTitle } from "../util/header-title.js";

/**
 * Maximum length for header title (context portion only, not including "[impulse] | ")
 */
const MAX_TITLE_LENGTH = 60;

/**
 * Tool description for AI
 */
const DESCRIPTION = `Set the session header title for session management (/resume lists).

Required: title (max ${MAX_TITLE_LENGTH} chars) — short human description (e.g. "Math question", "API client refactor").
Do NOT use answer echoes, numbers only, or "# 625".
Use only on substantive work turns, not trivial Q&A.
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

      if (isWeakHeaderTitle(title)) {
        return {
          success: false,
          output:
            "Title must be a short descriptive phrase (e.g. 'Math question'), not an answer or number only.",
        };
      }

      const currentTitle = SessionManager.getCurrentSession()?.headerTitle;
      if (currentTitle === title) {
        return {
          success: true,
          output: "Header unchanged.",
          metadata: {
            title,
            unchanged: true,
          },
        };
      }

      await SessionManager.setHeaderTitle(title);
      Bus.publish(HeaderEvents.Updated, { title });

      return {
        success: true,
        output: `Header updated to: [impulse] | ${title}`,
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

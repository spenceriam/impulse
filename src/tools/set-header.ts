import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { Bus, HeaderEvents } from "../bus";
import { SessionManager } from "../session/manager.js";
import {
  applyTitlePolicy,
  TITLE_MAX_LENGTH,
  TITLE_MAX_WORDS,
  TITLE_MIN_WORDS,
} from "../util/title-policy.js";

/**
 * Tool description for AI
 */
const DESCRIPTION = `Set the session header title for session management (/resume lists).

Required: title (${TITLE_MIN_WORDS}-${TITLE_MAX_WORDS} words, max ${TITLE_MAX_LENGTH} chars) — a specific description of what this conversation is about (e.g. "Heartbeat reconnect loop", "DeepSeek model id fix").
Do NOT use answer echoes, numbers only, "# 625", or generic labels like "Code help" / "Question" / "Discussion".
Titles must be unique within the project; a collision is disambiguated automatically.
Use only on substantive work turns, not trivial Q&A.
See docs/tools/set-header.md for guidelines.`;

const SetHeaderSchema = z.object({
  title: z
    .string()
    .max(TITLE_MAX_LENGTH, `Title must be ${TITLE_MAX_LENGTH} characters or less`)
    .describe("Specific description of the current task/conversation (2-5 words)"),
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

      // Same policy the automatic generator uses (#139) — one gate, not two.
      const policy = applyTitlePolicy(title);
      if (!policy.ok) {
        return {
          success: false,
          output:
            policy.reason ??
            "Title must be a specific 2-5 word phrase (e.g. 'Heartbeat reconnect loop'), not a generic label, answer, or number.",
        };
      }

      const result = await SessionManager.setHeaderTitle(title, { source: "manual" });

      if (result.unchanged) {
        return {
          success: true,
          output: "Header unchanged.",
          metadata: {
            title: result.title,
            unchanged: true,
          },
        };
      }

      if (result.rejected) {
        return {
          success: false,
          output: result.reason ?? "Title rejected by policy.",
        };
      }

      Bus.publish(HeaderEvents.Updated, { title: result.title });

      return {
        success: true,
        output: result.disambiguated
          ? `Header updated to: [impulse] | ${result.title} (renamed to avoid a duplicate title in this project)`
          : `Header updated to: [impulse] | ${result.title}`,
        metadata: {
          title: result.title,
          ...(result.disambiguated ? { disambiguated: true } : {}),
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

import { z } from "zod";
import { invalidatePromptCache } from "../agent/prompts.js";
import { load as loadConfig } from "../util/config.js";
import {
  USER_INSTRUCTIONS_DISPLAY_PATH,
  loadEffectiveUserInstructions,
  resolveWorkspaceUserInstructionsImportPath,
  writeUserInstructions,
} from "../util/user-instructions.js";
import { Tool, type ToolResult } from "./registry.js";

const DESCRIPTION = `Read or update the user's persistent Impulse instructions.

The canonical file is ${USER_INSTRUCTIONS_DISPLAY_PATH}. This tool never writes anywhere else.

Use replace, append, import, or clear ONLY when the user explicitly asks to persist a change to their instructions. Merely mentioning a file or preference is not authorization.

Actions:
- read: return the current effective instructions and source
- replace: replace instructions with content
- append: append content as a new Markdown section
- import: replace instructions from a workspace file identified by source_path
- clear: intentionally clear persistent instructions

For replace, append, import, or clear, set explicit_intent=true only after confirming that intent in the user's request.

No allow-all mode or additional permission prompt is required for an explicit user-requested action.`;

const UserInstructionsSchema = z.object({
  action: z.enum(["read", "replace", "append", "import", "clear"]),
  content: z.string().optional().describe("Markdown content for replace or append"),
  source_path: z.string().optional().describe("Workspace file path for import; @path is accepted"),
  explicit_intent: z.boolean().optional().describe(
    "Must be true for writes after the user explicitly asked to persist this change"
  ),
});

type UserInstructionsInput = z.infer<typeof UserInstructionsSchema>;

export const userInstructionsTool: Tool<UserInstructionsInput> = Tool.define(
  "user_instructions",
  DESCRIPTION,
  UserInstructionsSchema,
  async (input: UserInstructionsInput): Promise<ToolResult> => {
    if (input.action === "read") {
      const config = await loadConfig({ refresh: true });
      const effective = await loadEffectiveUserInstructions(
        config.userProfile?.customInstructions
      );
      return {
        success: true,
        output: effective.content
          ? `User instructions (${effective.sourceLabel}):\n\n${effective.content}`
          : `No user instructions are set. Canonical path: ${USER_INSTRUCTIONS_DISPLAY_PATH}`,
        metadata: {
          action: input.action,
          source: effective.sourceLabel,
          chars: effective.content.length,
        },
      };
    }

    if (input.explicit_intent !== true) {
      return {
        success: false,
        output: "A persistent instruction change requires explicit user intent.",
      };
    }

    if (input.action === "replace" || input.action === "append") {
      if (input.content === undefined) {
        return { success: false, output: `${input.action} requires content.` };
      }
      const stored = await writeUserInstructions(input.action, input.content);
      invalidatePromptCache();
      return {
        success: true,
        output: `User instructions ${input.action === "replace" ? "replaced" : "appended"} at ${USER_INSTRUCTIONS_DISPLAY_PATH} (${stored.content.length} chars).`,
        metadata: { action: input.action, path: USER_INSTRUCTIONS_DISPLAY_PATH, chars: stored.content.length },
      };
    }

    if (input.action === "import") {
      if (!input.source_path?.trim()) {
        return { success: false, output: "import requires source_path." };
      }
      const cwd = process.cwd();
      const sourcePath = await resolveWorkspaceUserInstructionsImportPath(
        input.source_path,
        cwd
      );
      const stored = await writeUserInstructions("import", sourcePath, { cwd });
      invalidatePromptCache();
      return {
        success: true,
        output: `Imported user instructions from ${sourcePath} to ${USER_INSTRUCTIONS_DISPLAY_PATH} (${stored.content.length} chars).`,
        metadata: {
          action: input.action,
          sourcePath,
          path: USER_INSTRUCTIONS_DISPLAY_PATH,
          chars: stored.content.length,
        },
      };
    }

    const stored = await writeUserInstructions("clear");
    invalidatePromptCache();
    return {
      success: true,
      output: `User instructions cleared at ${USER_INSTRUCTIONS_DISPLAY_PATH}.`,
      metadata: { action: input.action, path: USER_INSTRUCTIONS_DISPLAY_PATH, chars: stored.content.length },
    };
  }
);

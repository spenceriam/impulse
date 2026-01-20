import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { readFileSync, writeFileSync } from "fs";
import { sanitizePath } from "../util/path";

const DESCRIPTION = readFileSync(
  new URL("./file-edit.txt", import.meta.url),
  "utf-8"
);

const EditSchema = z.object({
  filePath: z.string(),
  oldString: z.string(),
  newString: z.string(),
  replaceAll: z.boolean().optional(),
});

type EditInput = z.infer<typeof EditSchema>;

export const fileEdit: Tool<EditInput> = Tool.define(
  "file_edit",
  DESCRIPTION,
  EditSchema,
  async (input: EditInput): Promise<ToolResult> => {
    try {
      const safePath = sanitizePath(input.filePath);
      const content = readFileSync(safePath, "utf-8");
      
      const occurrences = (content.match(new RegExp(escapeRegex(input.oldString), "g")) ?? []).length;

      if (occurrences === 0) {
        return {
          success: false,
          output: `oldString not found in file: ${input.filePath}`,
        };
      }

      if (occurrences > 1 && !input.replaceAll) {
        return {
          success: false,
          output: `oldString found ${occurrences} times in file. Use replaceAll: true to replace all occurrences.`,
        };
      }

      let newContent: string;
      if (input.replaceAll) {
        const escapedOld = escapeRegex(input.oldString);
        newContent = content.replace(new RegExp(escapedOld, "g"), input.newString);
      } else {
        const index = content.indexOf(input.oldString);
        if (index === -1) {
          return {
            success: false,
            output: `oldString not found in file: ${input.filePath}`,
          };
        }
        newContent = content.substring(0, index) + input.newString + content.substring(index + input.oldString.length);
      }

      writeFileSync(safePath, newContent, "utf-8");

      return {
        success: true,
        output: `File edited successfully: ${input.filePath}`,
        metadata: {
          replacements: input.replaceAll ? occurrences : 1,
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

function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

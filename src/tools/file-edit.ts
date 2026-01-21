import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { readFileSync, writeFileSync } from "fs";
import { resolve, relative, isAbsolute } from "path";
import { sanitizePath } from "../util/path";
import { ask as askPermission } from "../permission";

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

/**
 * Check if a path is within the current working directory
 */
function isWithinCwd(targetPath: string): boolean {
  const cwd = process.cwd();
  const absoluteTarget = isAbsolute(targetPath) 
    ? targetPath 
    : resolve(cwd, targetPath);
  const relativePath = relative(cwd, absoluteTarget);
  
  // If relative path starts with "..", it's outside cwd
  return !relativePath.startsWith("..");
}

export const fileEdit: Tool<EditInput> = Tool.define(
  "file_edit",
  DESCRIPTION,
  EditSchema,
  async (input: EditInput): Promise<ToolResult> => {
    try {
      const safePath = sanitizePath(input.filePath);
      const content = readFileSync(safePath, "utf-8");
      
      // Only ask permission for files outside the working directory
      if (!isWithinCwd(safePath)) {
        await askPermission({
          sessionID: "current",
          permission: "edit",
          patterns: [safePath],
          message: `Edit file outside cwd: ${safePath}`,
          metadata: {
            oldString: input.oldString.slice(0, 100) + (input.oldString.length > 100 ? "..." : ""),
            newString: input.newString.slice(0, 100) + (input.newString.length > 100 ? "..." : ""),
            reason: "Path outside working directory",
          },
        });
      }
      
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

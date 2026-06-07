import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { readFile, writeFile } from "fs/promises";
import { resolve, relative, isAbsolute } from "path";
import { createPatch } from "diff";
import { createCompactDiff } from "../util/compact-diff";
import { sanitizePath } from "../util/path";
import { ask as askPermission } from "../permission";
import { validateWritePath } from "./mode-state";
import { Bus } from "../bus";
import { FileEvents } from "../format/events";
import { zCodeEdit, zFilePath } from "./schemas/branded";

const DESCRIPTION = `Edit a file by exact string replacement.

Required: filePath, oldString, newString. Optional: replaceAll.
See docs/tools/file-edit.md for usage rules and failure cases.`;

const EditSchema = z.object({
  filePath: zFilePath(),
  oldString: zCodeEdit(),
  newString: zCodeEdit(),
  replaceAll: z.boolean().optional(),
});

type EditInput = z.infer<typeof EditSchema>;
const MAX_DIFF_BYTES = 200_000; // 200KB

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
      
      // Check mode-based path restrictions (PLAN -> docs/ or PRD.md)
      const modeError = validateWritePath(safePath);
      if (modeError) {
        return {
          success: false,
          output: modeError,
        };
      }
      
      const content = await readFile(safePath, "utf-8");
      
      const outsideCwd = !isWithinCwd(safePath);
      const fileName = safePath.split(/[/\\]/).pop() ?? safePath;
      await askPermission({
        sessionID: "current",
        permission: "edit",
        patterns: [safePath],
        message: outsideCwd ? `Edit file outside cwd: ${safePath}` : `Edit file: ${safePath}`,
        metadata: {
          path: safePath,
          oldString: input.oldString.slice(0, 100) + (input.oldString.length > 100 ? "..." : ""),
          newString: input.newString.slice(0, 100) + (input.newString.length > 100 ? "..." : ""),
          reason: outsideCwd
            ? "Edit a file outside the project working directory"
            : `Apply a code edit to ${fileName}`,
        },
      });
      
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

      const shouldSkipDiff = Buffer.byteLength(content, "utf-8") + Buffer.byteLength(newContent, "utf-8") > MAX_DIFF_BYTES;
      let diff = "";
      let compactDiff: string[] | undefined;
      let linesAdded = 0;
      let linesRemoved = 0;
      let firstChangedLine: number | undefined;
      let diffSkipped = false;
      let diffReason: string | undefined;

      if (shouldSkipDiff) {
        diffSkipped = true;
        diffReason = "File too large to diff";
      } else {
        // Generate unified diff before writing
        diff = createPatch(
          input.filePath,
          content,      // old content
          newContent,   // new content
          "original",
          "modified"
        );

        const compact = createCompactDiff(content, newContent);
        compactDiff = compact.lines;
        linesAdded = compact.additions;
        linesRemoved = compact.removals;
        firstChangedLine = compact.firstChangedLine;
      }

      await writeFile(safePath, newContent, "utf-8");

      // Emit file edited event for formatters
      Bus.publish(FileEvents.Edited, { 
        file: safePath, 
        isNew: false 
      });

      return {
        success: true,
        output: `File edited successfully: ${input.filePath}`,
        metadata: {
          type: "file_edit",
          filePath: input.filePath,
          diff,
          compactDiff,
          linesAdded,
          linesRemoved,
          replacements: input.replaceAll ? occurrences : 1,
          firstChangedLine,
          diffSkipped,
          diffReason,
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

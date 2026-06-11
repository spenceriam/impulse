import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { readFile, writeFile } from "fs/promises";
import { resolve, relative, isAbsolute } from "path";
import { createPatch } from "diff";
import {
  capCompactDiffResult,
  createCompactDiff,
  MAX_DIFF_INPUT_BYTES,
  MAX_DIFF_PATCH_BYTES,
} from "../util/compact-diff";
import { resolveToolPath } from "./resolve-tool-path.js";
import { ask as askPermission } from "../permission";
import { validateWritePath } from "./mode-state";
import { SessionManager } from "../session/manager";
import { Bus } from "../bus";
import { FileEvents } from "../format/events";
import { zCodeEdit, zFilePath } from "./schemas/branded";
import {
  applyReplacement,
  buildOldStringNotFoundError,
  findExact,
  replaceAllExact,
  replaceAllLineTrimmed,
  resolveEditMatch,
} from "./edit-match.js";

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
      const safePath = await resolveToolPath(input.filePath, "file_edit");
      
      // Check mode-based path restrictions (PLAN -> docs/ or PRD.md)
      const modeError = validateWritePath(safePath);
      if (modeError) {
        return {
          success: false,
          output: modeError,
        };
      }
      
      const outsideCwd = !isWithinCwd(safePath);
      const fileName = safePath.split(/[/\\]/).pop() ?? safePath;
      await askPermission({
        sessionID: SessionManager.getCurrentSessionID() ?? "unknown",
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

      const content = await readFile(safePath, "utf-8");

      const resolved = resolveEditMatch(
        content,
        input.oldString,
        input.replaceAll ? { replaceAll: true } : {}
      );

      if (!resolved) {
        return {
          success: false,
          output: buildOldStringNotFoundError(input.filePath, content, input.oldString),
        };
      }

      const { effectiveOldString, usedFallback, occurrences } = resolved;

      if (occurrences > 1 && !input.replaceAll) {
        return {
          success: false,
          output: `oldString found ${occurrences} times in file. Use replaceAll: true to replace all occurrences.`,
        };
      }

      let newContent: string;
      if (input.replaceAll) {
        newContent = usedFallback
          ? replaceAllLineTrimmed(content, input.oldString, input.newString)
          : replaceAllExact(content, effectiveOldString, input.newString);
      } else {
        const match = findExact(content, effectiveOldString);
        if (!match) {
          return {
            success: false,
            output: buildOldStringNotFoundError(input.filePath, content, input.oldString),
          };
        }
        newContent = applyReplacement(content, match, input.newString);
      }

      const combinedBytes =
        Buffer.byteLength(content, "utf-8") + Buffer.byteLength(newContent, "utf-8");
      const shouldSkipDiff = combinedBytes > MAX_DIFF_INPUT_BYTES;
      let diff = "";
      let compactDiff: string[] | undefined;
      let linesAdded = 0;
      let linesRemoved = 0;
      let firstChangedLine: number | undefined;
      let diffSkipped = false;
      let diffReason: string | undefined;
      let diffTruncatedLines: number | undefined;

      if (shouldSkipDiff) {
        diffSkipped = true;
        diffReason = "File too large to diff";
      } else {
        const compact = createCompactDiff(content, newContent);
        const capped = capCompactDiffResult(compact);
        compactDiff = capped.compactDiff;
        linesAdded = capped.linesAdded;
        linesRemoved = capped.linesRemoved;
        firstChangedLine = capped.firstChangedLine;
        diffTruncatedLines = capped.diffTruncatedLines;

        if (combinedBytes <= MAX_DIFF_PATCH_BYTES) {
          diff = createPatch(
            input.filePath,
            content,
            newContent,
            "original",
            "modified"
          );
        }
      }

      await writeFile(safePath, newContent, "utf-8");

      // Emit file edited event for formatters
      Bus.publish(FileEvents.Edited, { 
        file: safePath, 
        isNew: false 
      });

      const fallbackNote = usedFallback
        ? "\nNote: matched with whitespace-normalized fallback."
        : "";

      return {
        success: true,
        output: `File edited successfully: ${input.filePath}${fallbackNote}`,
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
          diffTruncatedLines,
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


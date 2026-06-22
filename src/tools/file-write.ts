import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { mkdir, stat, writeFile, readFile, chmod, access } from "fs/promises";
import { basename, dirname } from "path";
import { ask as askPermission } from "../permission";
import { validateWritePath } from "./mode-state";
import { resolveToolPath } from "./resolve-tool-path.js";
import { createPatch } from "diff";
import {
  capCompactDiffResult,
  createAddedFileCompactDiff,
  createCompactDiff,
  MAX_DIFF_INPUT_BYTES,
  MAX_DIFF_PATCH_BYTES,
} from "../util/compact-diff";
import { Bus } from "../bus";
import { FileEvents } from "../format/events";
import { zFilePath } from "./schemas/branded";
import { isWithinBase } from "../util/path.js";
import { SessionManager } from "../session/manager";

const DESCRIPTION = `Write a file to disk (create or overwrite).

Required: filePath, content.
See docs/tools/file-write.md for usage rules.`;

const WriteSchema = z.object({
  filePath: zFilePath(),
  content: z.string(),
});

type WriteInput = z.infer<typeof WriteSchema>;

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a path is within the current working directory
 */
function isWithinCwd(targetPath: string): boolean {
  return isWithinBase(process.cwd(), targetPath);
}

export const fileWrite: Tool<WriteInput> = Tool.define(
  "file_write",
  DESCRIPTION,
  WriteSchema,
  async (input: WriteInput): Promise<ToolResult> => {
    try {
      const safePath = await resolveToolPath(input.filePath, "file_write");
      
      // Check mode-based path restrictions (PLAN -> docs/ or PRD.md)
      const modeError = validateWritePath(safePath);
      if (modeError) {
        return {
          success: false,
          output: modeError,
        };
      }
      
      const dir = dirname(safePath);
      
      // Determine if this is a new file or overwrite
      const isNewFile = !(await fileExists(safePath));
      const permissionType = isNewFile ? "write" : "edit";
      
      let existingContent = "";
      let existingSize = 0;
      
      const outsideCwd = !isWithinCwd(safePath);
      const needsPermission = outsideCwd || !isNewFile;
      if (needsPermission) {
        const message = isNewFile
          ? `Create file outside cwd: ${safePath}`
          : outsideCwd
            ? `Overwrite file outside cwd: ${safePath}`
            : `Overwrite file: ${safePath}`;
        const fileName = basename(safePath);
        await askPermission({
          sessionID: SessionManager.getCurrentSessionID() ?? "unknown",
          permission: permissionType,
          patterns: [safePath],
          message,
          metadata: {
            path: safePath,
            contentLength: input.content.length,
            isNewFile,
            reason: outsideCwd
              ? isNewFile
                ? "Create a file outside the project working directory"
                : "Overwrite a file outside the project working directory"
              : isNewFile
                ? `Create new file ${fileName}`
                : `Overwrite existing file ${fileName}`,
          },
        });
      }

      if (dir && dir !== safePath) {
        await mkdir(dir, { recursive: true });
      }

      let existingPermissions: number | undefined;
      if (!isNewFile) {
        try {
          const stats = await stat(safePath);
          existingPermissions = stats.mode;
          existingSize = stats.size;
        } catch {
        }
      }

      const newSize = Buffer.byteLength(input.content, "utf-8");
      const combinedBytes = existingSize + newSize;
      const shouldSkipDiff = combinedBytes > MAX_DIFF_INPUT_BYTES;

      if (!isNewFile && !shouldSkipDiff) {
        try {
          existingContent = await readFile(safePath, "utf-8");
        } catch {
          // If we can't read it, treat as new file for diff purposes
        }
      }

      await writeFile(safePath, input.content, "utf-8");

      if (existingPermissions !== undefined) {
        await chmod(safePath, existingPermissions);
      }

      // Count logical content lines written. Empty files have 0 lines.
      const linesWritten = input.content.length === 0 ? 0 : input.content.split("\n").length;
      
      // Generate diff for display
      const fileName = basename(safePath);
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
      } else if (isNewFile) {
        const compact = createAddedFileCompactDiff(input.content);
        const capped = capCompactDiffResult(compact);
        compactDiff = capped.compactDiff;
        linesAdded = capped.linesAdded;
        linesRemoved = capped.linesRemoved;
        firstChangedLine = capped.firstChangedLine;
        diffTruncatedLines = capped.diffTruncatedLines;
        if (combinedBytes <= MAX_DIFF_PATCH_BYTES) {
          diff = createPatch(fileName, "", input.content, "", "");
        }
      } else {
        const compact = createCompactDiff(existingContent, input.content);
        const capped = capCompactDiffResult(compact);
        compactDiff = capped.compactDiff;
        linesAdded = capped.linesAdded;
        linesRemoved = capped.linesRemoved;
        firstChangedLine = capped.firstChangedLine;
        diffTruncatedLines = capped.diffTruncatedLines;
        if (combinedBytes <= MAX_DIFF_PATCH_BYTES) {
          diff = createPatch(fileName, existingContent, input.content, "", "");
        }
      }

      // Emit file edited event for formatters
      Bus.publish(FileEvents.Edited, { 
        file: safePath, 
        isNew: isNewFile 
      });

      return {
        success: true,
        output: `File written successfully: ${input.filePath}`,
        metadata: {
          type: "file_write",
          filePath: input.filePath,
          linesWritten,
          created: isNewFile,
          diff,
          compactDiff,
          linesAdded,
          linesRemoved,
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

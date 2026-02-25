import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { mkdir, stat, writeFile, readFile, chmod, access } from "fs/promises";
import { resolve, relative, isAbsolute, basename } from "path";
import { sanitizePath } from "../util/path";
import { ask as askPermission } from "../permission";
import { validateWritePath } from "./mode-state";
import { createPatch } from "diff";
import { Bus } from "../bus";
import { FileEvents } from "../format/events";

const DESCRIPTION = `Write a file to disk (create or overwrite).

Required: filePath, content.
See docs/tools/file-write.md for usage rules.`;

const WriteSchema = z.object({
  filePath: z.string(),
  content: z.string(),
});

type WriteInput = z.infer<typeof WriteSchema>;
const MAX_DIFF_BYTES = 200_000; // 200KB

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
  const cwd = process.cwd();
  const absoluteTarget = isAbsolute(targetPath) 
    ? targetPath 
    : resolve(cwd, targetPath);
  const relativePath = relative(cwd, absoluteTarget);
  
  // If relative path starts with "..", it's outside cwd
  return !relativePath.startsWith("..");
}

export const fileWrite: Tool<WriteInput> = Tool.define(
  "file_write",
  DESCRIPTION,
  WriteSchema,
  async (input: WriteInput): Promise<ToolResult> => {
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
      
      const dir = safePath.substring(0, safePath.lastIndexOf("/"));
      
      // Determine if this is a new file or overwrite
      const isNewFile = !(await fileExists(safePath));
      const permissionType = isNewFile ? "write" : "edit";
      
      let existingContent = "";
      let existingSize = 0;
      
      // Only ask permission for files outside the working directory
      if (!isWithinCwd(safePath)) {
        await askPermission({
          sessionID: "current",
          permission: permissionType,
          patterns: [safePath],
          message: isNewFile ? `Create file outside cwd: ${safePath}` : `Overwrite file outside cwd: ${safePath}`,
          metadata: {
            contentLength: input.content.length,
            isNewFile,
            reason: "Path outside working directory",
          },
        });
      }

      if (dir && dir.length > 0) {
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
      const shouldSkipDiff = existingSize + newSize > MAX_DIFF_BYTES;

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

      // Count lines written
      const linesWritten = input.content.split("\n").length;
      
      // Generate diff for display
      const fileName = basename(safePath);
      let diff = "";
      let diffSkipped = false;
      let diffReason: string | undefined;
      if (shouldSkipDiff) {
        diffSkipped = true;
        diffReason = "File too large to diff";
      } else if (isNewFile) {
        // For new files, create a diff showing all lines as additions
        diff = createPatch(fileName, "", input.content, "", "");
      } else {
        // For overwrites, create a proper diff
        diff = createPatch(fileName, existingContent, input.content, "", "");
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
